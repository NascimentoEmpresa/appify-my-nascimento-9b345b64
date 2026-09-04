-- =====================================================================
-- ESPAÇO DO COLABORADOR — a árvore levava 51 segundos
--
-- MEDIDO NO BANCO REAL (04/09/2026, chamando como usuário autenticado):
--   esp_col_arvore() → 51,6 s. Resultado correto (2.446 ativos = 2.126 em
--   contrato + 320 sem contrato), mas inútil: o PostgREST derruba a chamada
--   muito antes disso, e a tela só mostraria erro.
--
-- A CAUSA, E FUI EU QUE A INTRODUZI
--
--   Na 052 eu extraí a resolução do contrato para `esp_col_contrato_id()`,
--   com o argumento de que "a regra tem que morar num lugar só". O argumento
--   continua certo — o efeito colateral é que a função ficou:
--
--     • SECURITY DEFINER, e
--     • com SET search_path,
--
--   e QUALQUER uma das duas impede o planejador de fazer INLINE dela. Então
--   ela deixa de ser uma expressão que o Postgres pode otimizar e vira uma
--   caixa-preta invocada UMA VEZ POR LINHA — 2.446 vezes.
--
--   Pior: cada invocação varre `contratos` (65 linhas) calculando
--   `sup_norm_nome()` em cada uma — e essa também tem SET search_path, logo
--   também não inlina. Dá da ordem de 636 mil invocações de função para
--   responder uma pergunta sobre 2.446 pessoas e 65 contratos.
--
--   E o `esp_col_colaboradores` chamava a mesma função DUAS vezes por linha:
--   uma no SELECT e outra no WHERE.
--
-- A CORREÇÃO
--
--   Resolver o contrato como JOIN DE CONJUNTO, uma vez, em vez de chamada
--   por linha. `sup_norm_nome` passa a ser calculada ~5 mil vezes (2.446 × 2
--   + 65) em vez de 636 mil, e o casamento vira hash join contra uma tabela
--   de 65 linhas.
--
--   A PRECEDÊNCIA É IDÊNTICA à da função — "Descrição do Local", depois o
--   de-para, depois "Nome Filial" — porque mudar de caminho aqui mudaria
--   silenciosamente em que contrato as pessoas caem. Esta migration é sobre
--   tempo, não sobre semântica: os três números têm que continuar
--   2.446 / 2.126 / 320.
--
--   `esp_col_contrato_id()` CONTINUA EXISTINDO e não muda: para uma linha só
--   (esp_col_ficha) ela é o jeito certo, e é onde a regra segue documentada.
--   O que sai é o uso dela em varredura.
--
-- O DETALHE QUE PODERIA TER INFLADO AS CONTAGENS
--
--   A função devolve o primeiro contrato que casa (`LIMIT 1`). Um JOIN não
--   tem LIMIT: se dois contratos normalizarem para o mesmo nome, a pessoa
--   apareceria DUAS vezes e a contagem subiria sem ninguém notar. Por isso a
--   CTE de contratos usa DISTINCT ON (nome_norm) — uma linha por nome
--   normalizado, escolhida de forma determinística. O de-para não precisa
--   disso: `filial_nome` é PRIMARY KEY.
-- =====================================================================


