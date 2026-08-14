-- SIS-2026-0132: alinhamento com o gerenciamento de acesso central, no
-- mesmo padrão que o Eduardo já validou pro Suprimentos (SIS-2026-0112,
-- 20260831000001_malote_cotacao_suprimentos.sql).
--
-- Por que: as ações de aprovação do Malote (aprovar/reprovar/ajuste de
-- despesa N1-N3, aprovação inicial de solicitação, decisão de cotação)
-- hoje só saem via UPDATE direto do client. A RLS de malote_despesa
-- (malote_despesa_update, 20260830000001) só libera pro CRIADOR (e só
-- enquanto status='rascunho') ou pra quem é admin/supervisor por cargo —
-- um aprovador comum, configurado em aprovador{N}_user_id na Classificação
-- mas sem cargo de Controladoria/Diretoria/Sistemas, nunca conseguia
-- efetivamente agir. Só "funcionava" nos testes porque o dev de teste
-- também era supervisor por cargo.
--
-- Daqui pra frente, essas ações passam por funções SECURITY DEFINER que
-- checam DOIS níveis, igual o Eduardo fez: can_access() (elegibilidade
-- geral — "esse usuário pode aprovar coisas do Malote?", vem do
-- gerenciamento de acesso) E o dado da linha (aprovador{N}_user_id da
-- Classificação desta despesa específica — isso can_access() nunca vai
-- saber, é por design, não é um "papel"). malote_supervisor_por_cargo()
-- continua valendo como rede de segurança adicional (OR), não foi retirado.

-- ── 1. Ação "aprovar" nos menus do Malote já cadastrados ────────────────
-- (malote_despesa_visualizar / malote_solicitacao_visualizar já existem
-- desde 20260831000002, hoje só com visualizar/incluir/alterar/excluir.)
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, mc.menu_codigo, 'aprovar'::public.app_acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES ('malote_despesa_visualizar'), ('malote_solicitacao_visualizar')) AS mc(menu_codigo)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── 2. Elegibilidade geral — "posso aprovar coisas do Malote?" ──────────
CREATE OR REPLACE FUNCTION public.malote_pode(_acao public.app_acao)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_access(auth.uid(), 'malote_despesa_visualizar', _acao)
      OR public.can_access(auth.uid(), 'malote_solicitacao_visualizar', _acao);
$$;

-- ── 3. Dado da linha — quem é o aprovador desta despesa específica ──────
CREATE OR REPLACE FUNCTION public.malote_aprovador_do_nivel(_despesa_id uuid, _nivel smallint)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE _nivel
    WHEN 1 THEN c.aprovador1_user_id
    WHEN 2 THEN c.aprovador2_user_id
    WHEN 3 THEN c.aprovador3_user_id
  END
  FROM public.malote_despesa d
  JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
  WHERE d.id = _despesa_id;
$$;

CREATE OR REPLACE FUNCTION public.malote_sou_aprovador_configurado(_despesa_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.malote_despesa d
    JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
    WHERE d.id = _despesa_id
      AND _user_id IN (c.aprovador1_user_id, c.aprovador2_user_id, c.aprovador3_user_id)
  );
$$;

-- ── 4. Ações — cada uma valida status + permissão, escreve, loga evento ─

