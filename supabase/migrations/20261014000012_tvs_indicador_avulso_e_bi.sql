-- =========================================================================
-- TV's: QUALQUER GRÁFICO GERENCIAL SOZINHO + B.I NAS TVs (14/10/2026)
--
-- PEDIDO (Pablo): "esses novos gráficos, todos têm que aparecer pra selecionar
-- nas opções da playlist das TVs — tem que ter bem mais relatório pra
-- selecionar, pra eu colocar qualquer um que eu quiser nas TVs. Também tem
-- que ser possível colocar B.I nas TVs."
--
-- O QUE MUDA
--   · item de relatório aceita, além dos slugs fixos:
--       'ind:<codigo>' — UM indicador gerencial em tela cheia (gráfico grande,
--                        número, meta, onde, causa, responsável);
--       'bi:<id>'      — um painel do Estúdio de BI (os gráficos dele).
--     O link de BI (Power BI etc., BI_LINK) entra como item "Página web" —
--     não precisa de nada no banco.
--   · rel_visual aceita os dashboards novos ('dashboard', 'dashboard-escuro').
--   · tv_relatorio(token, item) devolve os dois tipos novos; a TV não tem
--     login, então o BI roda aqui (bi_rodar) com os filtros no padrão.
--   · tvg_indicador(codigo): a prévia na gestão (com login).
--   · tv_catalogo(): o que a playlist oferece — indicadores ativos e painéis do
--     Estúdio que a pessoa enxerga (dela ou públicos). Os links de BI a tela
--     lê direto (a RLS do BI_LINK já recorta por setor/pessoa).
--
-- PRIVACIDADE: o painel de BI vai para tela de área comum. Só entra pela
-- playlist quem tem acesso às TVs, e só painel que essa pessoa já enxerga.
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- ── 1) Constraints do item ───────────────────────────────────────────────
ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS tv_item_relatorio_check;
ALTER TABLE public."TV_ITEM" ADD CONSTRAINT tv_item_relatorio_check CHECK (
  tipo <> 'relatorio' OR (
    (relatorio = ANY (ARRAY['geral', 'recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'chamados',
                            'orientacoes', 'mudanca-funcao', 'colaboradores', 'turnover', 'vagas', 'licitacoes', 'treinamentos',
                            'ger-operacional', 'ger-licitacoes', 'ger-supply', 'ger-frota', 'ger-recrutamento', 'ger-rh', 'ger-sst',
                            'ger-treinamento', 'ger-financeiro', 'ger-juridico', 'ger-controladoria', 'ger-ti', 'ger-presidencia'])
     OR relatorio ~ '^ind:[a-z0-9_]+$'
     OR relatorio ~ '^bi:[0-9]+$')
    AND COALESCE(rel_periodo, '12m') = ANY (ARRAY['mes', '3m', '6m', '12m', 'ano'])));

ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS tv_item_rel_visual_check;
ALTER TABLE public."TV_ITEM" ADD CONSTRAINT tv_item_rel_visual_check CHECK (
  rel_visual IS NULL OR rel_visual = ANY (ARRAY['classico', 'painel', 'painel-claro', 'graficos', 'dashboard', 'dashboard-escuro']));

-- ── 2) Um indicador gerencial sozinho ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tvg_indicador_dados(p_codigo text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'painel', jsonb_build_object('slug', p.slug, 'titulo', p.titulo, 'diretoria', p.diretoria, 'pergunta', p.pergunta),
    'indicador', public.tvg_resultado(i.codigo),
    'gerado_em', now())
    FROM public."TVG_INDICADOR" i JOIN public."TVG_PAINEL" p ON p.slug = i.painel
   WHERE i.codigo = p_codigo AND i.ativo
$$;
REVOKE ALL ON FUNCTION public.tvg_indicador_dados(text) FROM PUBLIC, anon, authenticated;

