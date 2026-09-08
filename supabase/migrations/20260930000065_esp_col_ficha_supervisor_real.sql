-- =====================================================================
-- ESPAÇO DO COLABORADOR — a ficha mostra o supervisor de verdade
--
-- A ficha tinha o campo "Encarregado do contrato" lendo
-- `RH_CONTRATO_ENCARREGADO`. Aquela tabela está VAZIA, nenhuma tela escreve
-- nela e o módulo que a alimentava (RH > Hierarquia) foi descontinuado em
-- jul/2026 — o próprio App.tsx registra que ela "pode ser dropada". Ou seja:
-- o campo mostrava "—" para todo mundo e mostraria para sempre.
--
-- Campo que nunca preenche é pior que campo ausente: ensina o usuário a
-- ignorar aquele espaço da tela, e um dia ele ignora um que importa.
--
-- Em vez de só apagar, passa a ler a `operacao_designacao` (20260930000064),
-- que tem 47 contratos com supervisor designado. E devolve também se a
-- pessoa continua ativa: assim a ficha pode dizer "supervisor designado não
-- está mais na empresa" em vez de exibir um nome que não trabalha mais aqui.
-- =====================================================================

DROP FUNCTION IF EXISTS public.esp_col_ficha(text);
CREATE FUNCTION public.esp_col_ficha(p_ref text)
RETURNS TABLE (
  empregado_id       bigint,
  matricula          text,
  nome               text,
  cargo              text,
  posto              text,
  local              text,
  filial             text,
  empresa            text,
  setor              text,
  situacao           text,
  admissao           date,
  escala             text,
  nivel              text,
  contrato_id        uuid,
  contrato_nome      text,
  supervisor_nome    text,
  supervisor_ativo   boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_ref text := btrim(COALESCE(p_ref, ''));
  v_num bigint;
BEGIN
  PERFORM public.esp_col_exige_acesso();
  IF v_ref = '' THEN RETURN; END IF;

  v_num := CASE WHEN v_ref ~ '^[0-9]+$' THEN v_ref::bigint ELSE NULL END;

  RETURN QUERY
  SELECT e."ID"::bigint,
         nullif(btrim(e."Cadastro"::text), ''),
         e."Nome",
         e."Título do Cargo",
         e."Nome do Posto",
         e."Descrição do Local",
         e."Nome Filial",
         e."Nome da Empresa",
         e."Setor_ERP",
         e."Situação",
         public.rh_data(e."Admissão"::text),
         e."Escala",
         btrim(COALESCE(e."LIDER", '')),
         ct.id,
         ct.nome,
         sup.nome_sup,
         sup.ativo_sup
    FROM public."EMPREGADOS" e
    LEFT JOIN public.contratos ct
           ON ct.id = public.esp_col_contrato_id(e."Descrição do Local", e."Nome Filial")
    -- LEFT JOIN LATERAL para o supervisor do contrato DA PESSOA. Designação
    -- do contrato inteiro (posto IS NULL) — a de posto é do encarregado.
    LEFT JOIN LATERAL (
      SELECT COALESCE(es."Nome", d.empregado_nome) AS nome_sup,
             COALESCE(public.esp_col_esta_ativo(es."Situação"), false) AS ativo_sup
        FROM public.operacao_designacao d
        LEFT JOIN public."EMPREGADOS" es ON es."ID" = d.empregado_id
       WHERE d.contrato_id = ct.id
         AND d.papel = 'supervisor'
         AND d.posto IS NULL
         AND d.vigente_ate IS NULL
       LIMIT 1
    ) sup ON true
   WHERE btrim(e."Cadastro"::text) = v_ref
      OR (v_num IS NOT NULL AND e."ID" = v_num)
   ORDER BY (btrim(e."Cadastro"::text) = v_ref) DESC
   LIMIT 1;
END $fn$;

REVOKE ALL ON FUNCTION public.esp_col_ficha(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_ficha(text) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ── Conferência (nada aqui pode lançar) ──────────────────────────────
--
-- Chamar esp_col_ficha() direto abortaria esta migration: no SQL Editor não
-- há usuário autenticado, a guarda levanta 42501, e exceção solta desfaz a
-- transação inteira. Já aconteceu na 057, e aconteceu de novo ao escrever
-- este arquivo — por isso o teste vive num DO com EXCEPTION.
DO $teste$
BEGIN
  PERFORM public.esp_col_ficha('9768');
  RAISE NOTICE '[esp_col] ficha executou completa (havia sessão autenticada).';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE '[esp_col] ficha OK — parou na guarda (esperado no SQL Editor).';
  WHEN OTHERS THEN
    RAISE NOTICE '[esp_col] ficha FALHOU (%) -> %', SQLSTATE, SQLERRM;
END
$teste$;

-- Sem sessão, a conferência útil é sobre a fonte nova: quantos contratos têm
-- supervisor designado, e quantos deles com a pessoa já inativa.
SELECT count(*)                                                              AS designacoes_vivas,
       count(*) FILTER (WHERE NOT COALESCE(public.esp_col_esta_ativo(e."Situação"), false)) AS com_pessoa_inativa
  FROM public.operacao_designacao d
  LEFT JOIN public."EMPREGADOS" e ON e."ID" = d.empregado_id
 WHERE d.vigente_ate IS NULL AND d.papel = 'supervisor';


-- =====================================================================
-- ROLLBACK
--   Reexecutar 20260930000059 devolve esp_col_ficha à versão anterior
--   (14 colunas, lendo RH_CONTRATO_ENCARREGADO). Derrube a de 17 antes:
--   DROP FUNCTION IF EXISTS public.esp_col_ficha(text);
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
