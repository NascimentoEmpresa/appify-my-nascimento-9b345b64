-- =========================================================================
-- TV LICITAÇÕES — "Desempenho da equipe — Meta por analista" (15/10/2026)
--
-- Chamado (com a imagem da TV): "ajustar o dashboard da licitação conforme
-- imagem em anexo, ele deve seguir as regras:
--   - ser possível colocar as pessoas que vão ter que cumprir as metas;
--   - ser possível definir as metas;
--   - o acompanhamento da meta deve ser pela tela da capa de edital, só os
--     contratos que estiverem como ganho a partir de 01/09/2026, deve pegar o
--     responsável, e dividir o valor estimado pelo prazo do contrato; se a
--     meta for por contrato então deve somar a quantidade de contratos ganhos."
--
--   "TVG_META_EQUIPE": quem cumpre a meta, de que tipo (valor ou contratos),
--   quanto, desde quando contam os ganhos (padrão 01/09/2026) e os NOMES COMO
--   ESTÃO NA CAPA — o responsável é texto livre e aparece de vários jeitos
--   ("Camila Kuhn" / "CAMILA CAMPOS KUHN"); a comparação ignora acento e
--   maiúscula, mas o apelido tem que estar na lista.
--
--   Realizado (tvg_equipe_meta), por capa_edital com status "Ganhamos":
--     ganho em = data_homologacao (preenchida ao ganhar), senão a data da troca
--                de status no histórico, senão updated_at;
--     valor    = valor_estimado ÷ meses do prazo_contrato ("12 meses",
--                "2 anos"); sem prazo informado, 12 meses (a linha diz isso);
--     contratos = quantidade de capas ganhas.
--   tvg_painel passa a devolver `equipe` (vazio para painel sem meta).
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."TVG_META_EQUIPE" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  painel        text NOT NULL DEFAULT 'ger-licitacoes',
  nome          text NOT NULL,
  nomes_capa    text[] NOT NULL DEFAULT '{}',
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tipo          text NOT NULL DEFAULT 'valor' CHECK (tipo IN ('valor', 'contratos')),
  meta          numeric(16,2) NOT NULL CHECK (meta > 0),
  ganhos_desde  date NOT NULL DEFAULT DATE '2026-09-01',
  cor           text,
  ordem         integer NOT NULL DEFAULT 100,
  ativo         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid
);
ALTER TABLE public."TVG_META_EQUIPE" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tvg_meta_equipe_select ON public."TVG_META_EQUIPE";
CREATE POLICY tvg_meta_equipe_select ON public."TVG_META_EQUIPE" FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar'));
REVOKE ALL ON public."TVG_META_EQUIPE" FROM anon;

