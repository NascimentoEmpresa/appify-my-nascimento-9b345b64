-- ============================================================================
-- SIS-2026-0798 — Conta Garantida: lançar resgate, amortização e juros pela tela, com tudo registrado no Fluxo de Caixa
-- ============================================================================
-- A tela antiga (SIS de 23/07) só LIA uma planilha de Fluxo de Caixa importada à mão (fin_conta_garantida_*): não dava para lançar nada nela.
-- A Controladoria/Financeiro definiu que esse módulo é ultrapassado e que os dados dele NÃO precisam ser considerados: a tela passa a ser nativa,
-- no modelo do HTML enviado no chamado (carteira de contas, KPIs, resgate, amortização, filtros, gráficos). As tabelas fin_conta_garantida_*
-- continuam no banco, intactas e sem uso (nada é apagado aqui).
--
-- 1) financeiro_conta_garantida: a linha de crédito (empresa + banco + conta/contrato + limite + taxa + vencimento). A conta corrente onde o
--    dinheiro cai é opcional (conta_banco_id, cadastro da SIS-2026-0777): quando informada, cada lançamento já nasce ligado a ela no Fluxo.
-- 2) financeiro_conta_garantida_movimento: resgate (utilização do limite, ENTRADA no banco), amortização (devolução, SAÍDA) e juros/encargos
--    (SAÍDA, não mexe no saldo devedor). Estorno em vez de exclusão: o lançamento fica na tela como estornado (trilha de auditoria) e sai do
--    Fluxo e do saldo. Só as RPCs escrevem; elas travam a conta e conferem, em ordem cronológica, que o saldo nunca fica negativo nem passa do
--    limite (vale também para lançamento com data passada e para estorno).
-- 3) v_conta_garantida_fluxo_caixa: a 7ª fonte do Fluxo de Caixa (origem 'conta_garantida'), mesmas colunas das outras. Entra na lista fechada
--    de fontes de fluxo_caixa_ler_fonte e fluxo_caixa_ler_fonte_compacta e na CHECK de origem de financeiro_fluxo_caixa_conta.
-- 4) Acesso: menu 'conta-garantida' (já existe). visualizar = ver; incluir = lançar resgate/amortização/juros; alterar = cadastrar/editar conta;
--    excluir = estornar. Quem já tinha 'alterar' (antes era "pode tudo") ganha incluir e excluir para nada deixar de funcionar.
--
-- NÃO ENTRAM (de propósito): Faturamento/Lucratividade/Fechamento e Auditoria seguem lendo as 6 fontes de antes. Resgate e amortização são
-- captação/devolução de principal (não são receita nem custo) e entrariam como "receita extra" e "despesa adm" nesses números.
--
-- Migration leve (2 tabelas novas, 1 view, 5 funções): pode rodar inteira.
--
-- ROLLBACK:
--   DROP VIEW IF EXISTS public.v_conta_garantida_fluxo_caixa;
--   DROP FUNCTION IF EXISTS public.conta_garantida_estornar(uuid, text);
--   DROP FUNCTION IF EXISTS public.conta_garantida_lancar(uuid, text, date, numeric, uuid, text);
--   DROP FUNCTION IF EXISTS public.conta_garantida_validar_saldo(uuid);
--   DROP TABLE IF EXISTS public.financeiro_conta_garantida_movimento;
--   DROP TABLE IF EXISTS public.financeiro_conta_garantida;
--   (recriar fluxo_caixa_ler_fonte / fluxo_caixa_ler_fonte_compacta sem 'v_conta_garantida_fluxo_caixa' — 20261103002000 e 20261104000100)
--   (recriar a CHECK de financeiro_fluxo_caixa_conta sem 'conta_garantida' — 20261103005000)
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'conta-garantida' AND acao IN ('incluir', 'excluir');
SET lock_timeout = '5s';

-- ── 1. Ações do menu e quem já podia ────────────────────────────────────────
INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('conta-garantida', 'incluir'),
  ('conta-garantida', 'alterar'),
  ('conta-garantida', 'excluir')