-- Aprovar despesa (N1→N2→N3→aguardando_pagamento) — sequencial, só o
-- aprovador do NÍVEL ATUAL (ou supervisor/admin).
CREATE OR REPLACE FUNCTION public.malote_aprovar_despesa(
  _id uuid,
  _proximo_nivel_configurado boolean,
  _valor_aprovado numeric,
  _justificativa text,
  _forma_pagamento text,
  _informacoes_pagamento text,
  _data_pagamento date,
  _competencia date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_nivel smallint;
BEGIN
  SELECT status, nivel_aprovacao_atual INTO v_status, v_nivel FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status <> 'pendente_aprovacao' THEN RAISE EXCEPTION 'Despesa não está pendente de aprovação.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_aprovador_do_nivel(_id, v_nivel) = auth.uid()
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para aprovar esta despesa.';
  END IF;

  UPDATE public.malote_despesa SET
    valor_aprovado = _valor_aprovado,
    justificativa_aprovacao = _justificativa,
    forma_pagamento = _forma_pagamento,
    informacoes_pagamento = _informacoes_pagamento,
    data_pagamento = _data_pagamento,
    competencia = _competencia,
    nivel_aprovacao_atual = CASE WHEN v_nivel < 3 AND _proximo_nivel_configurado THEN v_nivel + 1 ELSE nivel_aprovacao_atual END,
    status = CASE WHEN v_nivel < 3 AND _proximo_nivel_configurado THEN status ELSE 'aguardando_pagamento' END
  WHERE id = _id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, nivel, ator_user_id)
  VALUES (_id, 'aprovacao_nivel', _justificativa, v_nivel, auth.uid());
END;
$$;

-- Solicitar ajuste — mesma alçada do aprovar (nível atual).
CREATE OR REPLACE FUNCTION public.malote_solicitar_ajuste_despesa(_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_nivel smallint;
BEGIN
  SELECT status, nivel_aprovacao_atual INTO v_status, v_nivel FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status <> 'pendente_aprovacao' THEN RAISE EXCEPTION 'Despesa não está pendente de aprovação.'; END IF;
  IF _motivo IS NULL OR btrim(_motivo) = '' THEN RAISE EXCEPTION 'Motivo é obrigatório.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_aprovador_do_nivel(_id, v_nivel) = auth.uid()
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para solicitar ajuste nesta despesa.';
  END IF;

  UPDATE public.malote_despesa SET status = 'necessidade_de_ajuste', motivo_ajuste = _motivo WHERE id = _id;
  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, nivel, ator_user_id)
  VALUES (_id, 'necessidade_de_ajuste', _motivo, v_nivel, auth.uid());
END;
$$;

-- Reprovar despesa — qualquer aprovador CONFIGURADO (nível atual ou
-- passado), em pendente_aprovacao ou aguardando_pagamento — mesma regra
-- que a UI já validava (souAprovadorConfigurado).
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
  IF v_status NOT IN ('pendente_aprovacao', 'aguardando_pagamento') THEN
    RAISE EXCEPTION 'Despesa não pode ser reprovada neste status.';
  END IF;
  IF _motivo IS NULL OR btrim(_motivo) = '' THEN RAISE EXCEPTION 'Motivo é obrigatório.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_sou_aprovador_configurado(_id, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para reprovar esta despesa.';
  END IF;

  UPDATE public.malote_despesa SET status = 'despesa_reprovada' WHERE id = _id;
  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (_id, 'despesa_reprovada', _motivo, auth.uid());
END;
$$;

