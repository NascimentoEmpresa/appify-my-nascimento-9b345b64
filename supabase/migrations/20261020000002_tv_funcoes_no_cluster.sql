-- =========================================================================
-- SISTEMAS › TV's — funções tv_* atualizadas no cluster (20/10/2026)
--
-- Pablo, com o print do AO VIVO da TV LICITAÇÃO: "a tv da licitação no ao
-- vivo tá diferente disso, não tá assim".
--
-- O AO VIVO da gestão desenha o relatório com o login de quem olha
-- (tvg_painel), e a TV de verdade busca por tv_relatorio(token, item). Em
-- 19/10 descobrimos que as funções vieram VELHAS para o cluster na
-- replicação lógica, e a mig 20261019000005 recriou as 47 tvg_* — mas não as
-- tv_*. A tv_relatorio do cluster ficou sem a mig 20261015000012: o painel
-- gerencial chega à TV sem a chave `equipe`, e a TV LICITAÇÃO mostra "Onde
-- agir agora" onde o ao vivo mostra "Desempenho da equipe — Meta por
-- analista".
--
-- Aqui: todas as tv_* (menos tv_estado e tv_reportar, da mig
-- 20261020000001) recriadas com a definição viva da Supabase antiga
-- (pg_get_functiondef em 20/10/2026 — a última versão de cada uma; nenhuma
-- mudou depois da virada), com o mesmo EXECUTE de lá (anon só nas que a TV
-- chama sem login). CREATE OR REPLACE: idempotente.
-- =========================================================================

-- ── tv_bi_dados(bigint) ──
CREATE OR REPLACE FUNCTION public.tv_bi_dados(p_painel bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END $function$;
REVOKE ALL ON FUNCTION public.tv_bi_dados(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_bi_dados(bigint) TO service_role;

-- ── tv_catalogo() ──
CREATE OR REPLACE FUNCTION public.tv_catalogo()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END $function$;
REVOKE ALL ON FUNCTION public.tv_catalogo() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_catalogo() TO authenticated,service_role;

-- ── tv_gerar_link(uuid) ──
CREATE OR REPLACE FUNCTION public.tv_gerar_link(p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_alfa constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- 32 símbolos, sem 0/O/1/I
  v_bytes bytea := gen_random_bytes(12);
  v_chave text := '';
  k int;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'sistemas_tvs', 'alterar') THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  FOR k IN 0..11 LOOP
    v_chave := v_chave || substr(v_alfa, (get_byte(v_bytes, k) % 32) + 1, 1);
  END LOOP;
  UPDATE public."TV_DISPOSITIVO" SET token_hash = encode(digest(v_chave, 'sha256'), 'hex')
   WHERE id = p_id AND pareado_em IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'TV não encontrada.'; END IF;
  RETURN v_chave;
END $function$;
REVOKE ALL ON FUNCTION public.tv_gerar_link(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_gerar_link(uuid) TO authenticated,service_role;

-- ── tv_licitacao_dados() ──
CREATE OR REPLACE FUNCTION public.tv_licitacao_dados()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'itens', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(g.id, g.edital, g.fase, g.responsavel, g.cidade, g.uf, g.data, left(g.objeto, 160),
                                         g.qtd_pessoas, g.valor_global, g.posicao, g.created_at, g.updated_at, e.codigo)
                       ORDER BY g.data NULLS LAST, g.created_at)
        FROM public.grade g LEFT JOIN public.empresas e ON e.id = g.empresa_id), '[]'::jsonb),
    'gerado_em', now())
$function$;
REVOKE ALL ON FUNCTION public.tv_licitacao_dados() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_licitacao_dados() TO service_role;