-- ── 1. A árvore ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.esp_col_arvore()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.esp_col_exige_acesso();

  WITH ct AS MATERIALIZED (
    -- Uma linha por nome normalizado. DISTINCT ON é o que substitui o
    -- LIMIT 1 da função e impede o JOIN de duplicar pessoa.
    SELECT DISTINCT ON (public.sup_norm_nome(c.nome))
           public.sup_norm_nome(c.nome) AS nome_norm, c.id
      FROM public.contratos c
     ORDER BY public.sup_norm_nome(c.nome), c.nome
  ),
  pessoas AS MATERIALIZED (
    -- Mesma precedência de esp_col_contrato_id(): local → de-para → filial.
    -- As guardas de string vazia estão nos ON de propósito: sem elas, um
    -- contrato cujo nome normalize para '' casaria com todo mundo que está
    -- sem local preenchido.
    SELECT COALESCE(ctl.id, dp.contrato_id, ctf.id) AS contrato_id
      FROM public."EMPREGADOS" e
      LEFT JOIN ct ctl
             ON COALESCE(btrim(e."Descrição do Local"), '') <> ''
            AND ctl.nome_norm = public.sup_norm_nome(e."Descrição do Local")
      LEFT JOIN public.sup_empregado_contrato_depara dp
             ON dp.filial_nome = e."Nome Filial"
      LEFT JOIN ct ctf
             ON COALESCE(btrim(e."Nome Filial"), '') <> ''
            AND ctf.nome_norm = public.sup_norm_nome(e."Nome Filial")
     WHERE public.esp_col_esta_ativo(e."Situação")
       AND COALESCE(btrim(e."Nome"), '') <> ''
  ),
  totais AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE p.contrato_id IS NULL)::int AS sem
      FROM pessoas p
  ),
  cont_qtd AS (
    SELECT p.contrato_id, count(*)::int AS qtd
      FROM pessoas p
     WHERE p.contrato_id IS NOT NULL
     GROUP BY p.contrato_id
  ),
  posto_vivo AS (
    SELECT DISTINCT ON (pc.contrato_id, public.sup_norm_nome(pc.posto))
           pc.id, pc.contrato_id, btrim(pc.posto) AS posto, pc.servico,
           pc.qt_postos, pc.data_vigencia
      FROM public.planilha_custo pc
     WHERE pc.contrato_id IS NOT NULL
       AND pc.orexec = 'EXECUTADO'
       AND NOT COALESCE(pc.encerrado, false)
       AND pc.data_vigencia IS NOT NULL
       AND COALESCE(btrim(pc.posto), '') <> ''
     ORDER BY pc.contrato_id, public.sup_norm_nome(pc.posto), pc.data_vigencia DESC
  ),
  posto_local AS (
    SELECT l.planilha_custo_id,
           jsonb_agg(jsonb_build_object(
             'id', l.id, 'nome', l.nome, 'municipio', l.municipio, 'uf', l.uf,
             'orcadas', l.qt_pessoas_orcadas, 'executadas', l.qt_pessoas_executadas)
             ORDER BY l.nome) AS itens
      FROM public.planilha_posto_localizacao l
     GROUP BY l.planilha_custo_id
  ),
  postos AS (
    SELECT pv.contrato_id,
           jsonb_agg(jsonb_build_object(
             'id', pv.id, 'nome', pv.posto, 'servico', pv.servico,
             'vagas', pv.qt_postos, 'vigencia', pv.data_vigencia,
             'locais', COALESCE(pl.itens, '[]'::jsonb))
             ORDER BY pv.posto) AS itens,
           count(*)::int                           AS qtd_postos,
           sum(COALESCE(pv.qt_postos, 0))::numeric AS vagas
      FROM posto_vivo pv
      LEFT JOIN posto_local pl ON pl.planilha_custo_id = pv.id
     GROUP BY pv.contrato_id
  ),
  enc AS (
    -- Também sai do laço: era uma subconsulta correlacionada por contrato,
    -- com sup_norm_nome dos dois lados a cada linha.
    SELECT DISTINCT ON (public.sup_norm_nome(r.contrato))
           public.sup_norm_nome(r.contrato) AS nome_norm,
           r.encarregado_id, r.encarregado_nome
      FROM public."RH_CONTRATO_ENCARREGADO" r
     ORDER BY public.sup_norm_nome(r.contrato), r.contrato
  ),
  nos AS (
    SELECT c.nome AS ordem,
           COALESCE(cq.qtd, 0) AS qtd,
           COALESCE(c.status, 'ativo') = 'encerrado' AS encerrado,
           jsonb_build_object(
             'id', c.id, 'nome', c.nome, 'cliente', c.cliente, 'status', c.status,
             'encerrado',     COALESCE(c.status, 'ativo') = 'encerrado',
             'colaboradores', COALESCE(cq.qtd, 0),
             'qtd_postos',    COALESCE(pt.qtd_postos, 0),
             'vagas',         COALESCE(pt.vagas, 0),
             'encarregado_designado',
               CASE WHEN en.encarregado_id IS NULL THEN NULL
                    ELSE jsonb_build_object('id', en.encarregado_id, 'nome', en.encarregado_nome)
               END,
             'postos', COALESCE(pt.itens, '[]'::jsonb)) AS no
      FROM public.contratos c
      LEFT JOIN postos   pt ON pt.contrato_id = c.id
      LEFT JOIN cont_qtd cq ON cq.contrato_id = c.id
      LEFT JOIN enc      en ON en.nome_norm = public.sup_norm_nome(c.nome)
     WHERE COALESCE(c.status, 'ativo') <> 'encerrado'
        OR COALESCE(cq.qtd, 0) > 0
  ),
  agg AS (
    SELECT COALESCE(jsonb_agg(n.no ORDER BY n.ordem), '[]'::jsonb) AS contratos,
           COALESCE(count(*) FILTER (WHERE n.encerrado AND n.qtd > 0), 0)::int AS encerrados
      FROM nos n
  )
  SELECT jsonb_build_object(
           'contratos',            a.contratos,
           'sem_contrato',         t.sem,
           'total_ativos',         t.total,
           'encerrados_com_gente', a.encerrados)
    INTO v_out
    FROM agg a CROSS JOIN totais t;

  RETURN v_out;
