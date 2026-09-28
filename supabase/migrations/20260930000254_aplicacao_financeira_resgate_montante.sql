-- Achado real (Cálita): resgate de Aplicações Financeiras não pode
-- alterar/fechar a linha da aplicação original — cada linha tem que
-- continuar batendo 1:1 com o extrato do banco pra conciliação depois. A
-- primeira versão desta migration ainda amarrava o resgate a uma
-- aplicação específica (FIFO por linha); o usuário corrigiu: resgate é só
-- dinheiro ENTRANDO no caixa da empresa, do mesmo jeito que aplicar é
-- dinheiro SAINDO — simétrico, e sem vínculo com nenhuma linha de
-- "APLICACAO_FINANCEIRA". As linhas continuam exatamente como foram
-- criadas, pra sempre — só "Editar" (campos informativos) e "Atualizar
-- rendimento" continuam mudando uma linha.
--
-- Por isso o resgate ganha tabela própria, sem FK pra
-- "APLICACAO_FINANCEIRA": só empresa + valor + data. "Quanto ainda tem
-- pra resgatar" é calculado ao vivo (soma aplicado da empresa − soma já
-- resgatado da empresa), não por linha.

CREATE TABLE public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  data_resgate date NOT NULL,
  valor_principal numeric NOT NULL CHECK (valor_principal > 0),
  valor_rendimento numeric NOT NULL DEFAULT 0 CHECK (valor_rendimento >= 0),
  observacao text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_aplicacao_financeira_resgate_caixa_empresa
  ON public."APLICACAO_FINANCEIRA_RESGATE_CAIXA"(empresa_id);

ALTER TABLE public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" ENABLE ROW LEVEL SECURITY;

-- Mesmo padrão das outras tabelas do módulo (migration 20260930000227):
-- defesa em profundidade, caminho oficial é a RPC (SECURITY DEFINER)
-- abaixo — sem policy de INSERT/UPDATE/DELETE direta.
DROP POLICY IF EXISTS aplicacao_financeira_resgate_caixa_select ON public."APLICACAO_FINANCEIRA_RESGATE_CAIXA";
CREATE POLICY aplicacao_financeira_resgate_caixa_select ON public."APLICACAO_FINANCEIRA_RESGATE_CAIXA"
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'visualizar'));

-- Resgate sobre o montante ativo da empresa: valida contra o saldo
-- disponível (total aplicado − total já resgatado, ambos somados pela
-- empresa, nunca por linha) e grava só na tabela nova — nenhuma linha de
-- APLICACAO_FINANCEIRA é lida com FOR UPDATE nem alterada.
CREATE OR REPLACE FUNCTION public.aplicacao_financeira_resgatar_montante(
  _empresa_id uuid, _data_resgate date, _valor_principal numeric,
  _valor_rendimento numeric DEFAULT 0, _observacao text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_total_aplicado numeric;
  v_total_resgatado_principal numeric;
  v_total_rendimento numeric;
  v_total_resgatado_rendimento numeric;
  v_saldo_principal numeric;
  v_saldo_rendimento numeric;
  v_id uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para registrar resgate.';
  END IF;
  IF _valor_principal <= 0 THEN
    RAISE EXCEPTION 'Valor do principal resgatado deve ser positivo.';
  END IF;
  IF COALESCE(_valor_rendimento, 0) < 0 THEN
    RAISE EXCEPTION 'Valor de rendimento inválido.';
  END IF;

  SELECT COALESCE(SUM(valor_aplicado), 0), COALESCE(SUM(rendimento_acumulado), 0)
    INTO v_total_aplicado, v_total_rendimento
  FROM public."APLICACAO_FINANCEIRA" WHERE empresa_id = _empresa_id;

  SELECT COALESCE(SUM(valor_principal), 0), COALESCE(SUM(valor_rendimento), 0)
    INTO v_total_resgatado_principal, v_total_resgatado_rendimento
  FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" WHERE empresa_id = _empresa_id;

  v_saldo_principal := v_total_aplicado - v_total_resgatado_principal;
  v_saldo_rendimento := v_total_rendimento - v_total_resgatado_rendimento;

  IF _valor_principal > v_saldo_principal THEN
    RAISE EXCEPTION 'Valor do principal (R$ %) maior que o montante ativo disponível da empresa (R$ %).', _valor_principal, v_saldo_principal;
  END IF;
  IF COALESCE(_valor_rendimento, 0) > v_saldo_rendimento THEN
    RAISE EXCEPTION 'Valor de rendimento (R$ %) maior que o rendimento acumulado disponível da empresa (R$ %).', _valor_rendimento, v_saldo_rendimento;
  END IF;

  INSERT INTO public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" (
    empresa_id, data_resgate, valor_principal, valor_rendimento, observacao, created_by
  ) VALUES (
    _empresa_id, _data_resgate, _valor_principal, COALESCE(_valor_rendimento, 0), _observacao, auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.aplicacao_financeira_resgatar_montante FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aplicacao_financeira_resgatar_montante TO authenticated;

-- Substitui a fonte da view de Fluxo de Caixa do resgate — mesmas colunas
-- (mesma ordem/tipo) da versão original (migration 20260930000227), só
-- troca de onde vêm os dados. id_malote/banco/número de parcela não
-- existem mais nesse nível (resgate não é mais por linha), ficam NULL —
-- igual contrato_id/contrato_nome já eram NULL na view original.
CREATE OR REPLACE VIEW public.v_aplicacao_financeira_resgate_fluxo_caixa AS
SELECT
  r.id AS despesa_id,
  NULL::text AS id_malote,
  r.data_resgate AS data_pagamento,
  to_char(r.data_resgate, 'YYYY-MM-01')::date AS competencia,
  r.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  NULL::uuid AS contrato_id,
  NULL::text AS contrato_nome,
  cl.id AS classificacao_id,
  cl.nome AS classificacao_nome,
  'Resgate de Aplicação Financeira' AS descricao,
  NULL::text AS forma_pagamento,
  NULL::uuid AS banco_id,
  NULL::text AS banco_nome,
  NULL::text AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  r.valor_principal + r.valor_rendimento AS valor,
  'entrada'::text AS tipo
FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" r
LEFT JOIN public.empresas e ON e.id = r.empresa_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.nome_key = 'aplicação financeira';

ALTER VIEW public.v_aplicacao_financeira_resgate_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_aplicacao_financeira_resgate_fluxo_caixa TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.aplicacao_financeira_resgatar_montante(uuid, date, numeric, numeric, text);
--   DROP POLICY IF EXISTS aplicacao_financeira_resgate_caixa_select ON public."APLICACAO_FINANCEIRA_RESGATE_CAIXA";
--   DROP TABLE IF EXISTS public."APLICACAO_FINANCEIRA_RESGATE_CAIXA";
--   -- view volta a apontar pra APLICACAO_FINANCEIRA_RESGATE (por linha) —
--   -- reaplicar o CREATE VIEW original da migration 20260930000227.
--   NOTIFY pgrst, 'reload schema';