-- ── tv_licitacao_previa() ──
CREATE OR REPLACE FUNCTION public.tv_licitacao_previa()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.can_access(auth.uid(), 'painel-executivo', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Painel Executivo de Licitações.' USING ERRCODE = '42501';
  END IF;
  RETURN public.tv_licitacao_dados();
END $function$;
REVOKE ALL ON FUNCTION public.tv_licitacao_previa() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_licitacao_previa() TO authenticated,service_role;

-- ── tv_parear(text,text,text,uuid) ──
CREATE OR REPLACE FUNCTION public.tv_parear(p_codigo text, p_nome text, p_local text DEFAULT NULL::text, p_playlist_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'sistemas_tvs', 'incluir') THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_nome, ''))) < 2 THEN RAISE EXCEPTION 'Dê um nome para a TV.'; END IF;
  UPDATE public."TV_DISPOSITIVO"
     SET codigo = NULL, nome = btrim(p_nome), local = nullif(btrim(coalesce(p_local, '')), ''), playlist_id = p_playlist_id,
         pareado_em = now(), pareado_por = auth.uid()
   WHERE codigo = regexp_replace(coalesce(p_codigo, ''), '\D', '', 'g') AND pareado_em IS NULL
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Código não encontrado. Confira o número que aparece na TV (ele muda se a TV recarregar sem parear).'; END IF;
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION public.tv_parear(text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_parear(text,text,text,uuid) TO authenticated,service_role;

-- ── tv_registrar(text,text) ──
CREATE OR REPLACE FUNCTION public.tv_registrar(p_user_agent text DEFAULT NULL::text, p_tela text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_token text; v_codigo text; v_id uuid; i int := 0;
BEGIN
  -- Faxina: aparelho que nunca foi pareado some em 2 dias.
  DELETE FROM public."TV_DISPOSITIVO" WHERE pareado_em IS NULL AND created_at < now() - interval '2 days';
  IF (SELECT count(*) FROM public."TV_DISPOSITIVO" WHERE pareado_em IS NULL AND created_at > now() - interval '1 hour') >= 60 THEN
    RAISE EXCEPTION 'Muitas TVs aguardando pareamento. Tente de novo mais tarde.';
  END IF;
  LOOP
    v_codigo := lpad((floor(random() * 1000000))::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public."TV_DISPOSITIVO" WHERE codigo = v_codigo);
    i := i + 1; IF i > 20 THEN RAISE EXCEPTION 'Não foi possível gerar o código.'; END IF;
  END LOOP;
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public."TV_DISPOSITIVO" (token_hash, codigo, user_agent, tela)
  VALUES (encode(digest(v_token, 'sha256'), 'hex'), v_codigo, left(p_user_agent, 300), left(p_tela, 30))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('token', v_token, 'codigo', v_codigo);
END $function$;
REVOKE ALL ON FUNCTION public.tv_registrar(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_registrar(text,text) TO anon,authenticated,service_role;

-- ── tv_rel_periodo(text) ──
CREATE OR REPLACE FUNCTION public.tv_rel_periodo(_p text, OUT de date, OUT ate date)
 RETURNS record
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE COALESCE(_p, '12m')
           WHEN 'mes' THEN date_trunc('month', current_date)::date
           WHEN 'ano' THEN date_trunc('year', current_date)::date
           WHEN '3m'  THEN (date_trunc('month', current_date) - interval '2 months')::date
           WHEN '6m'  THEN (date_trunc('month', current_date) - interval '5 months')::date
           ELSE (date_trunc('month', current_date) - interval '11 months')::date END,
         current_date
$function$;
REVOKE ALL ON FUNCTION public.tv_rel_periodo(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_rel_periodo(text) TO anon,authenticated,service_role;

-- ── tv_relatorio(text,uuid) ──
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
  SELECT * INTO i FROM public."TV_ITEM" WHERE id = p_item AND playlist_id = d.playlist_id AND ativo AND tipo = 'relatorio';
  IF NOT FOUND THEN RAISE EXCEPTION 'Relatório não está na playlist desta TV.'; END IF;

  SELECT p.de, p.ate INTO v_de, v_ate FROM public.tv_rel_periodo(i.rel_periodo) p;

  IF i.relatorio LIKE 'ger-%' THEN
    v_out := jsonb_build_object('tipo', 'gerencial') || public.tvg_painel_dados(i.relatorio)
             || jsonb_build_object('equipe', public.tvg_equipe_meta(i.relatorio));
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
END $function$;
REVOKE ALL ON FUNCTION public.tv_relatorio(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_relatorio(text,uuid) TO anon,authenticated,service_role;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Sem volta automática: as definições anteriores do cluster eram as desatualizadas.
-- Para uma função específica, reaplicar a migration de origem dela.