END $fn$;

REVOKE ALL ON FUNCTION public.esp_col_arvore() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_arvore() TO authenticated;


-- ── 2. A lista de colaboradores ──────────────────────────────────────
--
-- Aqui a função por linha era chamada DUAS vezes: no SELECT e no WHERE.
-- Mesma troca por JOIN; a coluna `contrato_id` resolvida uma vez serve aos
-- dois usos.
CREATE OR REPLACE FUNCTION public.esp_col_colaboradores(
  p_contrato_id  uuid    DEFAULT NULL,
  p_busca        text    DEFAULT NULL,
  p_limite       int     DEFAULT 500,
  p_sem_contrato boolean DEFAULT false)
RETURNS TABLE (
  empregado_id bigint,
  matricula    text,
  nome         text,
  cargo        text,
  posto        text,
  local        text,
  filial       text,
  situacao     text,
  admissao     date,
  nivel        text,
  contrato_id  uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_lim    int := least(greatest(COALESCE(p_limite, 500), 1), 3000);
  v_termos text[];
BEGIN
  PERFORM public.esp_col_exige_acesso();

  v_termos := array_remove(string_to_array(public.sup_norm_busca(COALESCE(p_busca, '')), ' '), '');

  RETURN QUERY
  WITH ct AS MATERIALIZED (
    SELECT DISTINCT ON (public.sup_norm_nome(c.nome))
           public.sup_norm_nome(c.nome) AS nome_norm, c.id
      FROM public.contratos c
     ORDER BY public.sup_norm_nome(c.nome), c.nome
  ),
  base AS (
    SELECT e."ID"::bigint AS empregado_id,
           nullif(btrim(e."Cadastro"::text), '')  AS matricula,
           e."Nome"                               AS nome,
           e."Título do Cargo"                    AS cargo,
           e."Nome do Posto"                      AS posto,
           e."Descrição do Local"                 AS local,
           e."Nome Filial"                        AS filial,
           e."Situação"                           AS situacao,
           public.rh_data(e."Admissão"::text)     AS admissao,
           btrim(COALESCE(e."LIDER", ''))         AS nivel,
           COALESCE(ctl.id, dp.contrato_id, ctf.id) AS contrato_id
      FROM public."EMPREGADOS" e
      LEFT JOIN ct ctl
             ON COALESCE(btrim(e."Descrição do Local"), '') <> ''
            AND ctl.nome_norm = public.sup_norm_nome(e."Descrição do Local")
      LEFT JOIN public.sup_empregado_contrato_depara dp
             ON dp.filial_nome = e."Nome Filial"
      LEFT JOIN ct ctf
             ON COALESCE(btrim(e."Nome Filial"), '') <> ''
            AND ctf.nome_norm = public.sup_norm_nome(e."Nome Filial")
     WHERE public.esp_col_esta_ativo(e."Situação")
       AND COALESCE(btrim(e."Nome"), '') <> ''
       AND (cardinality(v_termos) = 0 OR NOT EXISTS (
              SELECT 1 FROM unnest(v_termos) t
               WHERE public.sup_norm_busca(e."Nome") NOT LIKE '%' || t || '%'))
  )
  SELECT b.empregado_id, b.matricula, b.nome, b.cargo, b.posto, b.local,
         b.filial, b.situacao, b.admissao, b.nivel, b.contrato_id
    FROM base b
   WHERE CASE
           WHEN p_sem_contrato        THEN b.contrato_id IS NULL
           WHEN p_contrato_id IS NULL THEN true
           ELSE b.contrato_id = p_contrato_id
         END
   ORDER BY b.nome
   LIMIT v_lim;
END $fn$;

REVOKE ALL ON FUNCTION public.esp_col_colaboradores(uuid, text, int, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_colaboradores(uuid, text, int, boolean) TO authenticated;


NOTIFY pgrst, 'reload schema';


-- ── Conferência ──────────────────────────────────────────────────────
-- Nada aqui pode lançar: no SQL Editor não há usuário autenticado, e uma
-- exceção solta abortaria a migration inteira (foi o que aconteceu na 057).
--
-- Os números TÊM QUE CONTINUAR OS MESMOS de antes desta migration:
--   total_ativos 2446 = em contrato 2126 + sem contrato 320
-- Se mudarem, o JOIN não reproduziu a precedência da função — o que esta
-- migration não podia fazer, porque ela é sobre tempo, não sobre semântica.
DO $teste$
DECLARE t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM public.esp_col_arvore();
  RAISE NOTICE '[esp_col] arvore OK em % ms', round(extract(epoch FROM clock_timestamp()-t0)*1000);
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE '[esp_col] parou na guarda de acesso (esperado no SQL Editor).';
  WHEN OTHERS THEN
    RAISE NOTICE '[esp_col] ERRO (%) -> %', SQLSTATE, SQLERRM;
END
$teste$;

-- A mesma resolução de contrato, agora set-based, contada fora da RPC.
-- Confere os três números sem precisar de sessão autenticada.
WITH ct AS MATERIALIZED (
  SELECT DISTINCT ON (public.sup_norm_nome(c.nome))
         public.sup_norm_nome(c.nome) AS nome_norm, c.id
    FROM public.contratos c
   ORDER BY public.sup_norm_nome(c.nome), c.nome
)
SELECT count(*)                                        AS total_ativos,
       count(COALESCE(ctl.id, dp.contrato_id, ctf.id)) AS em_contrato,
       count(*) - count(COALESCE(ctl.id, dp.contrato_id, ctf.id)) AS sem_contrato
  FROM public."EMPREGADOS" e
  LEFT JOIN ct ctl
         ON COALESCE(btrim(e."Descrição do Local"), '') <> ''
        AND ctl.nome_norm = public.sup_norm_nome(e."Descrição do Local")
  LEFT JOIN public.sup_empregado_contrato_depara dp
         ON dp.filial_nome = e."Nome Filial"
  LEFT JOIN ct ctf
         ON COALESCE(btrim(e."Nome Filial"), '') <> ''
        AND ctf.nome_norm = public.sup_norm_nome(e."Nome Filial")
 WHERE public.esp_col_esta_ativo(e."Situação")
   AND COALESCE(btrim(e."Nome"), '') <> '';


-- =====================================================================
-- ROLLBACK
--   Reexecutar a 20260930000056 devolve as duas funções às versões
--   anteriores (corretas, porém lentas). esp_col_contrato_id não é tocada
--   aqui, então não há o que restaurar nela.
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
