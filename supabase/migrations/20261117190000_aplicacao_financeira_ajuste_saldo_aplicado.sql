-- [SEM-CHAMADO] Aplicação Financeira: resgate barrado por "montante ativo disponível" muito abaixo do saldo real aplicado (HAGG / Sicredi)
-- ============================================================================
-- A Cálita não conseguia registrar resgate de R$ 60.000,00 do HAGG: "Valor do principal (R$ 60000) maior que o montante ativo disponível da
-- empresa (R$ 10999)". O montante disponível é calculado = soma das aplicações cadastradas − soma dos resgates cadastrados (HAGG: 14.288.000,00 −
-- 14.277.001,00). Só que o saldo aplicado real no Sicredi, depois do marco zero, é R$ 2.282.000,01: o cadastro de aplicações não carrega o que já
-- estava aplicado antes. A causa exata da diferença (saldo anterior sem cadastro, resgates em duplicidade, etc.) ainda será analisada.
--
-- Solução PROVISÓRIA, definida com o Financeiro: um AJUSTE de saldo aplicado por empresa (tabela abaixo), SOMADO ao montante disponível, na tela
-- e nas RPCs de resgatar/editar resgate. O ajuste não gera movimento no Fluxo de Caixa nem mexe nas aplicações ou nos resgates cadastrados.
-- Quando a análise terminar e o cadastro estiver certo, basta apagar a linha do ajuste (ver ROLLBACK).
--
-- O ajuste de HAGG é calculado aqui para que o montante disponível passe a ser EXATAMENTE R$ 2.282.000,01 no momento da migration; os resgates
-- seguintes reduzem esse saldo normalmente.
--
-- Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   (as RPCs voltam às versões de 20261106003000: remova o "+ ajuste" delas)
--   DELETE FROM public."APLICACAO_FINANCEIRA_AJUSTE_SALDO" WHERE empresa_id = (SELECT id FROM public.empresas WHERE codigo = 'HAGG');  -- zera só o ajuste
--   DROP FUNCTION IF EXISTS public.aplicacao_financeira_ajuste_saldo(uuid);
--   DROP TABLE IF EXISTS public."APLICACAO_FINANCEIRA_AJUSTE_SALDO";
--   NOTIFY pgrst, 'reload schema';

-- 1) tabela do ajuste (um por empresa)
CREATE TABLE IF NOT EXISTS public."APLICACAO_FINANCEIRA_AJUSTE_SALDO" (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas(id),
  valor numeric NOT NULL,
  motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
ALTER TABLE public."APLICACAO_FINANCEIRA_AJUSTE_SALDO" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aplicacao_ajuste_saldo_select ON public."APLICACAO_FINANCEIRA_AJUSTE_SALDO";
CREATE POLICY aplicacao_ajuste_saldo_select ON public."APLICACAO_FINANCEIRA_AJUSTE_SALDO"
  FOR SELECT TO authenticated USING ((SELECT public.can_access((SELECT auth.uid()), 'financeiro-aplicacao-financeira', 'visualizar')));
-- gravação só por migration/DBA: sem policy de INSERT/UPDATE/DELETE
GRANT SELECT ON public."APLICACAO_FINANCEIRA_AJUSTE_SALDO" TO authenticated;

CREATE OR REPLACE FUNCTION public.aplicacao_financeira_ajuste_saldo(_empresa_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT valor FROM public."APLICACAO_FINANCEIRA_AJUSTE_SALDO" WHERE empresa_id = _empresa_id), 0);
$$;
REVOKE ALL ON FUNCTION public.aplicacao_financeira_ajuste_saldo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aplicacao_financeira_ajuste_saldo(uuid) TO authenticated;

-- 2) registrar resgate: o saldo disponível passa a incluir o ajuste
CREATE OR REPLACE FUNCTION public.aplicacao_financeira_resgatar_montante(
  _empresa_id uuid, _data_resgate date, _valor_principal numeric,
  _valor_rendimento numeric DEFAULT 0, _observacao text DEFAULT NULL, _banco_id uuid DEFAULT NULL,
  _contrato_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_total_aplicado numeric;
  v_total_resgatado_principal numeric;
  v_saldo_principal numeric;
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
  IF _contrato_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contratos WHERE id = _contrato_id) THEN
    RAISE EXCEPTION 'Centro de custo não encontrado.';
  END IF;

  SELECT COALESCE(SUM(valor_aplicado), 0) INTO v_total_aplicado
    FROM public."APLICACAO_FINANCEIRA" WHERE empresa_id = _empresa_id;
  SELECT COALESCE(SUM(valor_principal), 0) INTO v_total_resgatado_principal
    FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" WHERE empresa_id = _empresa_id;
  -- ajuste provisório do saldo aplicado (tabela APLICACAO_FINANCEIRA_AJUSTE_SALDO)
  v_saldo_principal := v_total_aplicado - v_total_resgatado_principal + public.aplicacao_financeira_ajuste_saldo(_empresa_id);

  IF _valor_principal > v_saldo_principal THEN
    RAISE EXCEPTION 'Valor do principal (R$ %) maior que o montante ativo disponível da empresa (R$ %).', _valor_principal, v_saldo_principal;
  END IF;

  INSERT INTO public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" (
    empresa_id, data_resgate, valor_principal, valor_rendimento, observacao, banco_id, contrato_id, created_by
  ) VALUES (
    _empresa_id, _data_resgate, _valor_principal, COALESCE(_valor_rendimento, 0), _observacao, _banco_id, _contrato_id, auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 3) editar resgate: idem
