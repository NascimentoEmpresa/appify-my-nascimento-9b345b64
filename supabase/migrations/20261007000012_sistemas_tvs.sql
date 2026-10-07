-- =========================================================================
-- SISTEMAS › TV's — controlar tudo o que passa nas TVs da empresa
-- (07/10/2026)
--
-- PEDIDO (Pablo): "um módulo pra conectar TODAS as TVs da empresa no
-- sistema ERP… Submódulo TV's pra controlar tudo o que passa nas TVs".
--
-- COMO FUNCIONA (sinalização digital, sem instalar nada na TV)
--   1. Na TV (navegador da Smart TV, Fire TV/Chromecast, mini PC) abre-se
--      <app>/tv. A tela se registra sozinha (tv_registrar) e mostra um
--      CÓDIGO de 6 dígitos. O token do aparelho fica só no navegador dela
--      (localStorage); no banco vai só o hash.
--   2. Em Sistemas › TV's alguém digita o código (tv_parear), dá nome/local
--      e escolhe a PLAYLIST. A TV pega isso na próxima consulta.
--   3. A TV consulta tv_estado(token) a cada ~15 s: playlist, aviso geral
--      ativo e comando pendente (recarregar). Cada consulta é o "ping" que
--      faz a TV aparecer online.
--
-- CONTEÚDO (TV_ITEM): imagem, vídeo (arquivo no bucket público tv-midia),
-- página web (iframe — site que bloqueia iframe não aparece), YouTube e
-- aviso em texto. Duração e janela de validade por item.
-- AVISO GERAL (TV_ALERTA): texto que cobre a tela em todas as TVs (ou nas
-- escolhidas) até a hora de fim — comunicado urgente.
--
-- SEGURANÇA: as RPCs da TV (tv_registrar, tv_estado) são as ÚNICAS liberadas
-- ao anon; só devolvem a playlist daquele aparelho, por token. Registro tem
-- teto (60 aparelhos não pareados por hora) e aparelho não pareado some em
-- 2 dias. O bucket tv-midia é PÚBLICO de leitura (a TV não tem login) — não
-- subir nada sigiloso. Gestão: menu sistemas_tvs (Acesso por Usuário).
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- ── Menu ─────────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT id, 'sistemas_tvs', 'TV''s', '/app/sistemas/tvs', 60, true
  FROM public.app_modulo WHERE codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO UPDATE SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

-- ── Tabelas ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."TV_PLAYLIST" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  descricao   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid DEFAULT auth.uid(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."TV_ITEM" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id  uuid NOT NULL REFERENCES public."TV_PLAYLIST"(id) ON DELETE CASCADE,
  ordem        int NOT NULL DEFAULT 0,
  tipo         text NOT NULL CHECK (tipo IN ('imagem', 'video', 'url', 'youtube', 'aviso')),
  titulo       text,
  url          text,          -- url / youtube
  arquivo      text,          -- caminho no bucket tv-midia (imagem / vídeo)
  texto        text,          -- aviso
  cor          text,          -- fundo do aviso (#hex)
  duracao_seg  int NOT NULL DEFAULT 15 CHECK (duracao_seg BETWEEN 3 AND 3600),
  valido_de    timestamptz,
  valido_ate   timestamptz,
  ativo        boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid DEFAULT auth.uid()
);
CREATE INDEX IF NOT EXISTS idx_tv_item_playlist ON public."TV_ITEM" (playlist_id, ordem);

CREATE TABLE IF NOT EXISTS public."TV_DISPOSITIVO" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash     text NOT NULL UNIQUE,
  codigo         text,                       -- 6 dígitos enquanto não pareada
  nome           text,
  local          text,
  playlist_id    uuid REFERENCES public."TV_PLAYLIST"(id) ON DELETE SET NULL,
  pareado_em     timestamptz,
  pareado_por    uuid,
  ultimo_ping    timestamptz,
  user_agent     text,
  tela           text,                       -- ex.: 1920x1080
  comando        text CHECK (comando IN ('recarregar')),
  comando_em     timestamptz,
  ativo          boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tv_dispositivo_codigo ON public."TV_DISPOSITIVO" (codigo) WHERE codigo IS NOT NULL;

CREATE TABLE IF NOT EXISTS public."TV_ALERTA" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  texto         text NOT NULL,
  cor           text NOT NULL DEFAULT '#dc2626',
  inicio        timestamptz NOT NULL DEFAULT now(),
  fim           timestamptz NOT NULL,
  todas         boolean NOT NULL DEFAULT true,
  dispositivos  uuid[] NOT NULL DEFAULT '{}',
  encerrado_em  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid DEFAULT auth.uid(),
  created_by_nome text
);