ON CONFLICT DO NOTHING;

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT s.user_id, s.menu_codigo, a.acao::public.app_acao, true, s.empresa_id, 'SIS-2026-0798: Conta Garantida passou a ter incluir (lançar) e excluir (estornar)'
  FROM public.screen_permission_user s
  CROSS JOIN (VALUES ('incluir'), ('excluir')) AS a(acao)
 WHERE s.menu_codigo = 'conta-garantida' AND s.acao = 'alterar' AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = s.menu_codigo AND x.acao = a.acao::public.app_acao
                      AND x.empresa_id IS NOT DISTINCT FROM s.empresa_id);

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT p.perfil_id, p.menu_codigo, a.acao::public.app_acao, true
  FROM public.perfil_acesso_permissao p
  CROSS JOIN (VALUES ('incluir'), ('excluir')) AS a(acao)
 WHERE p.menu_codigo = 'conta-garantida' AND p.acao = 'alterar' AND p.allow
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── 2. Tabelas ──────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.financeiro_conta_garantida_numero_seq;
CREATE SEQUENCE IF NOT EXISTS public.financeiro_conta_garantida_movimento_numero_seq;

CREATE TABLE IF NOT EXISTS public.financeiro_conta_garantida (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL, -- CG-AAAA-NNNN (trigger)
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  banco_id uuid NOT NULL REFERENCES public.malote_cartao_banco(id),
  conta_banco_id uuid REFERENCES public.financeiro_conta_banco(id), -- conta corrente onde o dinheiro cai (opcional)
  conta text NOT NULL CHECK (btrim(conta) <> ''), -- número da conta / contrato da linha de crédito
  limite numeric(15,2) NOT NULL CHECK (limite > 0),
  taxa text, -- livre: "CDI + 1,20% a.m."
  vencimento date,
  status text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'encerrada')),
  observacao text,
  created_by uuid, -- sem FK para auth.users (mesmo motivo da 0777: criar a chave exige permissão naquela tabela)
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS financeiro_conta_garantida_numero ON public.financeiro_conta_garantida (numero);
CREATE UNIQUE INDEX IF NOT EXISTS financeiro_conta_garantida_unica ON public.financeiro_conta_garantida (empresa_id, banco_id, lower(btrim(conta)));

CREATE TABLE IF NOT EXISTS public.financeiro_conta_garantida_movimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY, -- desempate cronológico (mesma data): a ordem em que foi lançado
  numero text NOT NULL, -- CGM-AAAA-NNNN (trigger); é o "ID" que aparece no Fluxo
  conta_garantida_id uuid NOT NULL REFERENCES public.financeiro_conta_garantida(id),
  tipo text NOT NULL CHECK (tipo IN ('resgate', 'amortizacao', 'juros')),
  data_movimento date NOT NULL,
  valor numeric(15,2) NOT NULL CHECK (valor > 0),
  classificacao_id uuid REFERENCES public.planejamento_orcamentario_classificacao(id), -- a do Fluxo; a RPC exige
  observacao text,
  cancelado_em timestamptz,
  cancelado_por uuid,
  motivo_cancelamento text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS financeiro_conta_garantida_movimento_numero ON public.financeiro_conta_garantida_movimento (numero);
-- Índices das FKs que a unique (empresa_id, banco_id, conta) não cobre (guardião de desempenho): JOIN e DELETE nas tabelas referenciadas.
CREATE INDEX IF NOT EXISTS financeiro_conta_garantida_banco_id_idx ON public.financeiro_conta_garantida (banco_id);
CREATE INDEX IF NOT EXISTS financeiro_conta_garantida_conta_banco_id_idx ON public.financeiro_conta_garantida (conta_banco_id);
CREATE INDEX IF NOT EXISTS financeiro_conta_garantida_movimento_classificacao_id_idx ON public.financeiro_conta_garantida_movimento (classificacao_id);
CREATE INDEX IF NOT EXISTS financeiro_conta_garantida_movimento_conta ON public.financeiro_conta_garantida_movimento (conta_garantida_id, data_movimento, seq);

CREATE OR REPLACE FUNCTION public.conta_garantida_gerar_numero()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.numero IS NULL THEN
    NEW.numero := 'CG-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.financeiro_conta_garantida_numero_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.conta_garantida_movimento_gerar_numero()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.numero IS NULL THEN
    NEW.numero := 'CGM-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.financeiro_conta_garantida_movimento_numero_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS financeiro_conta_garantida_set_numero ON public.financeiro_conta_garantida;
CREATE TRIGGER financeiro_conta_garantida_set_numero BEFORE INSERT ON public.financeiro_conta_garantida
  FOR EACH ROW EXECUTE FUNCTION public.conta_garantida_gerar_numero();