-- Prévia na gestão (com login) — o mesmo portão de tvg_painel.
CREATE OR REPLACE FUNCTION public.tvg_indicador(p_codigo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem acesso aos Indicadores gerenciais das TVs.' USING ERRCODE = '42501';
  END IF;
  RETURN public.tvg_indicador_dados(p_codigo);
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_indicador(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tvg_indicador(text) TO authenticated;

-- ── 3) Painel do Estúdio de BI para a TV (sem login: roda aqui) ──────────
CREATE OR REPLACE FUNCTION public.tv_bi_dados(p_painel bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  p public."BI_PAINEL"; w public."BI_WIDGET"; params jsonb := '{}'::jsonb; f jsonb; dados jsonb; widgets jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO p FROM public."BI_PAINEL" WHERE id = p_painel;
  IF NOT FOUND THEN RAISE EXCEPTION 'Painel de BI #% não existe mais.', p_painel; END IF;
  -- Filtros do painel no valor padrão (na TV ninguém escolhe).
  FOR f IN SELECT * FROM jsonb_array_elements(coalesce(p.filtros, '[]'::jsonb)) LOOP
    params := params || jsonb_build_object(f->>'chave', f->'padrao');
  END LOOP;
  FOR w IN SELECT * FROM public."BI_WIDGET" WHERE painel_id = p.id ORDER BY ordem, id LOOP
    BEGIN
      dados := public.bi_rodar(w.sql, params, 2000);
    EXCEPTION WHEN OTHERS THEN
      dados := jsonb_build_object('erro', SQLERRM);
    END;
    widgets := widgets || jsonb_build_array(jsonb_build_object(
      'id', w.id, 'titulo', w.titulo, 'subtitulo', w.subtitulo, 'tipo', w.tipo, 'config', w.config,
      'largura', w.largura, 'altura', w.altura, 'dados', dados));
  END LOOP;
  RETURN jsonb_build_object('painel', jsonb_build_object('id', p.id, 'nome', p.nome, 'descricao', p.descricao, 'tema', p.config->>'tema'),
                            'widgets', widgets, 'gerado_em', now());
END $fn$;
REVOKE ALL ON FUNCTION public.tv_bi_dados(bigint) FROM PUBLIC, anon, authenticated;

-- ── 4) tv_relatorio: os dois tipos novos ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.tv_relatorio(p_token text, p_item uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
DECLARE
  d public."TV_DISPOSITIVO"; i public."TV_ITEM"; v_de date; v_ate date; v_out jsonb; s text;
  v_ano int; v_meses int[]; v_filial text;
BEGIN
  SELECT * INTO d FROM public."TV_DISPOSITIVO"
   WHERE token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') AND pareado_em IS NOT NULL AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'TV não autorizada.'; END IF;
  SELECT * INTO i FROM public."TV_ITEM" WHERE id = p_item AND playlist_id = d.playlist_id AND ativo AND tipo = 'relatorio';
  IF NOT FOUND THEN RAISE EXCEPTION 'Relatório não está na playlist desta TV.'; END IF;

  SELECT p.de, p.ate INTO v_de, v_ate FROM public.tv_rel_periodo(i.rel_periodo) p;

  IF i.relatorio LIKE 'ger-%' THEN
    v_out := jsonb_build_object('tipo', 'gerencial') || public.tvg_painel_dados(i.relatorio);
  ELSIF i.relatorio LIKE 'ind:%' THEN
    v_out := jsonb_build_object('tipo', 'indicador') || coalesce(public.tvg_indicador_dados(substr(i.relatorio, 5)), '{}'::jsonb);
  ELSIF i.relatorio LIKE 'bi:%' THEN
    v_out := jsonb_build_object('tipo', 'bi') || public.tv_bi_dados(substr(i.relatorio, 4)::bigint);
  ELSIF i.relatorio = 'geral' THEN
    v_out := jsonb_build_object('tipo', 'geral', 'periodo', jsonb_build_object('de', v_de, 'ate', v_ate), 'sistemas', '[]'::jsonb);
    FOREACH s IN ARRAY ARRAY['recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'mudanca-funcao', 'chamados', 'orientacoes'] LOOP
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
END $fn$;

-- ── 5) O que a playlist oferece ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tv_catalogo()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_screen_access(v_uid, 'sistemas_tvs', 'visualizar') THEN
    RAISE EXCEPTION 'Sem acesso às TVs.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'indicadores', COALESCE((SELECT jsonb_agg(jsonb_build_object('codigo', i.codigo, 'nome', i.nome, 'painel', i.painel, 'painel_titulo', p.titulo)
                                              ORDER BY p.ordem, i.na_tv DESC, i.ordem)
                               FROM public."TVG_INDICADOR" i JOIN public."TVG_PAINEL" p ON p.slug = i.painel
                              WHERE i.ativo AND i.fonte <> 'espelho'), '[]'::jsonb),
    'bi_paineis', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'nome', b.nome, 'publico', b.publico,
                                               'widgets', (SELECT count(*) FROM public."BI_WIDGET" w WHERE w.painel_id = b.id)) ORDER BY b.nome)
                              FROM public."BI_PAINEL" b WHERE b.dono_id = v_uid OR b.publico), '[]'::jsonb));
  -- Os links de BI (BI_LINK) a tela lê com o login da pessoa: a RLS deles recorta por setor/pessoa.
END $fn$;
REVOKE ALL ON FUNCTION public.tv_catalogo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tv_catalogo() TO authenticated;

-- ── 6) As TVs gerenciais que já estão nas playlists passam ao dashboard ──
-- ("seja um dashboard pra TV, não cada um no seu quadrado"). Os visuais de
-- cartões continuam no seletor do item, para quem quiser voltar.
UPDATE public."TV_ITEM" SET rel_visual = 'dashboard'
 WHERE tipo = 'relatorio' AND relatorio LIKE 'ger-%' AND coalesce(rel_visual, '') IN ('', 'classico', 'painel-claro');

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- tv_relatorio: reaplicar a versão de 20261012000001 (sem 'ind:' e 'bi:').
-- DROP FUNCTION IF EXISTS public.tv_catalogo();
-- DROP FUNCTION IF EXISTS public.tv_bi_dados(bigint);
-- DROP FUNCTION IF EXISTS public.tvg_indicador(text);
-- DROP FUNCTION IF EXISTS public.tvg_indicador_dados(text);
-- (constraints: voltar à lista fixa de 20261012000001 e aos visuais de 20261014000002 —
--  antes, apagar/trocar os itens 'ind:%', 'bi:%' e os de visual 'dashboard%')
