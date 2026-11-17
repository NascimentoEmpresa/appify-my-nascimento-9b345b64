-- =========================================================================
-- TVs: PLAYLIST DA PRESIDÊNCIA — TODOS OS SETORES (18/11/2026)
--
-- Pablo: "Preciso desenvolver uma playlist pra PRESIDÊNCIA onde fique
-- passando informações de todas TVs, que passe as informações de todos
-- setores."
--
-- Copiar os itens das playlists dos setores numa playlist nova resolveria
-- hoje e envelheceria amanhã: cada setor mexe na sua, e a da Presidência
-- ficaria com a versão velha (e com o item duplicado, que a exclusão de um
-- lado apagaria a imagem do bucket do outro). Por isso, item novo:
--
--   tipo 'playlist' (TV_ITEM.inclui_playlist_id) — "Outra playlist": no lugar
--   dele a TV toca os itens no ar da playlist incluída, na ordem dela. Mudou
--   a playlist do setor, a da Presidência acompanha sozinha.
--
-- Regras (as mesmas de expandirPlaylist em src/lib/tv/tv.ts, com teste em
-- src/test/tv-playlist-inclui.test.ts):
--   · um nível só: item "Outra playlist" dentro da playlist incluída é
--     ignorado (sem laço infinito nem playlist que inclui a si mesma);
--   · o tempo do item de inclusão é o TETO de cada item incluído. Os painéis
--     dos setores estão com 3600 s (giram sozinhos a tarde toda numa TV só
--     deles); na Presidência cada um fica no máximo o teto e passa a vez.
--     Vídeo toca até o fim, como sempre;
--   · ativo/validade valem nos dois lados (o da inclusão e o do item).
--
-- tv_estado entrega a lista já aberta (tv_itens_no_ar): o player não muda.
-- tv_relatorio passa a aceitar relatório de playlist incluída pela da TV;
-- tv_recarregar_relatorios também alcança a TV que inclui a área.
--
-- Consultas: o player só chama tv_relatorio ao mostrar um relatório cujo
-- cache (1 h, TvRelatorio.tsx) venceu — a TV da Presidência com ~13
-- relatórios faz no máximo ~13 por hora (~310/dia), dentro do teto de 2 mil
-- por dia de todas as TVs (ver INTERVALO_PING_S em src/lib/tv/tv.ts).
--
-- Depois, com o print do Relatório Geral: "A tv tem que aparecer tipo isso,
-- mas mais bonito, completo e detalhado" — o relatório 'geral' da TV ganha
-- o Turn-over (tv_relatorio, abaixo) e uma página de
-- Comparativo (front), e abre a playlist.
--
-- A playlist "Presidência — Todos os setores" nasce com a Visão geral e incluindo as playlists
-- que estão nas TVs dos setores (+ TV DIRETORIA, a visão da Presidência, e
-- Controladoria, que tem playlist mas ainda não tem TV). Ficam de fora as
-- antigas que foram substituídas (TV COMPRAS, TV FINANCEIRO, TV OPERACIONAL,
-- TV RH: nenhuma TV usa). Nenhuma TV é trocada: escolher a TV é na tela.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Item "Outra playlist" ─────────────────────────────────────────────
ALTER TABLE public."TV_ITEM" ADD COLUMN IF NOT EXISTS inclui_playlist_id uuid REFERENCES public."TV_PLAYLIST"(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_tv_item_inclui_playlist ON public."TV_ITEM" (inclui_playlist_id) WHERE inclui_playlist_id IS NOT NULL;

ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS "TV_ITEM_tipo_check";
ALTER TABLE public."TV_ITEM" ADD CONSTRAINT "TV_ITEM_tipo_check"
  CHECK (tipo IN ('imagem', 'video', 'url', 'youtube', 'aviso', 'relatorio', 'playlist'));
ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS tv_item_inclui_playlist_check;
ALTER TABLE public."TV_ITEM" ADD CONSTRAINT tv_item_inclui_playlist_check CHECK (
  (tipo = 'playlist') = (inclui_playlist_id IS NOT NULL) AND inclui_playlist_id IS DISTINCT FROM playlist_id);

-- ── 2) Os itens que a TV toca, com as inclusões abertas ──────────────────
-- Só para as funções da TV (SECURITY DEFINER): ninguém chama direto.
CREATE OR REPLACE FUNCTION public.tv_itens_no_ar(p_playlist uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $fn$
  WITH proprios AS (
    SELECT i.* FROM public."TV_ITEM" i
     WHERE i.playlist_id = p_playlist AND i.ativo
       AND (i.valido_de IS NULL OR i.valido_de <= now()) AND (i.valido_ate IS NULL OR i.valido_ate > now())
  ), linhas AS (
    SELECT p.ordem AS o1, p.created_at AS c1, 0 AS o2, p.created_at AS c2,
           p.id, p.tipo, p.titulo, p.url, p.arquivo, p.texto, p.cor, p.duracao_seg, p.relatorio, p.rel_periodo, p.rel_visual
      FROM proprios p WHERE p.tipo <> 'playlist'
    UNION ALL
    SELECT p.ordem, p.created_at, j.ordem, j.created_at,
           j.id, j.tipo, j.titulo, j.url, j.arquivo, j.texto, j.cor,
           CASE WHEN j.tipo = 'video' THEN j.duracao_seg ELSE least(j.duracao_seg, p.duracao_seg) END,
           j.relatorio, j.rel_periodo, j.rel_visual
      FROM proprios p
      JOIN public."TV_ITEM" j ON j.playlist_id = p.inclui_playlist_id AND j.ativo AND j.tipo <> 'playlist'
       AND (j.valido_de IS NULL OR j.valido_de <= now()) AND (j.valido_ate IS NULL OR j.valido_ate > now())
     WHERE p.tipo = 'playlist'
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'tipo', l.tipo, 'titulo', l.titulo, 'url', l.url, 'arquivo', l.arquivo,
                                               'texto', l.texto, 'cor', l.cor, 'duracao_seg', l.duracao_seg, 'relatorio', l.relatorio,
                                               'rel_periodo', l.rel_periodo, 'rel_visual', l.rel_visual)
                            ORDER BY l.o1, l.c1, l.o2, l.c2), '[]'::jsonb)
    FROM linhas l;
