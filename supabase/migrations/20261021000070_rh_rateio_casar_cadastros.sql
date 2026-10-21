-- =========================================================================
-- RH › RATEIO DE DESPESAS — casar MATRÍCULA (sem CPF) com a EMPREGADOS
-- (21/10/2026)
--
-- O boleto do EMPRÉSTIMO CONSIGNADO da Soma Financeira (12/2025) traz a
-- "Relação de Eventos" da Senior: uma linha por colaborador com matrícula
-- (000007862), nome e valor — e NENHUM CPF. A tela só sabia casar CPF
-- (rh_rateio_casar_cpfs), então não lia nada e mandava digitar a base.
--
-- Esta RPC faz o mesmo que a de CPF, pela matrícula: recebe
-- [{chave, empresa, cadastro, nome}] (empresa = o código do cabeçalho
-- "0001 - NASCIMENTO … Pág.:" da Relação; pode vir nulo) e devolve nome,
-- situação e contrato de cada um. Casamento, do mais forte ao mais fraco:
--   3 = Empresa + Cadastro e o nome bate;   2 = Empresa + Cadastro;
--   1 = só o nome (sem acento/pontuação), e só se for UMA pessoa.
-- Sem empresa no PDF, Cadastro sozinho só vale se o nome também bater
-- (o mesmo número existe em empresas diferentes). Inclui demitidos (o
-- consignado segue sendo descontado na rescisão). Contrato pelo mesmo
-- caminho de rh_rateio_casar_cpfs (depara da filial → contrato pelo nome
-- normalizado → depara normalizado → local).
--
-- Conferido no espelho de 16/10 (Empresa 1): 7862 ADAO SERGIO DE SOUZA
-- PEREIRA → 1104 - CHARQUEADAS - 005.2021; 4157 PATRICIA ANDREIA DE OLIVEIRA
-- → 1112 - UFRGS AUXILIAR DE SAUDE BUCAL - 030.2026.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rh_rateio_casar_cadastros(_itens jsonb)
RETURNS TABLE(chave text, nome text, cadastro text, situacao text, contrato_id uuid, casou_por text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (public.rh_rateio_pode('incluir') OR public.rh_rateio_pode('alterar')) THEN
    RAISE EXCEPTION 'Sem permissão para lançar rateio' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_itens) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Lista inválida.'; END IF;
  IF jsonb_array_length(_itens) > 5000 THEN RAISE EXCEPTION 'No máximo 5.000 linhas por leitura'; END IF;

  RETURN QUERY
  WITH alvo AS (
    SELECT DISTINCT i->>'chave' AS k,
           CASE WHEN (i->>'empresa') ~ '^\d+$' THEN (i->>'empresa')::bigint END AS emp,
           CASE WHEN (i->>'cadastro') ~ '^\d+$' THEN (i->>'cadastro')::bigint END AS cad,
           public.sup_norm_nome(i->>'nome') AS nn
      FROM jsonb_array_elements(_itens) i
     WHERE coalesce(i->>'chave', '') <> ''
  ),
  -- O nome normalizado de cada cadastro, calculado UMA vez por linha da EMPREGADOS.
  todos AS MATERIALIZED (
    SELECT x."ID" AS id, x."Empresa" AS emp, x."Cadastro" AS cad, public.sup_norm_nome(x."Nome") AS nn
      FROM public."EMPREGADOS" x
  ),
  -- Pessoas por nome (para o casamento só por nome: tem de ser uma só).
  por_nome AS MATERIALIZED (
    SELECT t.nn, count(DISTINCT (t.emp, t.cad)) AS pessoas
      FROM todos t WHERE t.nn IN (SELECT a.nn FROM alvo a WHERE a.nn IS NOT NULL)
     GROUP BY t.nn
  ),
  cand AS (
    SELECT a.k, t.id,
           CASE WHEN a.cad IS NOT NULL AND t.cad = a.cad AND a.emp IS NOT NULL AND t.emp = a.emp AND t.nn = a.nn THEN 3
                WHEN a.cad IS NOT NULL AND t.cad = a.cad AND a.emp IS NOT NULL AND t.emp = a.emp THEN 2
                WHEN a.cad IS NOT NULL AND t.cad = a.cad AND a.emp IS NULL AND t.nn = a.nn THEN 2
                WHEN t.nn = a.nn AND (SELECT p.pessoas FROM por_nome p WHERE p.nn = a.nn) = 1 THEN 1
           END AS pts
      FROM alvo a
      JOIN todos t ON (a.cad IS NOT NULL AND t.cad = a.cad) OR (a.nn IS NOT NULL AND t.nn = a.nn)
  ),
  e AS MATERIALIZED (
    SELECT DISTINCT ON (c.k) c.k, c.pts, x."Nome", x."Cadastro", x."Situação", x."Nome Filial", x."Descrição do Local",
           public.rh_norm_contrato(x."Nome Filial") AS nn_filial,
           public.rh_norm_contrato(x."Descrição do Local") AS nn_local
      FROM cand c
      JOIN public."EMPREGADOS" x ON x."ID" = c.id
     WHERE c.pts IS NOT NULL
     ORDER BY c.k, c.pts DESC, public.esp_col_esta_ativo(x."Situação") DESC,
              public.rh_ac_conta_no_posto(x."Situação") DESC, x."ID" DESC
  ),
  ct AS MATERIALIZED (
    SELECT DISTINCT ON (public.rh_norm_contrato(c.nome)) public.rh_norm_contrato(c.nome) AS nn, c.id
      FROM public.contratos c
     WHERE public.rh_norm_contrato(c.nome) IS NOT NULL
     ORDER BY public.rh_norm_contrato(c.nome), (COALESCE(c.status, 'ativo') = 'encerrado'), c.created_at DESC
  ),
  dp_nome AS MATERIALIZED (
    SELECT DISTINCT ON (d.filial_nome) d.filial_nome, d.contrato_id
      FROM public.sup_empregado_contrato_depara d ORDER BY d.filial_nome, d.contrato_id
  ),
  dp_nn AS MATERIALIZED (
    SELECT DISTINCT ON (public.rh_norm_contrato(d.filial_nome)) public.rh_norm_contrato(d.filial_nome) AS nn, d.contrato_id
      FROM public.sup_empregado_contrato_depara d
     WHERE public.rh_norm_contrato(d.filial_nome) IS NOT NULL
     ORDER BY public.rh_norm_contrato(d.filial_nome), d.contrato_id
  )
  SELECT e.k, e."Nome", e."Cadastro"::text, e."Situação",
         COALESCE(d1.contrato_id, c1.id, d2.contrato_id, c2.id),
         CASE e.pts WHEN 3 THEN 'matricula_nome' WHEN 2 THEN 'matricula' ELSE 'nome' END
    FROM e
    LEFT JOIN dp_nome d1 ON d1.filial_nome = e."Nome Filial"
    LEFT JOIN ct c1      ON c1.nn = e.nn_filial
    LEFT JOIN dp_nn d2   ON d2.nn = e.nn_filial
    LEFT JOIN ct c2      ON c2.nn = e.nn_local;
END $$;
REVOKE ALL ON FUNCTION public.rh_rateio_casar_cadastros(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_rateio_casar_cadastros(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Conferência (logado com o Rateio de Despesas):
--   SELECT * FROM public.rh_rateio_casar_cadastros(
--     '[{"chave":"1","empresa":1,"cadastro":"7862","nome":"ADAO SERGIO DE SOUZA PEREIRA"}]');
--   → ADAO SERGIO DE SOUZA PEREIRA, Demitido, contrato de 1104 - CHARQUEADAS.

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.rh_rateio_casar_cadastros(jsonb);
-- NOTIFY pgrst, 'reload schema';