CREATE OR REPLACE FUNCTION public.aplicacao_financeira_resgate_editar(
  _id uuid, _data_resgate date, _valor_principal numeric,
  _valor_rendimento numeric DEFAULT 0, _observacao text DEFAULT NULL, _banco_id uuid DEFAULT NULL,
  _contrato_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_empresa uuid;
  v_aplicado numeric;
  v_outros numeric;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para editar resgate.';
  END IF;
  IF _valor_principal <= 0 THEN
    RAISE EXCEPTION 'Valor do principal resgatado deve ser positivo.';
  END IF;
  IF COALESCE(_valor_rendimento, 0) < 0 THEN
    RAISE EXCEPTION 'Valor de rendimento inválido.';
  END IF;
  IF _contrato_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contratos WHERE id = _contrato_id) THEN
    RAISE EXCEPTION 'Centro de custo não encontrado.';
  END IF;

  SELECT empresa_id INTO v_empresa FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" WHERE id = _id FOR UPDATE;
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'Resgate não encontrado.';
  END IF;

  SELECT COALESCE(SUM(valor_aplicado), 0) + public.aplicacao_financeira_ajuste_saldo(v_empresa) INTO v_aplicado
    FROM public."APLICACAO_FINANCEIRA" WHERE empresa_id = v_empresa;
  SELECT COALESCE(SUM(valor_principal), 0) INTO v_outros
    FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" WHERE empresa_id = v_empresa AND id <> _id;
  IF _valor_principal > v_aplicado - v_outros THEN
    RAISE EXCEPTION 'Valor do principal (R$ %) maior que o montante ativo disponível da empresa (R$ %).', _valor_principal, v_aplicado - v_outros;
  END IF;

  UPDATE public."APLICACAO_FINANCEIRA_RESGATE_CAIXA"
     SET data_resgate = _data_resgate, valor_principal = _valor_principal,
         valor_rendimento = COALESCE(_valor_rendimento, 0), observacao = _observacao,
         banco_id = COALESCE(_banco_id, banco_id),
         contrato_id = COALESCE(_contrato_id, contrato_id),
         updated_at = now(), updated_by = auth.uid()
   WHERE id = _id;
END;
$$;

-- 4) ajuste de HAGG: leva o montante disponível a R$ 2.282.000,01 (saldo aplicado informado pelo Financeiro, Sicredi, após o marco zero)
DO $$
DECLARE
  v_empresa uuid;
  v_calculado numeric;
  v_ajuste numeric;
BEGIN
  SELECT id INTO v_empresa FROM public.empresas WHERE codigo = 'HAGG';
  IF v_empresa IS NULL THEN RAISE NOTICE 'Empresa HAGG não encontrada: ajuste não lançado.'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public."APLICACAO_FINANCEIRA_AJUSTE_SALDO" WHERE empresa_id = v_empresa) THEN
    RAISE NOTICE 'Ajuste de HAGG já existe (valor %): nada a fazer.', public.aplicacao_financeira_ajuste_saldo(v_empresa);
    RETURN;
  END IF;
  SELECT COALESCE((SELECT SUM(valor_aplicado) FROM public."APLICACAO_FINANCEIRA" WHERE empresa_id = v_empresa), 0)
       - COALESCE((SELECT SUM(valor_principal) FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" WHERE empresa_id = v_empresa), 0)
    INTO v_calculado;
  v_ajuste := 2282000.01 - v_calculado;
  INSERT INTO public."APLICACAO_FINANCEIRA_AJUSTE_SALDO" (empresa_id, valor, motivo)
  VALUES (v_empresa, v_ajuste,
          'Provisório: saldo aplicado informado pelo Financeiro (Sicredi, após o marco zero) R$ 2.282.000,01; o cálculo do cadastro dava R$ ' || to_char(v_calculado, 'FM999G999G990D00')
          || '. Remover quando a análise do cadastro de aplicações/resgates estiver concluída.');
  RAISE NOTICE 'HAGG: calculado R$ %, ajuste R$ %, montante disponível agora R$ 2282000,01.', v_calculado, v_ajuste;
END $$;

NOTIFY pgrst, 'reload schema';
