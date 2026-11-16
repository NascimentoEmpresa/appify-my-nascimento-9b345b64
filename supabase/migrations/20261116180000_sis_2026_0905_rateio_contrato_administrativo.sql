-- SIS-2026-0905 — Malote → Fluxo de Caixa: Centro de Custo em branco ("—") em despesa administrativa
-- ============================================================================
-- O Centro de Custo do Fluxo de Caixa é o contrato da linha do rateio (malote_despesa_rateio_linha.contrato_id). Despesas lançadas como
-- "ADMINISTRATIVO - HAGG" (DM-2026-3711, 3791, 3792...) chegaram ao Fluxo com o contrato vazio e só a empresa preenchida. Investigado:
--   • o dado gravado É o que a tela mandou: a linha foi enviada com Empresa e SEM Contrato. A tela não conferia o contrato (só empresa e
--     fornecedor): numa classificação do tipo "contrato" a Empresa vem do Contrato, mas dava para escolher a Empresa antes de trocar a classificação
--     e enviar o Contrato vazio. Isso é corrigido no front (erroContratoNoRateio em PainelDespesaMalote e RatearClassificacao).
--   • em classificação ADMINISTRATIVA o contrato é só "Referência (opcional)" (SIS-2026-0341), e o rateio saía com contrato nulo quando ninguém
--     escolhia (e a troca de classificação ainda zera Contrato e Empresa da linha).
--
-- O que esta migration faz (a parte de banco):
--   1) Gatilho: linha de rateio de classificação do tipo ADMINISTRATIVO, sem contrato e com empresa, passa a gravar o contrato
--      "ADMINISTRATIVO - <código da empresa>" (HAGG, SN, NH, AGPS, LF, CANAA). Só preenche quando está vazio: contrato escolhido nunca é trocado, e
--      só quando a empresa tem EXATAMENTE esse contrato. Vale para todo caminho que grava o rateio (Criar Despesa, Ratear por Classificação,
--      importação do RH, ajustes). O Orçado da classificação administrativa não olha o contrato, então o orçamento não muda.
--   2) Recupera as linhas já afetadas, na mesma regra (só administrativas; as da classificação do tipo "contrato" NÃO são adivinhadas: lá o
--      contrato pode ser um contrato operacional e a informação original não foi gravada — a lista fica no NOTICE para correção manual).
-- Os relatórios (Fluxo, Auditoria, Lucratividade) leem essas linhas, então passam a considerar o Centro de Custo certo sem outra mudança.
--
-- Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS malote_rateio_contrato_administrativo ON public.malote_despesa_rateio_linha;
--   DROP FUNCTION IF EXISTS public.malote_rateio_preenche_contrato_administrativo();
--   (o preenchimento das linhas já recuperadas não é desfeito: nelas o contrato estava vazio e agora está ADMINISTRATIVO - <empresa>)
--   NOTIFY pgrst, 'reload schema';

-- 1) o contrato ADMINISTRATIVO da empresa, quando é um só
CREATE OR REPLACE FUNCTION public.malote_contrato_administrativo_da_empresa(_empresa uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(c.id))[1] END
    FROM public.contratos c
    JOIN public.empresas e ON e.id = c.empresa_id
   WHERE c.empresa_id = _empresa
     AND upper(btrim(c.nome)) = 'ADMINISTRATIVO - ' || upper(btrim(e.codigo));
$$;
REVOKE ALL ON FUNCTION public.malote_contrato_administrativo_da_empresa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_contrato_administrativo_da_empresa(uuid) TO authenticated;

-- 2) gatilho
CREATE OR REPLACE FUNCTION public.malote_rateio_preenche_contrato_administrativo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_empresa uuid;
  v_classificacao uuid;
  v_tipo text;
BEGIN
  IF NEW.contrato_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT COALESCE(NEW.empresa_id, d.empresa_id), COALESCE(NEW.classificacao_id, d.classificacao_id)
    INTO v_empresa, v_classificacao
    FROM public.malote_despesa d WHERE d.id = NEW.despesa_id;
  IF v_empresa IS NULL OR v_classificacao IS NULL THEN RETURN NEW; END IF;
  SELECT tipo INTO v_tipo FROM public.planejamento_orcamentario_classificacao WHERE id = v_classificacao;
  IF v_tipo IS DISTINCT FROM 'administrativo' THEN RETURN NEW; END IF;
  NEW.contrato_id := public.malote_contrato_administrativo_da_empresa(v_empresa);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS malote_rateio_contrato_administrativo ON public.malote_despesa_rateio_linha;
CREATE TRIGGER malote_rateio_contrato_administrativo
  BEFORE INSERT OR UPDATE OF contrato_id, empresa_id, classificacao_id ON public.malote_despesa_rateio_linha
  FOR EACH ROW EXECUTE FUNCTION public.malote_rateio_preenche_contrato_administrativo();

-- 3) recupera as linhas já afetadas (só classificação administrativa)
DO $$
DECLARE
  v_n integer;
  v_valor numeric;
  r record;
BEGIN
  WITH alvo AS (
    SELECT r2.id, public.malote_contrato_administrativo_da_empresa(COALESCE(r2.empresa_id, d.empresa_id)) AS contrato
      FROM public.malote_despesa_rateio_linha r2
      JOIN public.malote_despesa d ON d.id = r2.despesa_id AND d.deleted_at IS NULL
      JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = COALESCE(r2.classificacao_id, d.classificacao_id)
     WHERE r2.contrato_id IS NULL AND cl.tipo = 'administrativo' AND COALESCE(r2.empresa_id, d.empresa_id) IS NOT NULL
  ), atualiza AS (
    UPDATE public.malote_despesa_rateio_linha r3 SET contrato_id = alvo.contrato
      FROM alvo WHERE r3.id = alvo.id AND alvo.contrato IS NOT NULL
    RETURNING r3.valor
  )
  SELECT count(*), COALESCE(sum(valor), 0) INTO v_n, v_valor FROM atualiza;
  RAISE NOTICE 'SIS-2026-0905: % linha(s) de rateio administrativo recuperada(s) com o contrato ADMINISTRATIVO da empresa (R$ %).', v_n, v_valor;

  -- o que NÃO dá para adivinhar: classificação do tipo contrato sem contrato (despesa ainda viva, paga ou a pagar)
  FOR r IN
    SELECT d.numero, d.status, e.codigo AS empresa, cl.nome AS classificacao, round(r4.valor, 2) AS valor
      FROM public.malote_despesa_rateio_linha r4
      JOIN public.malote_despesa d ON d.id = r4.despesa_id AND d.deleted_at IS NULL AND d.status IN ('despesa_paga', 'aguardando_pagamento', 'ajuste_pagamento')
      JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = COALESCE(r4.classificacao_id, d.classificacao_id) AND cl.tipo = 'contrato'
      LEFT JOIN public.empresas e ON e.id = COALESCE(r4.empresa_id, d.empresa_id)
     WHERE r4.contrato_id IS NULL
     ORDER BY d.status, d.numero
  LOOP
    RAISE NOTICE 'REVISAR (classificação de contrato, sem contrato): % [%] % · % · R$ %', r.numero, r.status, r.empresa, r.classificacao, r.valor;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
