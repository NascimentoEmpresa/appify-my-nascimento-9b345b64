-- SIS-2026-0160: Malote — Pagamento (novo submódulo do Financeiro)
--
-- Hoje "aguardando_pagamento" não tem nenhuma ação de pagamento — só
-- "Reprovar" (pro aprovador configurado da Classificação, via
-- malote_reprovar_despesa). O Iury pediu um novo estágio "Pronto para
-- Pagar (Conferido)" e um conjunto de ações pro time Financeiro:
--   aguardando_pagamento -> pronto_para_pagar (Marcar como Conferido)
--   aguardando_pagamento | pronto_para_pagar -> ajuste_pagamento (Solicitar Ajuste)
--   ajuste_pagamento -> despesa_reprovada (só Reprovar, nenhuma outra ação)
--   aguardando_pagamento | pronto_para_pagar -> despesa_paga (Pagar, comprovante obrigatório)
--   aguardando_pagamento | pronto_para_pagar -> despesa_reprovada (Reprovar)
--
-- "ajuste_pagamento" é um status NOVO e DEDICADO — não reaproveita
-- necessidade_de_ajuste, que já é usado num ponto bem anterior do fluxo
-- (ajuste da solicitação, antes de virar despesa) com regras diferentes
-- (reenviar pra aprovação, reinicia em N1). Reaproveitar teria misturado
-- dois pontos de recuperação do fluxo com ações permitidas diferentes.
--
-- Acesso: reaproveita o padrão já validado em
-- 20260906000002_malote_permissoes_aprovacao.sql (RPCs SECURITY DEFINER
-- checando can_access() + malote_supervisor_por_cargo()/admin) e em
-- 20260901000003_malote_despesa_leitura_suprimentos.sql (extensão
-- aditiva da policy de SELECT pra um público que não é o criador/mesma
-- empresa). Financeiro não é o aprovador configurado da Classificação —
-- é um papel coarse, resolvido só pelo gerenciamento de acesso central
-- (novo menu 'malote_pagamento'), nunca por cargo hardcoded.

-- ── 1. Status e eventos novos (text + CHECK, não enum — fácil de estender) ──
ALTER TABLE public.malote_despesa DROP CONSTRAINT malote_despesa_status_check;
ALTER TABLE public.malote_despesa ADD CONSTRAINT malote_despesa_status_check CHECK (status IN (
  'rascunho',
  'aguardando_aprovacao_inicial',
  'aguardando_cotacao',
  'cotacao_realizada',
  'cotacao_aprovada',
  'solicitacao_reprovada',
  'pendente_aprovacao',
  'necessidade_de_ajuste',
  'aguardando_pagamento',
  'pronto_para_pagar',
  'ajuste_pagamento',
  'despesa_paga',
  'despesa_reprovada',
  'cancelada'
));

ALTER TABLE public.malote_despesa_evento DROP CONSTRAINT malote_despesa_evento_tipo_evento_check;
ALTER TABLE public.malote_despesa_evento ADD CONSTRAINT malote_despesa_evento_tipo_evento_check CHECK (tipo_evento IN (
  'criacao', 'edicao', 'aguardando_cotacao', 'cotacao_realizada', 'cotacao_aprovada',
  'solicitacao_aprovada', 'solicitacao_reprovada', 'despesa_criada', 'aprovacao_nivel',
  'necessidade_de_ajuste', 'reenvio_aprovacao', 'aguardando_pagamento',
  'conferido_pagamento', 'ajuste_pagamento_solicitado',
  'despesa_paga', 'despesa_reprovada', 'cancelamento'
));

-- ── 2. Colunas da confirmação real do pagamento ──────────────────────────
-- Distintas do "pagamento planejado" já preenchido na aprovação
-- (forma_pagamento/informacoes_pagamento/data_pagamento/competencia).
ALTER TABLE public.malote_despesa
  ADD COLUMN comprovante_pagamento_path text,
  ADD COLUMN observacao_pagamento text,
  ADD COLUMN pago_em timestamptz,
  ADD COLUMN pago_por uuid REFERENCES auth.users(id),
  ADD COLUMN conferido_em timestamptz,
  ADD COLUMN conferido_por uuid REFERENCES auth.users(id);