DROP TRIGGER IF EXISTS financeiro_conta_garantida_set_updated ON public.financeiro_conta_garantida;
CREATE TRIGGER financeiro_conta_garantida_set_updated BEFORE UPDATE ON public.financeiro_conta_garantida
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS financeiro_conta_garantida_movimento_set_numero ON public.financeiro_conta_garantida_movimento;
CREATE TRIGGER financeiro_conta_garantida_movimento_set_numero BEFORE INSERT ON public.financeiro_conta_garantida_movimento
  FOR EACH ROW EXECUTE FUNCTION public.conta_garantida_movimento_gerar_numero();

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
-- Leitura: quem vê a Conta Garantida, o Fluxo de Caixa ou a Conciliação (a view do Fluxo é security_invoker; sem isto o Fluxo e a conciliação
-- de quem não tem a tela da Conta Garantida deixariam de ver o lançamento). Escrita: conta direta com 'alterar'; movimento só pelas RPCs.
ALTER TABLE public.financeiro_conta_garantida ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financeiro_conta_garantida_movimento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financeiro_conta_garantida_select ON public.financeiro_conta_garantida;
CREATE POLICY financeiro_conta_garantida_select ON public.financeiro_conta_garantida
  FOR SELECT TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'conta-garantida', 'visualizar'))
      OR (SELECT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'visualizar'))
      OR (SELECT public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'visualizar')));

DROP POLICY IF EXISTS financeiro_conta_garantida_insert ON public.financeiro_conta_garantida;
CREATE POLICY financeiro_conta_garantida_insert ON public.financeiro_conta_garantida
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.can_access(auth.uid(), 'conta-garantida', 'alterar')));

DROP POLICY IF EXISTS financeiro_conta_garantida_update ON public.financeiro_conta_garantida;
CREATE POLICY financeiro_conta_garantida_update ON public.financeiro_conta_garantida
  FOR UPDATE TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'conta-garantida', 'alterar')))
  WITH CHECK ((SELECT public.can_access(auth.uid(), 'conta-garantida', 'alterar')));

DROP POLICY IF EXISTS financeiro_conta_garantida_movimento_select ON public.financeiro_conta_garantida_movimento;
CREATE POLICY financeiro_conta_garantida_movimento_select ON public.financeiro_conta_garantida_movimento
  FOR SELECT TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'conta-garantida', 'visualizar'))
      OR (SELECT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'visualizar'))
      OR (SELECT public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'visualizar')));

GRANT SELECT, INSERT, UPDATE ON public.financeiro_conta_garantida TO authenticated;
GRANT SELECT ON public.financeiro_conta_garantida_movimento TO authenticated;