-- ── RLS (gestão pela tela; a TV usa só as RPCs) ─────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['TV_PLAYLIST', 'TV_ITEM', 'TV_DISPOSITIVO', 'TV_ALERTA'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS tv_playlist_select ON public."TV_PLAYLIST";
CREATE POLICY tv_playlist_select ON public."TV_PLAYLIST" FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar'));
DROP POLICY IF EXISTS tv_playlist_insert ON public."TV_PLAYLIST";
CREATE POLICY tv_playlist_insert ON public."TV_PLAYLIST" FOR INSERT TO authenticated WITH CHECK (public.has_screen_access(auth.uid(), 'sistemas_tvs', 'incluir'));
DROP POLICY IF EXISTS tv_playlist_update ON public."TV_PLAYLIST";
CREATE POLICY tv_playlist_update ON public."TV_PLAYLIST" FOR UPDATE TO authenticated USING (public.has_screen_access(auth.uid(), 'sistemas_tvs', 'alterar'));
DROP POLICY IF EXISTS tv_playlist_delete ON public."TV_PLAYLIST";
CREATE POLICY tv_playlist_delete ON public."TV_PLAYLIST" FOR DELETE TO authenticated USING (public.has_screen_access(auth.uid(), 'sistemas_tvs', 'excluir'));

DROP POLICY IF EXISTS tv_item_select ON public."TV_ITEM";
CREATE POLICY tv_item_select ON public."TV_ITEM" FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar'));
DROP POLICY IF EXISTS tv_item_insert ON public."TV_ITEM";
CREATE POLICY tv_item_insert ON public."TV_ITEM" FOR INSERT TO authenticated WITH CHECK (public.has_screen_access(auth.uid(), 'sistemas_tvs', 'incluir'));
DROP POLICY IF EXISTS tv_item_update ON public."TV_ITEM";
CREATE POLICY tv_item_update ON public."TV_ITEM" FOR UPDATE TO authenticated USING (public.has_screen_access(auth.uid(), 'sistemas_tvs', 'alterar'));
DROP POLICY IF EXISTS tv_item_delete ON public."TV_ITEM";
CREATE POLICY tv_item_delete ON public."TV_ITEM" FOR DELETE TO authenticated USING (public.has_screen_access(auth.uid(), 'sistemas_tvs', 'excluir'));

-- Dispositivo: a tela lê, renomeia/troca playlist/manda comando (alterar) e
-- remove (excluir). Criar é só pela TV (tv_registrar) e parear por tv_parear.
DROP POLICY IF EXISTS tv_dispositivo_select ON public."TV_DISPOSITIVO";
CREATE POLICY tv_dispositivo_select ON public."TV_DISPOSITIVO" FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar'));
DROP POLICY IF EXISTS tv_dispositivo_update ON public."TV_DISPOSITIVO";
CREATE POLICY tv_dispositivo_update ON public."TV_DISPOSITIVO" FOR UPDATE TO authenticated USING (public.has_screen_access(auth.uid(), 'sistemas_tvs', 'alterar'));
DROP POLICY IF EXISTS tv_dispositivo_delete ON public."TV_DISPOSITIVO";
CREATE POLICY tv_dispositivo_delete ON public."TV_DISPOSITIVO" FOR DELETE TO authenticated USING (public.has_screen_access(auth.uid(), 'sistemas_tvs', 'excluir'));
-- token_hash nunca sai para a tela: leitura por coluna (revogar só a coluna
-- não adianta com o SELECT da tabela inteira concedido).
REVOKE SELECT ON public."TV_DISPOSITIVO" FROM authenticated;
GRANT SELECT (id, codigo, nome, local, playlist_id, pareado_em, pareado_por, ultimo_ping, user_agent, tela, comando, comando_em, ativo, created_at)
  ON public."TV_DISPOSITIVO" TO authenticated;

DROP POLICY IF EXISTS tv_alerta_select ON public."TV_ALERTA";
CREATE POLICY tv_alerta_select ON public."TV_ALERTA" FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar'));
DROP POLICY IF EXISTS tv_alerta_insert ON public."TV_ALERTA";
CREATE POLICY tv_alerta_insert ON public."TV_ALERTA" FOR INSERT TO authenticated WITH CHECK (public.has_screen_access(auth.uid(), 'sistemas_tvs', 'incluir'));
DROP POLICY IF EXISTS tv_alerta_update ON public."TV_ALERTA";
CREATE POLICY tv_alerta_update ON public."TV_ALERTA" FOR UPDATE TO authenticated USING (public.has_screen_access(auth.uid(), 'sistemas_tvs', 'alterar'));

-- ── Bucket público de mídia ──────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('tv-midia', 'tv-midia', true, 209715200)   -- 200 MB (vídeo)
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "tv midia insert" ON storage.objects;
CREATE POLICY "tv midia insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tv-midia' AND public.has_screen_access(auth.uid(), 'sistemas_tvs', 'incluir'));
DROP POLICY IF EXISTS "tv midia delete" ON storage.objects;
CREATE POLICY "tv midia delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'tv-midia' AND public.has_screen_access(auth.uid(), 'sistemas_tvs', 'excluir'));

-- ── RPCs da TV (anon) ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tv_registrar(p_user_agent text DEFAULT NULL, p_tela text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
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
END $$;

CREATE OR REPLACE FUNCTION public.tv_estado(p_token text, p_tela text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE d public."TV_DISPOSITIVO"; v_cmd text;
BEGIN
  SELECT * INTO d FROM public."TV_DISPOSITIVO"
   WHERE token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  IF NOT FOUND THEN RETURN jsonb_build_object('desconhecida', true); END IF;

  v_cmd := CASE WHEN d.comando IS NOT NULL AND d.comando_em > now() - interval '10 minutes' THEN d.comando END;
  UPDATE public."TV_DISPOSITIVO"
     SET ultimo_ping = now(), tela = coalesce(left(p_tela, 30), tela), comando = NULL, comando_em = NULL
   WHERE id = d.id;

  IF d.pareado_em IS NULL THEN
    RETURN jsonb_build_object('pareada', false, 'codigo', d.codigo);
  END IF;

  RETURN jsonb_build_object(
    'pareada', true, 'nome', d.nome, 'local', d.local, 'ativa', d.ativo, 'comando', v_cmd,
    'itens', CASE WHEN NOT d.ativo THEN '[]'::jsonb ELSE (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'tipo', i.tipo, 'titulo', i.titulo, 'url', i.url, 'arquivo', i.arquivo,
                                                   'texto', i.texto, 'cor', i.cor, 'duracao_seg', i.duracao_seg) ORDER BY i.ordem, i.created_at), '[]'::jsonb)
        FROM public."TV_ITEM" i
       WHERE i.playlist_id = d.playlist_id AND i.ativo
         AND (i.valido_de IS NULL OR i.valido_de <= now()) AND (i.valido_ate IS NULL OR i.valido_ate > now())) END,
    'alerta', (SELECT jsonb_build_object('id', a.id, 'texto', a.texto, 'cor', a.cor, 'fim', a.fim)
                 FROM public."TV_ALERTA" a
                WHERE a.encerrado_em IS NULL AND a.inicio <= now() AND a.fim > now()
                  AND (a.todas OR d.id = ANY (a.dispositivos))
                ORDER BY a.created_at DESC LIMIT 1));
