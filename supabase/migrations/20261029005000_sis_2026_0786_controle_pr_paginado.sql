-- =========================================================================
-- SIS-2026-0786 — CONTROLE DE PULL REQUESTS: PAGINAÇÃO NO BANCO  (29/10/2026)
--
-- A mig 20261029004900 devolvia TODAS as PRs numa chamada e a tela filtrava e
-- paginava no navegador. Pedido do Eduardo ao testar: paginar no banco, sem
-- trazer a tabela inteira a cada abertura. Agora busca, desenvolvedor,
-- período, com/sem chamado e a página vão como parâmetro, e a RPC devolve só
-- a página pedida + o total.
--
-- (Os "só 11 PRs, até 09/10" do teste não eram do filtro: o cache parou na
-- PR #837, de 09/10, e a carga do histórico ainda não tinha entrado.)
--
-- Período = dia de Brasília do merge, inclusivo nas duas pontas: merge às
-- 22h30 de Brasília (01h30 UTC do dia seguinte) conta no dia em que foi feito.
--
-- A assinatura muda, então a função antiga sai (DROP) — só esta tela a usa.
-- Só leitura (STABLE): o PostgREST pode rodar em transação read-only.
-- Idempotente.
-- =========================================================================

-- Busca sem acento. O banco não tem a extensão unaccent; translate cobre o
-- português.
CREATE OR REPLACE FUNCTION public.dev_github_sem_acento(_t text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT translate(lower(coalesce(_t, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')
$$;
REVOKE ALL ON FUNCTION public.dev_github_sem_acento(text) FROM PUBLIC, anon;

DROP FUNCTION IF EXISTS public.dev_github_controle_pr();

CREATE OR REPLACE FUNCTION public.dev_github_controle_pr(
  _busca          text    DEFAULT NULL,
  _desenvolvedor  text    DEFAULT NULL,
  _de             date    DEFAULT NULL,
  _ate            date    DEFAULT NULL,
  _chamado        text    DEFAULT 'todas',   -- todas | com | sem
  _pagina         integer DEFAULT 1,
  _por_pagina     integer DEFAULT 20
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _pp     integer := least(greatest(coalesce(_por_pagina, 20), 1), 500);   -- 500 = lote do Exportar CSV
  _termo  text    := public.dev_github_sem_acento(regexp_replace(trim(coalesce(_busca, '')), '^#', ''));
  _ch     text    := coalesce(_chamado, 'todas');
  _r      jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'sistemas_controle_pr', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Controle de Pull Requests.' USING ERRCODE = '42501';
  END IF;
  IF _ch NOT IN ('todas', 'com', 'sem') THEN
    RAISE EXCEPTION 'Filtro de chamado inválido: %', _chamado USING ERRCODE = '22023';
  END IF;

  WITH base AS (
    -- Todas as PRs mergeadas na main, já com o nome do ERP e o chamado.
    SELECT pr.numero, pr.titulo, pr.url, pr.autor_login, pr.autor_avatar,
           COALESCE(NULLIF(trim(p.display_name), ''), NULLIF(trim(u.nome), ''), pr.autor_login, 'desconhecido') AS desenvolvedor,
           pr.chamado, c.id AS chamado_id, c.assunto AS chamado_assunto,
           pr.commits, pr.adicoes, pr.remocoes, pr.arquivos, pr.mergeado_em
      FROM public."DEV_GITHUB_PR" pr
      LEFT JOIN public."DEV_GITHUB_USUARIO" u ON lower(u.login) = lower(pr.autor_login)
      LEFT JOIN public.profiles p ON p.id = u.profile_id
      LEFT JOIN LATERAL (
        SELECT ch.id, ch.assunto FROM public."CHAMADO_SISTEMA" ch WHERE ch.numero = pr.chamado LIMIT 1
      ) c ON true
     WHERE pr.estado = 'merged' AND pr.branch_destino = 'main' AND pr.mergeado_em IS NOT NULL
  ),
  filtrada AS (
    SELECT b.* FROM base b
     WHERE (_desenvolvedor IS NULL OR b.desenvolvedor = _desenvolvedor)
       AND (_ch = 'todas' OR (_ch = 'com') = (b.chamado IS NOT NULL))
       AND (_de  IS NULL OR (b.mergeado_em AT TIME ZONE 'America/Sao_Paulo')::date >= _de)
       AND (_ate IS NULL OR (b.mergeado_em AT TIME ZONE 'America/Sao_Paulo')::date <= _ate)
       AND (_termo = '' OR strpos(public.dev_github_sem_acento(concat_ws(' ',
              b.numero, b.titulo, b.chamado, b.chamado_assunto, b.desenvolvedor, b.autor_login)), _termo) > 0)
  ),
  tot AS (SELECT count(*)::integer AS n FROM filtrada),
  -- Página além da última volta para a última (ex.: filtro novo com menos resultados).
  pg AS (SELECT least(greatest(coalesce(_pagina, 1), 1), greatest(ceil(tot.n::numeric / _pp)::integer, 1)) AS p FROM tot)
  SELECT jsonb_build_object(
           'total', tot.n,
           'pagina', pg.p,
           'por_pagina', _pp,
           -- Lista do filtro de desenvolvedor: sempre a completa, não a filtrada.
           'desenvolvedores', (SELECT coalesce(jsonb_agg(DISTINCT b.desenvolvedor ORDER BY b.desenvolvedor), '[]'::jsonb) FROM base b),
           'prs', (SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.mergeado_em DESC, f.numero DESC), '[]'::jsonb)
                     FROM (SELECT * FROM filtrada
                            ORDER BY mergeado_em DESC, numero DESC
                            LIMIT _pp OFFSET (pg.p - 1) * _pp) f))
    INTO _r
    FROM tot, pg;

  RETURN _r;
END $$;
REVOKE ALL ON FUNCTION public.dev_github_controle_pr(text, text, date, date, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dev_github_controle_pr(text, text, date, date, text, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (volta a versão sem parâmetros da mig 20261029004900)
-- DROP FUNCTION IF EXISTS public.dev_github_controle_pr(text, text, date, date, text, integer, integer);
-- DROP FUNCTION IF EXISTS public.dev_github_sem_acento(text);
-- e recriar dev_github_controle_pr() copiando o bloco 4 da 20261029004900.
-- NOTIFY pgrst, 'reload schema';