-- ── 4. RPCs ─────────────────────────────────────────────────────────────────
-- Confere, em ordem cronológica (data, depois ordem de lançamento), que o saldo devedor da conta nunca fica negativo nem passa do limite.
-- Só as RPCs abaixo chamam (não é concedida a ninguém).
CREATE OR REPLACE FUNCTION public.conta_garantida_validar_saldo(_conta_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limite numeric;
  v_min numeric;
  v_max numeric;
BEGIN
  SELECT limite INTO v_limite FROM public.financeiro_conta_garantida WHERE id = _conta_id;
  SELECT min(x.saldo), max(x.saldo) INTO v_min, v_max FROM (
    SELECT sum(CASE m.tipo WHEN 'resgate' THEN m.valor WHEN 'amortizacao' THEN -m.valor ELSE 0 END)
             OVER (ORDER BY m.data_movimento, m.seq) AS saldo
      FROM public.financeiro_conta_garantida_movimento m
     WHERE m.conta_garantida_id = _conta_id AND m.cancelado_em IS NULL
  ) x;
  IF v_min < 0 THEN
    RAISE EXCEPTION 'A amortização não pode ser maior que o saldo devedor da conta (em alguma data o saldo ficaria negativo em R$ %).', abs(v_min);
  END IF;
  IF v_max > v_limite THEN
    RAISE EXCEPTION 'A operação excede o limite contratado da conta (o saldo utilizado chegaria a R$ %, limite de R$ %).', v_max, v_limite;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.conta_garantida_validar_saldo(uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.conta_garantida_lancar(uuid, text, date, numeric, uuid, text);
CREATE FUNCTION public.conta_garantida_lancar(
  _conta_id uuid, _tipo text, _data date, _valor numeric, _classificacao_id uuid, _observacao text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_conta public.financeiro_conta_garantida%ROWTYPE;
  v_id uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'conta-garantida', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para lançar na Conta Garantida.';
  END IF;
  IF _tipo NOT IN ('resgate', 'amortizacao', 'juros') THEN
    RAISE EXCEPTION 'Tipo de lançamento inválido.';
  END IF;
  IF _valor IS NULL OR _valor <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.';
  END IF;
  IF _data IS NULL THEN
    RAISE EXCEPTION 'Informe a data do lançamento.';
  END IF;
  IF _classificacao_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao WHERE id = _classificacao_id) THEN
    RAISE EXCEPTION 'Informe a classificação do lançamento (é ela que aparece no Fluxo de Caixa).';
  END IF;

  SELECT * INTO v_conta FROM public.financeiro_conta_garantida WHERE id = _conta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta Garantida não encontrada.';
  END IF;
  IF v_conta.status <> 'ativa' THEN
    RAISE EXCEPTION 'A conta % está encerrada: reative-a antes de lançar.', v_conta.numero;
  END IF;

  INSERT INTO public.financeiro_conta_garantida_movimento (conta_garantida_id, tipo, data_movimento, valor, classificacao_id, observacao, created_by)
  VALUES (_conta_id, _tipo, _data, round(_valor, 2), _classificacao_id, NULLIF(btrim(_observacao), ''), auth.uid())
  RETURNING id INTO v_id;

  PERFORM public.conta_garantida_validar_saldo(_conta_id);

  -- Conta corrente informada na Conta Garantida: o lançamento já nasce ligado a ela no Fluxo (SIS-2026-0777).
  IF v_conta.conta_banco_id IS NOT NULL THEN
    INSERT INTO public.financeiro_fluxo_caixa_conta (origem, despesa_id, parcela, conta_banco_id, updated_by)
    VALUES ('conta_garantida', v_id, 0, v_conta.conta_banco_id, auth.uid())
    ON CONFLICT (origem, despesa_id, parcela) DO UPDATE SET conta_banco_id = EXCLUDED.conta_banco_id, updated_by = EXCLUDED.updated_by, updated_at = now();
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.conta_garantida_lancar(uuid, text, date, numeric, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_garantida_lancar(uuid, text, date, numeric, uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.conta_garantida_estornar(uuid, text);
CREATE FUNCTION public.conta_garantida_estornar(_movimento_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_mov public.financeiro_conta_garantida_movimento%ROWTYPE;
BEGIN
  IF NOT public.can_access(auth.uid(), 'conta-garantida', 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para estornar lançamentos da Conta Garantida.';
  END IF;
  IF _motivo IS NULL OR btrim(_motivo) = '' THEN
    RAISE EXCEPTION 'Informe o motivo do estorno.';
  END IF;

  SELECT * INTO v_mov FROM public.financeiro_conta_garantida_movimento WHERE id = _movimento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.';
  END IF;
  -- trava a conta antes de reler o estado do lançamento (dois estornos ao mesmo tempo)
  PERFORM 1 FROM public.financeiro_conta_garantida WHERE id = v_mov.conta_garantida_id FOR UPDATE;
  SELECT * INTO v_mov FROM public.financeiro_conta_garantida_movimento WHERE id = _movimento_id;
  IF v_mov.cancelado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Este lançamento já foi estornado.';
  END IF;

  UPDATE public.financeiro_conta_garantida_movimento
     SET cancelado_em = now(), cancelado_por = auth.uid(), motivo_cancelamento = btrim(_motivo)
   WHERE id = _movimento_id;

  PERFORM public.conta_garantida_validar_saldo(v_mov.conta_garantida_id);

  DELETE FROM public.financeiro_fluxo_caixa_conta WHERE origem = 'conta_garantida' AND despesa_id = _movimento_id;
END;
$$;

REVOKE ALL ON FUNCTION public.conta_garantida_estornar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_garantida_estornar(uuid, text) TO authenticated;

-- ── 5. Fonte do Fluxo de Caixa ──────────────────────────────────────────────
-- Mesmas colunas e ordem da v_aplicacao_financeira_resgate_fluxo_caixa. Resgate entra como ENTRADA; amortização e juros como SAÍDA.
-- Estornado não aparece. descricao já traz o tipo, o banco/conta e a observação.
CREATE OR REPLACE VIEW public.v_conta_garantida_fluxo_caixa AS
SELECT
  m.id AS despesa_id,
  m.numero AS id_malote,
  m.data_movimento AS data_pagamento,
  to_char(m.data_movimento, 'YYYY-MM-01')::date AS competencia,
  cg.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  NULL::uuid AS contrato_id,
  NULL::text AS contrato_nome,
  m.classificacao_id,
  cl.nome AS classificacao_nome,
  (CASE m.tipo WHEN 'resgate' THEN 'Resgate de Conta Garantida' WHEN 'amortizacao' THEN 'Amortização de Conta Garantida' ELSE 'Juros de Conta Garantida' END
    || ' — ' || COALESCE(cb.nome, '') || ' ' || cg.conta
    || COALESCE(' · ' || NULLIF(btrim(m.observacao), ''), '')) AS descricao,
  NULL::text AS forma_pagamento,
  cg.banco_id AS banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  m.valor AS valor,
  (CASE m.tipo WHEN 'resgate' THEN 'entrada' ELSE 'saida' END)::text AS tipo,
  'conta_garantida'::text AS origem,
  false AS ajustado
FROM public.financeiro_conta_garantida_movimento m
JOIN public.financeiro_conta_garantida cg ON cg.id = m.conta_garantida_id
LEFT JOIN public.empresas e ON e.id = cg.empresa_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = cg.banco_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = m.classificacao_id
WHERE m.cancelado_em IS NULL;

ALTER VIEW public.v_conta_garantida_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_conta_garantida_fluxo_caixa TO authenticated;

-- A conta (SIS-2026-0777) de cada lançamento do Fluxo: a CHECK de origem passa a aceitar 'conta_garantida'.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.financeiro_fluxo_caixa_conta'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%origem%'
  LOOP
    EXECUTE format('ALTER TABLE public.financeiro_fluxo_caixa_conta DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.financeiro_fluxo_caixa_conta
    ADD CONSTRAINT financeiro_fluxo_caixa_conta_origem_chk
    CHECK (origem IN ('malote', 'debito_automatico', 'cartao_fatura', 'aplicacao_financeira', 'importacao_historica', 'conta_garantida'));
END $$;

-- Lista fechada de fontes do Fluxo: as duas leituras (compacta e de sempre) passam a aceitar a nova view. Corpo idêntico ao de
-- 20261103002000 / 20261104000100, só com a fonte a mais.
CREATE OR REPLACE FUNCTION public.fluxo_caixa_ler_fonte(p_fonte text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  resultado json;
BEGIN
  IF p_fonte IS NULL OR p_fonte NOT IN (
    'v_malote_pagamento_fluxo_caixa', 'v_malote_pagamento_fluxo_caixa_consolidado',
    'v_debito_automatico_fluxo_caixa', 'v_cartao_fatura_fluxo_caixa',
    'v_aplicacao_financeira_fluxo_caixa', 'v_aplicacao_financeira_resgate_fluxo_caixa',
    'v_fluxo_caixa_importado_fluxo_caixa', 'v_fluxo_caixa_previsto',
    'v_conta_garantida_fluxo_caixa'
  ) THEN
    RAISE EXCEPTION 'fonte % não é do Fluxo de Caixa', p_fonte USING ERRCODE = '22023';
  END IF;
  IF to_regclass('public.' || quote_ident(p_fonte)) IS NULL THEN
    RAISE EXCEPTION 'relation "public.%" does not exist', p_fonte USING ERRCODE = '42P01';
  END IF;
  EXECUTE format('SELECT coalesce(json_agg(t), ''[]''::json) FROM public.%I t', p_fonte) INTO resultado;
  RETURN resultado;
END;
$$;

CREATE OR REPLACE FUNCTION public.fluxo_caixa_ler_fonte_compacta(p_fonte text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  resultado json;
BEGIN
  IF p_fonte IS NULL OR p_fonte NOT IN (
    'v_malote_pagamento_fluxo_caixa', 'v_malote_pagamento_fluxo_caixa_consolidado',
    'v_debito_automatico_fluxo_caixa', 'v_cartao_fatura_fluxo_caixa',
    'v_aplicacao_financeira_fluxo_caixa', 'v_aplicacao_financeira_resgate_fluxo_caixa',
    'v_fluxo_caixa_importado_fluxo_caixa', 'v_fluxo_caixa_previsto',
    'v_conta_garantida_fluxo_caixa'
  ) THEN
    RAISE EXCEPTION 'fonte % não é do Fluxo de Caixa', p_fonte USING ERRCODE = '22023';
  END IF;
  IF to_regclass('public.' || quote_ident(p_fonte)) IS NULL THEN
    RAISE EXCEPTION 'relation "public.%" does not exist', p_fonte USING ERRCODE = '42P01';
  END IF;
  EXECUTE public.leitura_compacta_sql(p_fonte) INTO resultado;
  RETURN resultado;
END;
$$;

NOTIFY pgrst, 'reload schema';
