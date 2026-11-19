-- =========================================================================
-- TV's › VISUALIZAR TVs (20/11/2026)
--
-- Pablo: uma tela onde os gestores acompanham o que está passando em cada
-- TV, cada um vendo só as TVs liberadas para ele. É só para ASSISTIR: editar
-- playlist continua em Sistemas › TV's (sistemas_tvs).
--
-- PERMISSÃO — o mesmo arranjo das pastas do WhatsApp (mig 20260731000001):
-- nenhuma tabela de permissão nova, só linhas em app_menu, que aparecem
-- sozinhas em Administração › Acesso por Usuário, embaixo do módulo TV's.
--   · tvs_visualizar ............ a tela (/app/sistemas/tvs/visualizar);
--   · tvs_visualizar_todas ...... menu fantasma "ver todas as TVs";
--   · tvs_visualizar_pl_<uuid> .. menu fantasma POR PLAYLIST ("TV <nome>"),
--     criado/renomeado/apagado por gatilho junto com a playlist.
-- Vê a playlist quem tem a tela E (todas OU o menu daquela playlist).
-- Playlist nova = menu novo = nasce PENDENTE (SIS-2026-0931): só vale depois
-- de liberada em Novos Módulos, como qualquer bloco novo.
--
-- LEITURA: por RPC SECURITY DEFINER com has_screen_access dentro — as
-- policies das tabelas TV_* (sistemas_tvs) não mudam e quem só assiste não
-- ganha SELECT em TV_DISPOSITIVO/TV_ALERTA. tv_visualizar_playlists devolve
-- as playlists liberadas e, só para a prévia abrir o item "Outra playlist"
-- (mig 20261118140000), as playlists que elas incluem (liberada = false).
--
-- RELATÓRIO NA PRÉVIA: as *_previa (login de quem está na gestão) cobram
-- sistemas_tvs/tvs_gerenciais ou a tela de origem — quem só tem Visualizar
-- TVs veria "Não foi possível carregar o relatório". O despacho do
-- tv_relatorio (o que a TV de verdade recebe) saiu para
-- tv_relatorio_item_dados, SEM grant, e é chamado pelos dois portões:
--   · tv_relatorio(token, item) ........ a TV (inalterada na regra);
--   · tv_visualizar_relatorio(item) .... o login, se pode ver a playlist do
--     item (ou uma que a inclua).
-- Relatório novo na TV entra SÓ em tv_relatorio_item_dados.
--
-- REGRA da mig 20261118150000: nada de FK nova entre TV_ITEM e TV_PLAYLIST.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

SET lock_timeout = '5s';

-- ── 1) Menus: a tela e o "ver todas" ─────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT id, 'tvs_visualizar', 'Visualizar TVs', '/app/sistemas/tvs/visualizar', 3, true
  FROM public.app_modulo WHERE codigo = 'tvs'
ON CONFLICT (modulo_id, codigo) DO UPDATE SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT id, 'tvs_visualizar_todas', 'Visualizar TVs — Todas as TVs', NULL, 4, true
  FROM public.app_modulo WHERE codigo = 'tvs'
ON CONFLICT (modulo_id, codigo) DO UPDATE SET nome = EXCLUDED.nome, rota = NULL, ativo = true;

-- ── 2) Menu fantasma por playlist ────────────────────────────────────────
-- O código sai do id (não do nome): renomear a playlist não muda o código e
-- não perde a liberação. A mesma regra em src/lib/tv/visualizarTvs.ts.
CREATE OR REPLACE FUNCTION public.tv_visualizar_menu(p_playlist uuid)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT 'tvs_visualizar_pl_' || replace(p_playlist::text, '-', '')
$fn$;

CREATE OR REPLACE FUNCTION public.tv_playlist_menu_visualizar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_modulo uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Sem sobrar permissão órfã na tela de acesso (como wa_pasta_remover).
    DELETE FROM public.screen_permission_user WHERE menu_codigo = public.tv_visualizar_menu(OLD.id);
    DELETE FROM public.app_menu WHERE codigo = public.tv_visualizar_menu(OLD.id);
    RETURN OLD;
  END IF;
  SELECT id INTO v_modulo FROM public.app_modulo WHERE codigo = 'tvs';
  IF v_modulo IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
  VALUES (v_modulo, public.tv_visualizar_menu(NEW.id), 'Visualizar TVs — TV ' || NEW.nome, NULL, 10, true)
  ON CONFLICT (modulo_id, codigo) DO UPDATE SET nome = EXCLUDED.nome;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.tv_playlist_menu_visualizar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tv_playlist_menu_visualizar ON public."TV_PLAYLIST";
CREATE TRIGGER trg_tv_playlist_menu_visualizar
  AFTER INSERT OR DELETE OR UPDATE OF nome ON public."TV_PLAYLIST"
  FOR EACH ROW EXECUTE FUNCTION public.tv_playlist_menu_visualizar();

-- As playlists que já existem.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, public.tv_visualizar_menu(p.id), 'Visualizar TVs — TV ' || p.nome, NULL, 10, true
  FROM public."TV_PLAYLIST" p CROSS JOIN public.app_modulo m
 WHERE m.codigo = 'tvs'
ON CONFLICT (modulo_id, codigo) DO UPDATE SET nome = EXCLUDED.nome;