END $$;

-- ── RPC da gestão: parear pelo código ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tv_parear(p_codigo text, p_nome text, p_local text DEFAULT NULL, p_playlist_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
END $$;

REVOKE ALL ON FUNCTION public.tv_registrar(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tv_estado(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tv_parear(text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tv_registrar(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_estado(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_parear(text, text, text, uuid) TO authenticated;

-- ── Liberação inicial: quem já cuida de Sistemas › Logins (07/10: só o
-- Pablo). O resto, em Acesso por Usuário.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, 'sistemas_tvs', a.acao::public.app_acao, true, 'Mesmo acesso de Sistemas › Logins (mig 20261007000012)'
  FROM public.screen_permission_user s
 CROSS JOIN (VALUES ('visualizar'), ('incluir'), ('alterar'), ('excluir')) a(acao)
 WHERE s.menu_codigo = 'sistemas_logins' AND s.acao = 'alterar' AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'sistemas_tvs' AND x.acao = a.acao::public.app_acao);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.tv_registrar(text, text), public.tv_estado(text, text), public.tv_parear(text, text, text, uuid);
-- DROP POLICY IF EXISTS "tv midia insert" ON storage.objects; DROP POLICY IF EXISTS "tv midia delete" ON storage.objects;
-- DROP TABLE IF EXISTS public."TV_ALERTA", public."TV_DISPOSITIVO", public."TV_ITEM", public."TV_PLAYLIST";
-- DELETE FROM app_menu WHERE codigo = 'sistemas_tvs';   (o bucket tv-midia pode ficar; apagar só vazio)