-- Aprovação inicial da Solicitação — gate único, qualquer um dos 3
-- aprovadores configurados na Classificação.
CREATE OR REPLACE FUNCTION public.malote_aprovar_solicitacao_inicial(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF v_status <> 'aguardando_aprovacao_inicial' THEN RAISE EXCEPTION 'Solicitação não está aguardando aprovação inicial.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_sou_aprovador_configurado(_id, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para aprovar esta solicitação.';
  END IF;

  UPDATE public.malote_despesa SET status = 'aguardando_cotacao' WHERE id = _id;
  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id)
  VALUES (_id, 'solicitacao_aprovada', auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.malote_reprovar_solicitacao_inicial(_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF v_status NOT IN ('aguardando_aprovacao_inicial', 'aguardando_cotacao') THEN
    RAISE EXCEPTION 'Solicitação não pode ser reprovada neste status.';
  END IF;
  IF _motivo IS NULL OR btrim(_motivo) = '' THEN RAISE EXCEPTION 'Motivo é obrigatório.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_sou_aprovador_configurado(_id, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para reprovar esta solicitação.';
  END IF;

  UPDATE public.malote_despesa SET status = 'solicitacao_reprovada' WHERE id = _id;
  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (_id, 'solicitacao_reprovada', _motivo, auth.uid());
END;
$$;

-- Decisão da cotação (escolher vencedora / reprovar) — mesma alçada da
-- aprovação inicial: qualquer aprovador configurado na Classificação.
CREATE OR REPLACE FUNCTION public.malote_aprovar_cotacao(_id uuid, _numero smallint, _valor numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF v_status <> 'cotacao_realizada' THEN RAISE EXCEPTION 'Cotação não está pronta pra decisão.'; END IF;
  IF _numero NOT IN (1, 2, 3) THEN RAISE EXCEPTION 'Cotação inválida.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_sou_aprovador_configurado(_id, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para decidir a cotação desta solicitação.';
  END IF;

  UPDATE public.malote_despesa SET
    status = 'cotacao_aprovada',
    cotacao_vencedor_num = _numero,
    cotacao_decidida_em = now(),
    cotacao_decidida_por = auth.uid(),
    valor_aprovado_cotacao = _valor
  WHERE id = _id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id)
  VALUES (_id, 'cotacao_aprovada', auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.malote_reprovar_cotacao(_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF v_status <> 'cotacao_realizada' THEN RAISE EXCEPTION 'Cotação não está pronta pra decisão.'; END IF;
  IF _motivo IS NULL OR btrim(_motivo) = '' THEN RAISE EXCEPTION 'Motivo é obrigatório.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_sou_aprovador_configurado(_id, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para decidir a cotação desta solicitação.';
  END IF;

  UPDATE public.malote_despesa SET status = 'solicitacao_reprovada', cotacao_reprovada_motivo = _motivo WHERE id = _id;
  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (_id, 'solicitacao_reprovada', _motivo, auth.uid());
END;
$$;

-- ── 5. Permissões de execução ────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'malote_aprovar_despesa(uuid, boolean, numeric, text, text, text, date, date)',
    'malote_solicitar_ajuste_despesa(uuid, text)',
    'malote_reprovar_despesa(uuid, text)',
    'malote_aprovar_solicitacao_inicial(uuid)',
    'malote_reprovar_solicitacao_inicial(uuid, text)',
    'malote_aprovar_cotacao(uuid, smallint, numeric)',
    'malote_reprovar_cotacao(uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM public, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- Auxiliares: não são porta de entrada, mas são chamadas de dentro das RPCs.
REVOKE ALL ON FUNCTION public.malote_pode(public.app_acao) FROM public, anon;
REVOKE ALL ON FUNCTION public.malote_aprovador_do_nivel(uuid, smallint) FROM public, anon;
REVOKE ALL ON FUNCTION public.malote_sou_aprovador_configurado(uuid, uuid) FROM public, anon;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.malote_aprovar_despesa(uuid, boolean, numeric, text, text, text, date, date);
--   DROP FUNCTION IF EXISTS public.malote_solicitar_ajuste_despesa(uuid, text);
--   DROP FUNCTION IF EXISTS public.malote_reprovar_despesa(uuid, text);
--   DROP FUNCTION IF EXISTS public.malote_aprovar_solicitacao_inicial(uuid);
--   DROP FUNCTION IF EXISTS public.malote_reprovar_solicitacao_inicial(uuid, text);
--   DROP FUNCTION IF EXISTS public.malote_aprovar_cotacao(uuid, smallint, numeric);
--   DROP FUNCTION IF EXISTS public.malote_reprovar_cotacao(uuid, text);
--   DROP FUNCTION IF EXISTS public.malote_pode(public.app_acao);
--   DROP FUNCTION IF EXISTS public.malote_aprovador_do_nivel(uuid, smallint);
--   DROP FUNCTION IF EXISTS public.malote_sou_aprovador_configurado(uuid, uuid);
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo IN ('malote_despesa_visualizar','malote_solicitacao_visualizar') AND acao = 'aprovar';
-- =====================================================================