-- ── 3) A regra ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tv_pode_visualizar_playlist(p_user uuid, p_playlist uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT public.has_screen_access(p_user, 'tvs_visualizar', 'visualizar'::public.app_acao)
     AND (public.has_screen_access(p_user, 'tvs_visualizar_todas', 'visualizar'::public.app_acao)
          OR public.has_screen_access(p_user, public.tv_visualizar_menu(p_playlist), 'visualizar'::public.app_acao))
$fn$;
REVOKE ALL ON FUNCTION public.tv_pode_visualizar_playlist(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tv_pode_visualizar_playlist(uuid, uuid) TO authenticated;

-- ── 4) O que a tela lê ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tv_visualizar_playlists()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_uid uuid := auth.uid(); v_todas boolean; v_ids uuid[];
BEGIN
  IF NOT public.has_screen_access(v_uid, 'tvs_visualizar', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem liberação para Visualizar TVs.' USING ERRCODE = '42501';
  END IF;
  v_todas := public.has_screen_access(v_uid, 'tvs_visualizar_todas', 'visualizar'::public.app_acao);
  SELECT coalesce(array_agg(p.id), '{}') INTO v_ids
    FROM public."TV_PLAYLIST" p
   WHERE v_todas OR public.has_screen_access(v_uid, public.tv_visualizar_menu(p.id), 'visualizar'::public.app_acao);

  RETURN jsonb_build_object(
    'todas', v_todas,
    'filtro', (SELECT c.filtro_ativo FROM public."TV_CONFIG" c WHERE c.id = 1),
    'playlists', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'nome', p.nome, 'descricao', p.descricao,
               'liberada', p.id = ANY (v_ids),
               'tvs', (SELECT count(*) FROM public."TV_DISPOSITIVO" d WHERE d.playlist_id = p.id AND d.pareado_em IS NOT NULL),
               'itens', coalesce((SELECT jsonb_agg(to_jsonb(i) - 'created_by' ORDER BY i.ordem)
                                    FROM public."TV_ITEM" i WHERE i.playlist_id = p.id), '[]'::jsonb))
             ORDER BY p.nome)
        FROM public."TV_PLAYLIST" p
       WHERE p.id = ANY (v_ids)
          OR p.id IN (SELECT x.inclui_playlist_id FROM public."TV_ITEM" x
                       WHERE x.playlist_id = ANY (v_ids) AND x.tipo = 'playlist')), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.tv_visualizar_playlists() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tv_visualizar_playlists() TO authenticated;

-- ── 5) Relatório: o despacho do tv_relatorio, num lugar só ───────────────
-- Corpo IGUAL ao do tv_relatorio da mig 20261118140000 (do período em diante).
CREATE OR REPLACE FUNCTION public.tv_relatorio_item_dados(i public."TV_ITEM")
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_de date; v_ate date; v_out jsonb; s text;
  v_ano int; v_meses int[]; v_filial text;
BEGIN
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
-- Sem grant: só os dois portões abaixo chamam.
REVOKE ALL ON FUNCTION public.tv_relatorio_item_dados(public."TV_ITEM") FROM PUBLIC, anon, authenticated;

-- A TV: mesma checagem de antes (token + item da playlist dela ou de uma
-- incluída), agora delegando o despacho.
CREATE OR REPLACE FUNCTION public.tv_relatorio(p_token text, p_item uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  d public."TV_DISPOSITIVO"; i public."TV_ITEM";
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
  RETURN public.tv_relatorio_item_dados(i);
END $function$;
REVOKE ALL ON FUNCTION public.tv_relatorio(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_relatorio(text,uuid) TO anon,authenticated,service_role;

-- Visualizar TVs: o login, se pode ver a playlist do item ou uma que a inclui.
CREATE OR REPLACE FUNCTION public.tv_visualizar_relatorio(p_item uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE i public."TV_ITEM";
BEGIN
  SELECT * INTO i FROM public."TV_ITEM" WHERE id = p_item AND tipo = 'relatorio';
  IF NOT FOUND THEN RAISE EXCEPTION 'Relatório não encontrado.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."TV_PLAYLIST" p
     WHERE (p.id = i.playlist_id
            OR p.id IN (SELECT x.playlist_id FROM public."TV_ITEM" x
                         WHERE x.inclui_playlist_id = i.playlist_id AND x.tipo = 'playlist'))
       AND public.tv_pode_visualizar_playlist(auth.uid(), p.id)) THEN
    RAISE EXCEPTION 'Sem liberação para ver esta TV.' USING ERRCODE = '42501';
  END IF;
  RETURN public.tv_relatorio_item_dados(i);
END $fn$;
REVOKE ALL ON FUNCTION public.tv_visualizar_relatorio(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tv_visualizar_relatorio(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- (recriar tv_relatorio da mig 20261118140000 ANTES de apagar o despacho)
-- DROP FUNCTION IF EXISTS public.tv_visualizar_relatorio(uuid);
-- DROP FUNCTION IF EXISTS public.tv_relatorio_item_dados(public."TV_ITEM");
-- DROP FUNCTION IF EXISTS public.tv_visualizar_playlists();
-- DROP FUNCTION IF EXISTS public.tv_pode_visualizar_playlist(uuid, uuid);
-- DROP TRIGGER IF EXISTS trg_tv_playlist_menu_visualizar ON public."TV_PLAYLIST";
-- DROP FUNCTION IF EXISTS public.tv_playlist_menu_visualizar();
-- DELETE FROM public.screen_permission_user WHERE menu_codigo LIKE 'tvs\_visualizar%';
-- DELETE FROM public.app_menu WHERE codigo LIKE 'tvs\_visualizar%';
-- DROP FUNCTION IF EXISTS public.tv_visualizar_menu(uuid);
-- NOTIFY pgrst, 'reload schema';