$fn$;
REVOKE ALL ON FUNCTION public.tv_itens_no_ar(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3) tv_estado: igual à da mig 20261114150000, com a lista aberta ──────
CREATE OR REPLACE FUNCTION public.tv_estado(p_token text, p_tela text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp' AS $function$
DECLARE d public."TV_DISPOSITIVO"; v_cmd text;
BEGIN
  SELECT * INTO d FROM public."TV_DISPOSITIVO" WHERE token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  IF NOT FOUND THEN RETURN jsonb_build_object('desconhecida', true); END IF;
  v_cmd := CASE WHEN d.comando IS NOT NULL AND d.comando_em > now() - interval '1 hour' THEN d.comando END;
  UPDATE public."TV_DISPOSITIVO" SET ultimo_ping = now(), tela = coalesce(left(p_tela, 30), tela), comando = NULL, comando_em = NULL WHERE id = d.id;
  IF d.pareado_em IS NULL THEN RETURN jsonb_build_object('pareada', false, 'codigo', d.codigo); END IF;
  RETURN jsonb_build_object(
    'pareada', true, 'nome', d.nome, 'local', d.local, 'ativa', d.ativo, 'comando', v_cmd,
    'itens', CASE WHEN NOT d.ativo OR d.playlist_id IS NULL THEN '[]'::jsonb ELSE public.tv_itens_no_ar(d.playlist_id) END,
    'alerta', (SELECT jsonb_build_object('id', a.id, 'texto', a.texto, 'cor', a.cor, 'fim', a.fim, 'inicio', a.inicio,
                                         'imagem', a.imagem, 'duracao_seg', a.duracao_seg, 'layout', a.layout)
                 FROM public."TV_ALERTA" a
                WHERE a.encerrado_em IS NULL AND a.inicio <= now() AND a.fim > now() AND (a.todas OR d.id = ANY (a.dispositivos))
                ORDER BY a.created_at DESC LIMIT 1));
END $function$;
REVOKE ALL ON FUNCTION public.tv_estado(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tv_estado(text, text) TO anon, authenticated;

-- ── 4) tv_relatorio: igual à da mig 20261111230000; o item pode ser de
--       playlist incluída pela playlist da TV ───────────────────────────────
CREATE OR REPLACE FUNCTION public.tv_relatorio(p_token text, p_item uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  d public."TV_DISPOSITIVO"; i public."TV_ITEM"; v_de date; v_ate date; v_out jsonb; s text;
  v_ano int; v_meses int[]; v_filial text;
BEGIN
  SELECT * INTO d FROM public."TV_DISPOSITIVO"
   WHERE token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') AND pareado_em IS NOT NULL AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'TV não autorizada.'; END IF;
  SELECT * INTO i FROM public."TV_ITEM"
   WHERE id = p_item AND ativo AND tipo = 'relatorio'
     AND (playlist_id = d.playlist_id
          OR playlist_id IN (SELECT x.inclui_playlist_id FROM public."TV_ITEM" x
                              WHERE x.playlist_id = d.playlist_id AND x.tipo = 'playlist' AND x.ativo));
  IF NOT FOUND THEN RAISE EXCEPTION 'Relatório não está na playlist desta TV.'; END IF;

  SELECT p.de, p.ate INTO v_de, v_ate FROM public.tv_rel_periodo(i.rel_periodo) p;

  IF i.relatorio LIKE 'ger-%' THEN
    v_out := jsonb_build_object('tipo', 'gerencial') || public.tvg_painel_dados(i.relatorio)
             || jsonb_build_object('equipe', public.tvg_equipe_meta(i.relatorio));
  ELSIF i.relatorio LIKE 'ind:%' THEN
    v_out := jsonb_build_object('tipo', 'indicador') || coalesce(public.tvg_indicador_dados(substr(i.relatorio, 5)), '{}'::jsonb);
  ELSIF i.relatorio LIKE 'bi:%' THEN
    v_out := jsonb_build_object('tipo', 'bi') || public.tv_bi_dados(substr(i.relatorio, 4)::bigint);
  ELSIF i.relatorio = 'ope-contratos' THEN
    v_out := jsonb_build_object('tipo', 'ope-contratos') || public.tv_ope_contratos_dados();
  ELSIF i.relatorio = 'sup-painel' THEN
    v_out := jsonb_build_object('tipo', 'sup-painel') || public.tv_supply_dados();
  ELSIF i.relatorio = 'rec-painel' THEN
    v_out := jsonb_build_object('tipo', 'rec-painel') || public.tv_recrutamento_dados();
  ELSIF i.relatorio = 'rh-salarios' THEN
    v_out := jsonb_build_object('tipo', 'rh-salarios') || public.tv_rh_salarios_dados();
  ELSIF i.relatorio = 'fin-painel' THEN
    v_out := jsonb_build_object('tipo', 'fin-painel') || public.tv_financeiro_dados();
  ELSIF i.relatorio = 'ctl-painel' THEN
    v_out := jsonb_build_object('tipo', 'ctl-painel') || public.tv_controladoria_dados();
  ELSIF i.relatorio = 'pre-painel' THEN
    v_out := jsonb_build_object('tipo', 'pre-painel') || public.tv_presidencia_dados();
  ELSIF i.relatorio = 'geral' THEN
    v_out := jsonb_build_object('tipo', 'geral', 'periodo', jsonb_build_object('de', v_de, 'ate', v_ate), 'sistemas', '[]'::jsonb);
    -- 18/11/2026: + Turn-over (como o Relatório Geral do ERP).
    FOREACH s IN ARRAY ARRAY['recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'mudanca-funcao', 'chamados', 'orientacoes',
                             'turnover'] LOOP
      v_out := jsonb_set(v_out, '{sistemas}', (v_out->'sistemas') || jsonb_build_array(
        (SELECT jsonb_build_object('slug', s, 'titulo', r->>'titulo', 'kpis', r->'kpis', 'rotulo_item', r->>'rotulo_item',
                                   'mensal', r->'mensal')
           FROM (SELECT public.dir_rel_dados(s, v_de, v_ate, i.rel_contrato, NULL) r) x)));
    END LOOP;
  ELSIF i.relatorio = 'vagas' THEN
    v_out := jsonb_build_object('tipo', 'vagas', 'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
                                'painel', public.dir_vagas_painel_dados(v_de, v_ate, i.rel_contrato, NULL));
  ELSIF i.relatorio = 'turnover' THEN
    v_ano := extract(year FROM v_ate)::int;
    v_meses := ARRAY(SELECT m FROM generate_series(1, 12) m
                      WHERE make_date(v_ano, m, 1) BETWEEN date_trunc('month', v_de)::date AND v_ate);
    v_filial := public.dir_turnover_filial(i.rel_contrato);
    v_out := jsonb_build_object('tipo', 'turnover', 'filial', v_filial,
                                'painel', public.dir_turnover_painel_dados(v_ano, NULL, v_filial, NULL, v_meses));
  ELSIF i.relatorio = 'licitacoes' THEN
    v_out := jsonb_build_object('tipo', 'licitacoes') || public.tv_licitacao_dados();
  ELSIF i.relatorio = 'treinamentos' THEN
    v_out := jsonb_build_object('tipo', 'treinamentos', 'painel', public.trn_dashboard_dados(NULL, NULL, NULL));
  ELSE
    v_out := jsonb_build_object('tipo', 'sistema', 'slug', i.relatorio) || public.dir_rel_dados(i.relatorio, v_de, v_ate, i.rel_contrato, NULL);
  END IF;

  RETURN v_out || jsonb_build_object('contrato', (SELECT c.nome FROM public.contratos c WHERE c.id = i.rel_contrato), 'gerado_em', now());
END $function$;
REVOKE ALL ON FUNCTION public.tv_relatorio(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_relatorio(text,uuid) TO anon,authenticated,service_role;

-- ── 5) Recarregar as TVs de uma área: alcança a TV que inclui a área ─────
-- Igual à da mig 20261114140000, com a playlist incluída no EXISTS.
CREATE OR REPLACE FUNCTION public.tv_recarregar_relatorios(p_relatorios text[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE n integer;
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar'::public.app_acao)
          OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'alterar'::public.app_acao)) THEN
    RAISE EXCEPTION 'Sem liberação para recarregar TVs.' USING ERRCODE = '42501';
  END IF;
  UPDATE public."TV_DISPOSITIVO" d SET comando = 'recarregar', comando_em = now()
   WHERE d.ativo AND d.pareado_em IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public."TV_ITEM" i
        WHERE i.ativo
          AND (i.playlist_id = d.playlist_id
               OR i.playlist_id IN (SELECT x.inclui_playlist_id FROM public."TV_ITEM" x
                                     WHERE x.playlist_id = d.playlist_id AND x.tipo = 'playlist' AND x.ativo))
          AND (i.relatorio = ANY (coalesce(p_relatorios, '{}'))
               OR i.relatorio IN (SELECT 'ind:' || g.codigo FROM public."TVG_INDICADOR" g WHERE g.painel = ANY (coalesce(p_relatorios, '{}')))));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION public.tv_recarregar_relatorios(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tv_recarregar_relatorios(text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.tv_recarregar_relatorios(text[]) TO authenticated;

-- ── 6) A playlist da Presidência ─────────────────────────────────────────
-- Teto de 60 s por item incluído: uma volta passa por todos os setores em
-- ~9 min. O teto de cada setor se ajusta na tela (tempo do item).
DO $$
DECLARE v_pre uuid; v_inc uuid; v_ordem int := 0; v_nome text;
BEGIN
  SELECT id INTO v_pre FROM public."TV_PLAYLIST" WHERE nome = 'Presidência — Todos os setores' LIMIT 1;
  IF v_pre IS NULL THEN
    INSERT INTO public."TV_PLAYLIST" (nome, descricao)
    VALUES ('Presidência — Todos os setores', 'Passa as playlists de todos os setores, uma depois da outra — acompanha sozinha quando um setor muda a sua.')
    RETURNING id INTO v_pre;
  END IF;
  -- Abre com a Visão geral de todos os setores (Relatório Geral na TV: 2 páginas, 12 meses).
  IF NOT EXISTS (SELECT 1 FROM public."TV_ITEM" WHERE playlist_id = v_pre AND relatorio = 'geral') THEN
    INSERT INTO public."TV_ITEM" (playlist_id, ordem, tipo, titulo, relatorio, rel_periodo, duracao_seg, ativo)
    VALUES (v_pre, 5, 'relatorio', 'Visão geral — todos os setores', 'geral', '12m', 90, true);
  END IF;
  FOREACH v_nome IN ARRAY ARRAY['TV DIRETORIA', 'Operacional — Indicadores por Contrato', 'Financeiro — Controle de Faturamento',
                                'Controladoria — Faturamento da Empresa', 'Compras — Suprimentos', 'Recrutamento e Seleção',
                                'TV SST', 'TV JURÍDICO', 'TV LICITAÇÃO'] LOOP
    v_ordem := v_ordem + 10;
    SELECT id INTO v_inc FROM public."TV_PLAYLIST" WHERE nome = v_nome AND id <> v_pre LIMIT 1;
    CONTINUE WHEN v_inc IS NULL;
    IF NOT EXISTS (SELECT 1 FROM public."TV_ITEM" WHERE playlist_id = v_pre AND inclui_playlist_id = v_inc) THEN
      INSERT INTO public."TV_ITEM" (playlist_id, ordem, tipo, titulo, inclui_playlist_id, duracao_seg, ativo)
      VALUES (v_pre, v_ordem, 'playlist', v_nome, v_inc, 60, true);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DELETE FROM public."TV_PLAYLIST" WHERE nome = 'Presidência — Todos os setores';
-- DELETE FROM public."TV_ITEM" WHERE tipo = 'playlist';
-- (recriar tv_estado da mig 20261114150000, tv_relatorio da 20261111230000 e
--  tv_recarregar_relatorios da 20261114140000)
-- DROP FUNCTION IF EXISTS public.tv_itens_no_ar(uuid);
-- ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS tv_item_inclui_playlist_check;
-- ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS "TV_ITEM_tipo_check";
-- ALTER TABLE public."TV_ITEM" ADD CONSTRAINT "TV_ITEM_tipo_check"
--   CHECK (tipo IN ('imagem', 'video', 'url', 'youtube', 'aviso', 'relatorio'));
-- ALTER TABLE public."TV_ITEM" DROP COLUMN IF EXISTS inclui_playlist_id;