-- ── 3. Elegibilidade geral — "posso agir no Pagamento Malote?" ───────────
-- Diferente de malote_pode() (que é interna, só usada dentro de outras
-- RPCs): esta também é GRANT EXECUTE pra authenticated, pra o frontend
-- decidir se mostra os botões sem precisar tentar e receber erro.
CREATE OR REPLACE FUNCTION public.malote_pode_pagar()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_access(auth.uid(), 'malote_pagamento', 'aprovar');
$$;

-- ── 4. Ações — cada uma valida status + permissão, escreve, loga evento ──

CREATE OR REPLACE FUNCTION public.malote_marcar_conferido_despesa(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status <> 'aguardando_pagamento' THEN
    RAISE EXCEPTION 'Despesa não está aguardando pagamento.';
  END IF;

  IF NOT (
    public.malote_pode_pagar()
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para conferir esta despesa.';
  END IF;

  UPDATE public.malote_despesa SET
    status = 'pronto_para_pagar',
    conferido_em = now(),
    conferido_por = auth.uid()
  WHERE id = _id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id)
  VALUES (_id, 'conferido_pagamento', auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.malote_solicitar_ajuste_pagamento_despesa(_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status NOT IN ('aguardando_pagamento', 'pronto_para_pagar') THEN
    RAISE EXCEPTION 'Despesa não está em uma etapa de pagamento válida para ajuste.';
  END IF;
  IF _motivo IS NULL OR btrim(_motivo) = '' THEN RAISE EXCEPTION 'Motivo é obrigatório.'; END IF;

  IF NOT (
    public.malote_pode_pagar()
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para solicitar ajuste nesta despesa.';
  END IF;

  UPDATE public.malote_despesa SET status = 'ajuste_pagamento', motivo_ajuste = _motivo WHERE id = _id;
  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (_id, 'ajuste_pagamento_solicitado', _motivo, auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.malote_pagar_despesa(
  _id uuid,
  _data_pagamento date,
  _comprovante_path text,
  _observacao text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status NOT IN ('aguardando_pagamento', 'pronto_para_pagar') THEN
    RAISE EXCEPTION 'Despesa não está em uma etapa de pagamento válida.';
  END IF;
  IF _data_pagamento IS NULL THEN RAISE EXCEPTION 'Data do pagamento é obrigatória.'; END IF;
  IF _comprovante_path IS NULL OR btrim(_comprovante_path) = '' THEN
    RAISE EXCEPTION 'Comprovante de pagamento é obrigatório.';
  END IF;

  IF NOT (
    public.malote_pode_pagar()
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para pagar esta despesa.';
  END IF;

  UPDATE public.malote_despesa SET
    status = 'despesa_paga',
    data_pagamento = _data_pagamento,
    comprovante_pagamento_path = _comprovante_path,
    observacao_pagamento = _observacao,
    pago_em = now(),
    pago_por = auth.uid()
  WHERE id = _id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (_id, 'despesa_paga', _observacao, auth.uid());
END;
$$;

-- Estende malote_reprovar_despesa (20260906000002) pros novos estágios de
-- pagamento — mesma assinatura, CREATE OR REPLACE. Mantém a alçada do
-- aprovador configurado (já cobria aguardando_pagamento) e soma a alçada
-- do Financeiro (malote_pode_pagar()).
CREATE OR REPLACE FUNCTION public.malote_reprovar_despesa(_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status NOT IN ('pendente_aprovacao', 'aguardando_pagamento', 'pronto_para_pagar', 'ajuste_pagamento') THEN
    RAISE EXCEPTION 'Despesa não pode ser reprovada neste status.';
  END IF;
  IF _motivo IS NULL OR btrim(_motivo) = '' THEN RAISE EXCEPTION 'Motivo é obrigatório.'; END IF;

  IF NOT (
    (public.malote_pode('aprovar') AND public.malote_sou_aprovador_configurado(_id, auth.uid()))
    OR public.malote_pode_pagar()
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para reprovar esta despesa.';
  END IF;

  UPDATE public.malote_despesa SET status = 'despesa_reprovada' WHERE id = _id;
  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (_id, 'despesa_reprovada', _motivo, auth.uid());
END;
$$;

-- ── 5. Permissões de execução ─────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'malote_marcar_conferido_despesa(uuid)',
    'malote_solicitar_ajuste_pagamento_despesa(uuid, text)',
    'malote_pagar_despesa(uuid, date, text, text)',
    'malote_reprovar_despesa(uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM public, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.malote_pode_pagar() TO authenticated;
REVOKE ALL ON FUNCTION public.malote_pode_pagar() FROM public, anon;

-- ── 6. app_menu + perfil_acesso_permissao ─────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'malote_pagamento', 'Malote — Pagamento', '/app/malote/pagamento', 6
FROM public.app_modulo m
WHERE m.codigo = 'malote'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'malote_pagamento', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('incluir'::public.app_acao),
    ('alterar'::public.app_acao),
    ('excluir'::public.app_acao),
    ('aprovar'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── 7. RLS de malote_despesa — extensão aditiva pro Financeiro ───────────
-- Mesmo padrão de 20260901000003 (Suprimentos): ninguém que já enxergava
-- deixa de enxergar, só soma mais um ramo no OR.
DROP POLICY IF EXISTS malote_despesa_select ON public.malote_despesa;
CREATE POLICY malote_despesa_select ON public.malote_despesa
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR empresa_id = public.get_user_empresa(auth.uid())
    OR public.can_access(auth.uid(), 'sup_cotacoes_malote', 'visualizar')
    -- ── novo: Financeiro, pra confirmar pagamento ──
    OR public.can_access(auth.uid(), 'malote_pagamento', 'aprovar')
  );

-- ── 8. Hand-off pro Fluxo de Caixa (dados prontos, tela fica pra depois) ──
-- View derivada (não tabela mutável): só seleciona status='despesa_paga',
-- então se a despesa for estornada/cancelada depois de paga, a linha some
-- sozinha — sem precisar de lógica de remoção manual (regra do Anexo 1
-- do SIS-2026-0160). "Classificação da Despesa" é mapeada no nível da
-- despesa (o Anexo 1 não trata esse campo como condicional ao rateio,
-- diferente de Empresa/Contrato). Banco não é selecionado (regra
-- explícita: não enviar Banco pro Fluxo de Caixa).
CREATE OR REPLACE VIEW public.v_malote_pagamento_fluxo_caixa AS
SELECT
  d.id AS despesa_id,
  d.numero AS id_malote,
  d.data_pagamento,
  d.competencia,
  COALESCE(rl.empresa_id, d.empresa_id) AS empresa_id,
  COALESCE(rl.contrato_id, d.contrato_id) AS contrato_id,
  d.classificacao_id,
  d.nome AS descricao,
  d.forma_pagamento,
  COALESCE(rl.valor, d.valor_aprovado) AS valor,
  'saida'::text AS tipo
FROM public.malote_despesa d
LEFT JOIN public.malote_despesa_rateio_linha rl ON rl.despesa_id = d.id
WHERE d.status = 'despesa_paga';

ALTER VIEW public.v_malote_pagamento_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_malote_pagamento_fluxo_caixa TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP VIEW IF EXISTS public.v_malote_pagamento_fluxo_caixa;
--   DROP POLICY IF EXISTS malote_despesa_select ON public.malote_despesa;
--   CREATE POLICY malote_despesa_select ON public.malote_despesa FOR SELECT TO authenticated
--     USING (created_by = auth.uid()
--         OR public.has_role(auth.uid(), 'admin'::public.app_role)
--         OR public.malote_supervisor_por_cargo(auth.uid())
--         OR empresa_id = public.get_user_empresa(auth.uid())
--         OR public.can_access(auth.uid(), 'sup_cotacoes_malote', 'visualizar'));
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'malote_pagamento';
--   DELETE FROM public.app_menu WHERE codigo = 'malote_pagamento';
--   DROP FUNCTION IF EXISTS public.malote_marcar_conferido_despesa(uuid);
--   DROP FUNCTION IF EXISTS public.malote_solicitar_ajuste_pagamento_despesa(uuid, text);
--   DROP FUNCTION IF EXISTS public.malote_pagar_despesa(uuid, date, text, text);
--   DROP FUNCTION IF EXISTS public.malote_pode_pagar();
--   ALTER TABLE public.malote_despesa DROP COLUMN comprovante_pagamento_path, DROP COLUMN observacao_pagamento,
--     DROP COLUMN pago_em, DROP COLUMN pago_por, DROP COLUMN conferido_em, DROP COLUMN conferido_por;
--   (malote_reprovar_despesa e os CHECK constraints precisam voltar pra versão anterior manualmente)
-- =====================================================================