-- Nome comparável: sem acento, maiúsculo, espaços simples.
CREATE OR REPLACE FUNCTION public.tvg_nome_norm(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT nullif(regexp_replace(upper(translate(btrim(coalesce(p, '')),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '\s+', ' ', 'g'), '');
$fn$;

-- "941362.32" | "R$ 1.234.567,89" | "1.234,56" -> numeric.
CREATE OR REPLACE FUNCTION public.tvg_valor_texto(p text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $fn$
DECLARE t text := regexp_replace(coalesce(p, ''), '[^0-9,.\-]', '', 'g');
BEGIN
  IF t = '' THEN RETURN NULL; END IF;
  IF t ~ ',' THEN t := replace(replace(t, '.', ''), ',', '.');
  ELSIF t ~ '\.\d{3}(\.|$)' AND t !~ '\.\d{1,2}$' THEN t := replace(t, '.', '');
  END IF;
  RETURN t::numeric;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $fn$;

-- "12 meses" -> 12 · "2 anos" -> 24 · "60" -> 60 · vazio -> NULL.
CREATE OR REPLACE FUNCTION public.tvg_prazo_meses(p text)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $fn$
DECLARE n numeric; t text := lower(coalesce(p, ''));
BEGIN
  n := nullif(substring(t from '(\d+(?:[.,]\d+)?)'), '')::numeric;
  IF n IS NULL OR n <= 0 THEN RETURN NULL; END IF;
  IF t ~ 'ano' THEN n := n * 12; ELSIF t ~ 'dia' THEN n := n / 30.0; END IF;
  RETURN greatest(1, round(n))::int;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $fn$;

CREATE OR REPLACE FUNCTION public.tvg_equipe_meta(p_painel text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  WITH ganhos AS (
    SELECT c.id, c.objeto, c.cidade, c.cliente, c.responsavel, public.tvg_nome_norm(c.responsavel) AS resp_norm,
           public.tvg_valor_texto(c.valor_estimado) AS valor,
           public.tvg_prazo_meses(c.prazo_contrato) AS prazo,
           COALESCE(c.data_homologacao::date,
                    (SELECT to_date(left(h->>'ts', 10), 'DD/MM/YYYY') FROM jsonb_array_elements(COALESCE(c.historico, '[]'::jsonb)) h
                      WHERE h->>'campo' = 'Status' AND h->>'para' = 'Ganhamos' ORDER BY to_date(left(h->>'ts', 10), 'DD/MM/YYYY') DESC LIMIT 1),
                    c.updated_at::date) AS ganho_em
      FROM public.capa_edital c
     WHERE c.status::text = 'Ganhamos'
  ),
  pessoa AS (
    SELECT m.*, (SELECT array_agg(public.tvg_nome_norm(x)) FROM unnest(m.nomes_capa || ARRAY[m.nome]) x) AS nomes_norm,
           (SELECT p.avatar_url FROM public.profiles p WHERE p.id = m.user_id) AS foto
      FROM public."TVG_META_EQUIPE" m
     WHERE m.painel = p_painel AND m.ativo
  ),
  conta AS (
    SELECT pe.id,
           COALESCE(jsonb_agg(jsonb_build_object(
             'objeto', coalesce(nullif(btrim(g.objeto), ''), g.cidade, 'Edital'), 'cidade', g.cidade, 'cliente', g.cliente,
             'ganho_em', g.ganho_em, 'valor_estimado', g.valor, 'prazo_meses', coalesce(g.prazo, 12),
             'prazo_assumido', g.prazo IS NULL, 'mensal', round(coalesce(g.valor, 0) / coalesce(g.prazo, 12), 2))
             ORDER BY g.ganho_em DESC) FILTER (WHERE g.id IS NOT NULL), '[]'::jsonb) AS itens,
           count(g.id) AS contratos,
           COALESCE(sum(coalesce(g.valor, 0) / coalesce(g.prazo, 12)), 0) AS valor_mensal
      FROM pessoa pe
      LEFT JOIN ganhos g ON g.resp_norm = ANY (pe.nomes_norm) AND g.ganho_em >= pe.ganhos_desde
     GROUP BY pe.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', pe.id, 'nome', pe.nome, 'foto', pe.foto, 'cor', pe.cor, 'tipo', pe.tipo, 'meta', pe.meta,
           'ganhos_desde', pe.ganhos_desde,
           'realizado', CASE WHEN pe.tipo = 'contratos' THEN c.contratos ELSE round(c.valor_mensal, 2) END,
           'contratos', c.contratos, 'valor_mensal', round(c.valor_mensal, 2),
           'pct', round(100 * (CASE WHEN pe.tipo = 'contratos' THEN c.contratos ELSE c.valor_mensal END) / pe.meta, 1),
           'itens', c.itens) ORDER BY pe.ordem, pe.nome), '[]'::jsonb)
    FROM pessoa pe JOIN conta c ON c.id = pe.id;
$fn$;
REVOKE ALL ON FUNCTION public.tvg_equipe_meta(text) FROM PUBLIC, anon, authenticated;

-- A TV recebe a equipe junto com o painel.
CREATE OR REPLACE FUNCTION public.tvg_painel(p_painel text)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem acesso aos Indicadores gerenciais das TVs.' USING ERRCODE = '42501';
  END IF;
  RETURN public.tvg_painel_dados(p_painel) || jsonb_build_object('equipe', public.tvg_equipe_meta(p_painel));
END $function$;

-- ── Gestão (Indicadores gerenciais › Metas da equipe) ─────────────────────
CREATE OR REPLACE FUNCTION public.tvg_meta_equipe_salvar(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_id uuid := nullif(p->>'id', '')::uuid;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar as metas (Indicadores gerenciais › Alterar).' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p->>'nome'), '') IS NULL THEN RAISE EXCEPTION 'Informe o nome.'; END IF;
  IF coalesce((p->>'meta')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'Informe a meta.'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public."TVG_META_EQUIPE" (painel, nome, nomes_capa, user_id, tipo, meta, ganhos_desde, cor, ordem, updated_by)
    VALUES (coalesce(nullif(p->>'painel', ''), 'ger-licitacoes'), btrim(p->>'nome'),
            coalesce(ARRAY(SELECT btrim(x) FROM jsonb_array_elements_text(p->'nomes_capa') x WHERE btrim(x) <> ''), '{}'),
            nullif(p->>'user_id', '')::uuid, coalesce(nullif(p->>'tipo', ''), 'valor'), (p->>'meta')::numeric,
            coalesce(nullif(p->>'ganhos_desde', '')::date, DATE '2026-09-01'), nullif(p->>'cor', ''),
            coalesce(nullif(p->>'ordem', '')::int, 100), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public."TVG_META_EQUIPE" SET
      nome = btrim(p->>'nome'),
      nomes_capa = coalesce(ARRAY(SELECT btrim(x) FROM jsonb_array_elements_text(p->'nomes_capa') x WHERE btrim(x) <> ''), '{}'),
      user_id = nullif(p->>'user_id', '')::uuid, tipo = coalesce(nullif(p->>'tipo', ''), 'valor'), meta = (p->>'meta')::numeric,
      ganhos_desde = coalesce(nullif(p->>'ganhos_desde', '')::date, DATE '2026-09-01'), cor = nullif(p->>'cor', ''),
      ordem = coalesce(nullif(p->>'ordem', '')::int, ordem), ativo = coalesce((p->>'ativo')::boolean, ativo),
      updated_at = now(), updated_by = auth.uid()
     WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Meta não encontrada.'; END IF;
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_meta_equipe_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tvg_meta_equipe_salvar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.tvg_meta_equipe_excluir(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar as metas (Indicadores gerenciais › Alterar).' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public."TVG_META_EQUIPE" WHERE id = p_id;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_meta_equipe_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tvg_meta_equipe_excluir(uuid) TO authenticated;

-- Os nomes de responsável que existem na Capa de Edital (para a tela sugerir).
CREATE OR REPLACE FUNCTION public.tvg_responsaveis_capa()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE WHEN public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') THEN
    COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', r, 'editais', n, 'ganhos', g) ORDER BY r)
                FROM (SELECT btrim(responsavel) r, count(*) n, count(*) FILTER (WHERE status::text = 'Ganhamos') g
                        FROM public.capa_edital WHERE nullif(btrim(responsavel), '') IS NOT NULL GROUP BY 1) x), '[]'::jsonb)
  ELSE '[]'::jsonb END;
$fn$;
REVOKE ALL ON FUNCTION public.tvg_responsaveis_capa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tvg_responsaveis_capa() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (reaplicar tvg_painel da 20261014000044 — sem a chave equipe)
-- DROP FUNCTION IF EXISTS public.tvg_responsaveis_capa(), public.tvg_meta_equipe_excluir(uuid), public.tvg_meta_equipe_salvar(jsonb),
--   public.tvg_equipe_meta(text), public.tvg_prazo_meses(text), public.tvg_valor_texto(text), public.tvg_nome_norm(text);
-- DROP TABLE IF EXISTS public."TVG_META_EQUIPE";
-- NOTIFY pgrst, 'reload schema';
