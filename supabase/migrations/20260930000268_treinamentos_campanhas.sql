-- =========================================================================
-- Treinamentos › Campanhas (30/09/2026)
--
-- Pedido do Pablo: "deixar possível do setor colocar campanhas, com vídeo e
-- que esse vídeo tenha qrcode para ser acessado ... essas campanhas criadas
-- vão ser PÚBLICAS, qualquer um pode acessar, então ao criar vai gerar uma
-- URL pública e o QRCODE, nessas campanhas é possível adicionar vídeos,
-- textos, provinhas etc."
--
-- DESENHO
--   TRN_CAMPANHA           a campanha (título, capa, cor, período, slug da
--                          URL pública /campanhas/<slug>).
--   TRN_CAMPANHA_ITEM      o conteúdo, em ordem: vídeo, texto, imagem, link,
--                          arquivo ou provinha. A provinha usa o MESMO formato
--                          de pergunta de TRN_AULA.quiz (trn_prova_perguntas,
--                          mig 205) — o editor do front é o mesmo.
--   TRN_CAMPANHA_RESPOSTA  quem respondeu a provinha (nome/CPF digitados, nota).
--
-- PÚBLICO SEM LOGIN, MAS SEM TABELA ABERTA
--   anon NÃO lê nenhuma das três tabelas. A página pública fala só com duas
--   RPCs SECURITY DEFINER:
--     · trn_campanha_publica(slug)  — devolve a campanha publicada e dentro
--       do período, com a provinha SEM gabarito (correta/corretas/explicação
--       ficam no banco), e conta o acesso;
--     · trn_campanha_responder(...) — corrige no banco e grava a resposta.
--   Rascunho, campanha fora do período e slug inexistente respondem igual
--   (NULL) — não dá para sondar o que existe.
--
-- ACESSO (gestão)
--   Menu próprio `treinamentos_campanhas`, deny-by-default como o resto:
--   visualizar = ver campanhas e respostas; incluir/alterar = editar;
--   excluir = apagar campanha e resposta. Não entra em trn_ve_modulo() de
--   propósito — quem só cuida de campanha não precisa ler aluno/curso. Para
--   essa pessoa conseguir subir vídeo/capa, as policies de upload do bucket
--   trn-midia ganham um OU com a permissão de campanhas.
--
-- Policies com (select …) em volta do helper: avaliado uma vez por consulta,
-- não por linha (mesmo padrão das mig 265/267 de RLS).
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'treinamentos_campanhas', 'Campanhas', '/app/treinamentos/campanhas', 60, true
  FROM public.app_modulo m
 WHERE m.codigo = 'treinamentos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('treinamentos_campanhas', 'excluir'::app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- ── 2) Tabelas ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."TRN_CAMPANHA" (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo               text NOT NULL,
  slug                 text NOT NULL UNIQUE,
  resumo               text,
  capa_path            text,
  cor                  text NOT NULL DEFAULT '#0f3171',
  publicada            boolean NOT NULL DEFAULT false,
  inicio_em            timestamptz,
  fim_em               timestamptz,
  -- Provinha: pedir o nome de quem responde (e o CPF, se marcado).
  pedir_identificacao  boolean NOT NULL DEFAULT true,
  pedir_documento      boolean NOT NULL DEFAULT false,
  criado_por           uuid DEFAULT auth.uid(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trn_campanha_periodo_ck CHECK (fim_em IS NULL OR inicio_em IS NULL OR fim_em >= inicio_em)
);

CREATE TABLE IF NOT EXISTS public."TRN_CAMPANHA_ITEM" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id   uuid NOT NULL REFERENCES public."TRN_CAMPANHA"(id) ON DELETE CASCADE,
  posicao       integer NOT NULL DEFAULT 0,
  tipo          text NOT NULL CHECK (tipo IN ('video','texto','imagem','link','arquivo','prova')),
  titulo        text,
  texto         text,
  video_url     text,
  video_path    text,
  imagem_path   text,
  arquivo_path  text,
  arquivo_nome  text,
  link_url      text,
  link_rotulo   text,
  quiz          jsonb,
  nota_minima   integer NOT NULL DEFAULT 70 CHECK (nota_minima BETWEEN 0 AND 100),
  prova_config  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trn_campanha_item_campanha ON public."TRN_CAMPANHA_ITEM"(campanha_id, posicao);

-- A resposta sobrevive ao item apagado (item_id vira NULL; o título fica
-- guardado) — apagar uma provinha não some com quem já respondeu.
CREATE TABLE IF NOT EXISTS public."TRN_CAMPANHA_RESPOSTA" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id   uuid NOT NULL REFERENCES public."TRN_CAMPANHA"(id) ON DELETE CASCADE,
  item_id       uuid REFERENCES public."TRN_CAMPANHA_ITEM"(id) ON DELETE SET NULL,
  item_titulo   text,
  nome          text,
  documento     text,
  respostas     jsonb NOT NULL DEFAULT '{}'::jsonb,
  correcao      jsonb,
  acertos       integer NOT NULL DEFAULT 0,
  total         integer NOT NULL DEFAULT 0,
  pontos        numeric NOT NULL DEFAULT 0,
  pontos_total  numeric NOT NULL DEFAULT 0,
  nota          integer NOT NULL DEFAULT 0,
  aprovado      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trn_campanha_resposta_campanha ON public."TRN_CAMPANHA_RESPOSTA"(campanha_id, created_at DESC);

-- Acessos por dia (cada abertura da página pública). Tabela à parte para
-- não mexer em TRN_CAMPANHA.updated_at a cada visita — e dá o gráfico.
CREATE TABLE IF NOT EXISTS public."TRN_CAMPANHA_ACESSO" (
  campanha_id  uuid NOT NULL REFERENCES public."TRN_CAMPANHA"(id) ON DELETE CASCADE,
  dia          date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
  acessos      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (campanha_id, dia)
);

-- ── 3) Triggers ──────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trn_touch_trg ON public."TRN_CAMPANHA";
CREATE TRIGGER trn_touch_trg BEFORE UPDATE ON public."TRN_CAMPANHA"
  FOR EACH ROW EXECUTE FUNCTION public.trn_touch();
DROP TRIGGER IF EXISTS trn_touch_trg ON public."TRN_CAMPANHA_ITEM";
CREATE TRIGGER trn_touch_trg BEFORE UPDATE ON public."TRN_CAMPANHA_ITEM"
  FOR EACH ROW EXECUTE FUNCTION public.trn_touch();

-- Slug da URL pública: do título quando vier vazio, único (sufixo -2, -3…).
-- Mudar o título NÃO troca o slug — o QR Code já impresso continua valendo.
CREATE OR REPLACE FUNCTION public.trn_campanha_slug() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE base text; cand text; n int := 1;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.slug IS NOT DISTINCT FROM OLD.slug THEN RETURN NEW; END IF;
  base := coalesce(public.trn_slugify(NEW.slug), public.trn_slugify(NEW.titulo), 'campanha');
  base := left(base, 80);
  cand := base;
  WHILE EXISTS (SELECT 1 FROM public."TRN_CAMPANHA" WHERE slug = cand AND id <> NEW.id) LOOP
    n := n + 1; cand := base || '-' || n;
  END LOOP;
  NEW.slug := cand;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trn_campanha_slug_trg ON public."TRN_CAMPANHA";
CREATE TRIGGER trn_campanha_slug_trg BEFORE INSERT OR UPDATE OF slug ON public."TRN_CAMPANHA"
  FOR EACH ROW EXECUTE FUNCTION public.trn_campanha_slug();

-- ── 4) RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public."TRN_CAMPANHA"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TRN_CAMPANHA_ITEM"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TRN_CAMPANHA_RESPOSTA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TRN_CAMPANHA_ACESSO"   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."TRN_CAMPANHA", public."TRN_CAMPANHA_ITEM", public."TRN_CAMPANHA_RESPOSTA", public."TRN_CAMPANHA_ACESSO" FROM PUBLIC, anon;
GRANT SELECT ON public."TRN_CAMPANHA_ACESSO" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."TRN_CAMPANHA", public."TRN_CAMPANHA_ITEM" TO authenticated;
GRANT SELECT, DELETE ON public."TRN_CAMPANHA_RESPOSTA" TO authenticated;

DROP POLICY IF EXISTS trn_campanha_select ON public."TRN_CAMPANHA";
DROP POLICY IF EXISTS trn_campanha_insert ON public."TRN_CAMPANHA";
DROP POLICY IF EXISTS trn_campanha_update ON public."TRN_CAMPANHA";
DROP POLICY IF EXISTS trn_campanha_delete ON public."TRN_CAMPANHA";
CREATE POLICY trn_campanha_select ON public."TRN_CAMPANHA" FOR SELECT TO authenticated
  USING ((select public.trn_acesso('treinamentos_campanhas')));
CREATE POLICY trn_campanha_insert ON public."TRN_CAMPANHA" FOR INSERT TO authenticated
  WITH CHECK ((select public.trn_acesso('treinamentos_campanhas','incluir')) OR (select public.trn_acesso('treinamentos_campanhas','alterar')));
CREATE POLICY trn_campanha_update ON public."TRN_CAMPANHA" FOR UPDATE TO authenticated
  USING ((select public.trn_acesso('treinamentos_campanhas','alterar'))) WITH CHECK ((select public.trn_acesso('treinamentos_campanhas','alterar')));
CREATE POLICY trn_campanha_delete ON public."TRN_CAMPANHA" FOR DELETE TO authenticated
  USING ((select public.trn_acesso('treinamentos_campanhas','excluir')));

-- Itens: quem cria a campanha monta o conteúdo dela no mesmo passo, então
-- incluir OU alterar escreve item (inclusive apagar item dentro do editor).
DROP POLICY IF EXISTS trn_campanha_item_select ON public."TRN_CAMPANHA_ITEM";
DROP POLICY IF EXISTS trn_campanha_item_insert ON public."TRN_CAMPANHA_ITEM";
DROP POLICY IF EXISTS trn_campanha_item_update ON public."TRN_CAMPANHA_ITEM";
DROP POLICY IF EXISTS trn_campanha_item_delete ON public."TRN_CAMPANHA_ITEM";
CREATE POLICY trn_campanha_item_select ON public."TRN_CAMPANHA_ITEM" FOR SELECT TO authenticated
  USING ((select public.trn_acesso('treinamentos_campanhas')));
CREATE POLICY trn_campanha_item_insert ON public."TRN_CAMPANHA_ITEM" FOR INSERT TO authenticated
  WITH CHECK ((select public.trn_acesso('treinamentos_campanhas','incluir')) OR (select public.trn_acesso('treinamentos_campanhas','alterar')));
CREATE POLICY trn_campanha_item_update ON public."TRN_CAMPANHA_ITEM" FOR UPDATE TO authenticated
  USING ((select public.trn_acesso('treinamentos_campanhas','incluir')) OR (select public.trn_acesso('treinamentos_campanhas','alterar')))
  WITH CHECK ((select public.trn_acesso('treinamentos_campanhas','incluir')) OR (select public.trn_acesso('treinamentos_campanhas','alterar')));
CREATE POLICY trn_campanha_item_delete ON public."TRN_CAMPANHA_ITEM" FOR DELETE TO authenticated
  USING ((select public.trn_acesso('treinamentos_campanhas','incluir')) OR (select public.trn_acesso('treinamentos_campanhas','alterar')));

-- Respostas: ninguém grava pela API — só a RPC pública, que corrige no banco.
DROP POLICY IF EXISTS trn_campanha_resposta_select ON public."TRN_CAMPANHA_RESPOSTA";
DROP POLICY IF EXISTS trn_campanha_resposta_delete ON public."TRN_CAMPANHA_RESPOSTA";
CREATE POLICY trn_campanha_resposta_select ON public."TRN_CAMPANHA_RESPOSTA" FOR SELECT TO authenticated
  USING ((select public.trn_acesso('treinamentos_campanhas')));
CREATE POLICY trn_campanha_resposta_delete ON public."TRN_CAMPANHA_RESPOSTA" FOR DELETE TO authenticated
  USING ((select public.trn_acesso('treinamentos_campanhas','excluir')));

DROP POLICY IF EXISTS trn_campanha_acesso_select ON public."TRN_CAMPANHA_ACESSO";
CREATE POLICY trn_campanha_acesso_select ON public."TRN_CAMPANHA_ACESSO" FOR SELECT TO authenticated
  USING ((select public.trn_acesso('treinamentos_campanhas')));

-- ── 5) Storage: quem edita campanha sobe vídeo/capa no trn-midia ─────────
-- Mesmas policies da mig 190, com o OU das campanhas. A leitura continua
-- pública (o bucket já é) — é assim que o vídeo toca na página sem login.
DROP POLICY IF EXISTS "trn midia insert" ON storage.objects;
DROP POLICY IF EXISTS "trn midia update" ON storage.objects;
DROP POLICY IF EXISTS "trn midia delete" ON storage.objects;
CREATE POLICY "trn midia insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'trn-midia' AND ((select public.trn_ve_modulo()) OR (select public.trn_acesso('treinamentos_campanhas','incluir')) OR (select public.trn_acesso('treinamentos_campanhas','alterar'))));
CREATE POLICY "trn midia update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'trn-midia' AND ((select public.trn_ve_modulo()) OR (select public.trn_acesso('treinamentos_campanhas','alterar'))));
CREATE POLICY "trn midia delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'trn-midia' AND ((select public.trn_ve_modulo()) OR (select public.trn_acesso('treinamentos_campanhas','alterar'))));

-- ── 6) RPCs públicas ─────────────────────────────────────────────────────

-- Está no ar? Publicada e dentro do período (sem data = sem limite).
CREATE OR REPLACE FUNCTION public.trn_campanha_no_ar(c public."TRN_CAMPANHA")
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT c.publicada
     AND (c.inicio_em IS NULL OR c.inicio_em <= now())
     AND (c.fim_em    IS NULL OR c.fim_em    >= now());
$$;

-- 6.1 A página pública. `_contar` = false na prévia do editor (não infla o
-- número de acessos). Devolve NULL quando não há o que mostrar.
CREATE OR REPLACE FUNCTION public.trn_campanha_publica(_slug text, _contar boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public."TRN_CAMPANHA"; v_itens jsonb;
BEGIN
  SELECT * INTO c FROM public."TRN_CAMPANHA" WHERE slug = lower(btrim(_slug));
  IF NOT FOUND OR NOT public.trn_campanha_no_ar(c) THEN RETURN NULL; END IF;

  IF _contar THEN
    INSERT INTO public."TRN_CAMPANHA_ACESSO"(campanha_id, acessos) VALUES (c.id, 1)
    ON CONFLICT (campanha_id, dia) DO UPDATE SET acessos = public."TRN_CAMPANHA_ACESSO".acessos + 1;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'tipo', i.tipo, 'titulo', i.titulo, 'texto', i.texto,
           'video_url', i.video_url, 'video_path', i.video_path, 'imagem_path', i.imagem_path,
           'arquivo_path', i.arquivo_path, 'arquivo_nome', i.arquivo_nome,
           'link_url', i.link_url, 'link_rotulo', i.link_rotulo,
           'nota_minima', i.nota_minima,
           'prova', CASE WHEN i.tipo = 'prova' THEN jsonb_build_object(
               'titulo',     coalesce(nullif(i.prova_config->>'titulo', ''), i.titulo, 'Provinha'),
               'instrucoes', i.prova_config->>'instrucoes',
               -- Sem correta/corretas/explicação: o gabarito não sai do banco.
               'perguntas',  (SELECT coalesce(jsonb_agg(jsonb_build_object(
                                 'id', q.pid, 'tipo', q.tipo, 'enunciado', q.enunciado,
                                 'opcoes', q.opcoes, 'pontos', q.pontos) ORDER BY q.ord), '[]'::jsonb)
                                FROM public.trn_prova_perguntas(i.quiz) q)
             ) END
         ) ORDER BY i.posicao, i.created_at), '[]'::jsonb)
    INTO v_itens
    FROM public."TRN_CAMPANHA_ITEM" i
   WHERE i.campanha_id = c.id;

  RETURN jsonb_build_object(
    'id', c.id, 'titulo', c.titulo, 'slug', c.slug, 'resumo', c.resumo, 'capa_path', c.capa_path,
    'cor', c.cor, 'fim_em', c.fim_em,
    'pedir_identificacao', c.pedir_identificacao, 'pedir_documento', c.pedir_documento,
    'itens', v_itens);
END $$;
REVOKE ALL ON FUNCTION public.trn_campanha_publica(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trn_campanha_publica(text, boolean) TO anon, authenticated;

-- 6.2 Responder a provinha. Corrige como trn_prova_responder (mig 205):
-- múltipla com ponto parcial opcional, nota = % dos pontos; o quanto do
-- gabarito volta depende de prova_config.gabarito:
--   nunca     → só a nota
--   resultado → o que acertou e errou
--   ao_final / sempre → também a resposta certa e a explicação
-- (sem tentativas contadas aqui: é público, não há "aluno" para contar.)
CREATE OR REPLACE FUNCTION public.trn_campanha_responder(_slug text, _item uuid, _nome text, _documento text, _respostas jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c public."TRN_CAMPANHA"; it public."TRN_CAMPANHA_ITEM"; cfg jsonb; p record;
  v_marc int[]; v_hits int; v_erros int; v_pts numeric; v_ok boolean;
  v_total_pts numeric := 0; v_obt numeric := 0; v_acertos int := 0; v_total int := 0; v_nota int; v_aprov boolean;
  v_itens jsonb := '[]'::jsonb; v_gab text; v_nome text; v_doc text;
BEGIN
  SELECT * INTO c FROM public."TRN_CAMPANHA" WHERE slug = lower(btrim(_slug));
  IF NOT FOUND OR NOT public.trn_campanha_no_ar(c) THEN RAISE EXCEPTION 'Campanha indisponível.'; END IF;
  SELECT * INTO it FROM public."TRN_CAMPANHA_ITEM" WHERE id = _item AND campanha_id = c.id AND tipo = 'prova';
  IF NOT FOUND THEN RAISE EXCEPTION 'Provinha não encontrada. Recarregue a página.'; END IF;

  v_nome := nullif(left(btrim(coalesce(_nome, '')), 120), '');
  v_doc  := nullif(left(regexp_replace(coalesce(_documento, ''), '\D', '', 'g'), 14), '');
  IF c.pedir_identificacao AND v_nome IS NULL THEN RAISE EXCEPTION 'Informe seu nome.'; END IF;
  IF c.pedir_documento AND (v_doc IS NULL OR length(v_doc) <> 11) THEN RAISE EXCEPTION 'Informe o CPF completo (11 dígitos).'; END IF;
  IF _respostas IS NULL OR jsonb_typeof(_respostas) <> 'object' OR length(_respostas::text) > 20000 THEN
    RAISE EXCEPTION 'Respostas inválidas.';
  END IF;

  cfg := public.trn_prova_cfg(it.prova_config);
  FOR p IN SELECT * FROM public.trn_prova_perguntas(it.quiz) ORDER BY ord LOOP
    v_total := v_total + 1;
    v_total_pts := v_total_pts + p.pontos;
    v_marc := CASE jsonb_typeof(_respostas->p.pid)
                WHEN 'array'  THEN ARRAY(SELECT DISTINCT x::int FROM jsonb_array_elements_text(_respostas->p.pid) x WHERE x ~ '^\d{1,3}$')
                WHEN 'number' THEN ARRAY[(_respostas->>p.pid)::int]
                ELSE '{}'::int[] END;
    IF p.tipo <> 'multipla' AND cardinality(v_marc) > 1 THEN v_marc := v_marc[1:1]; END IF;
    v_ok := v_marc <@ p.corretas AND p.corretas <@ v_marc AND cardinality(v_marc) > 0;
    IF v_ok THEN
      v_pts := p.pontos;
    ELSIF p.tipo = 'multipla' AND (cfg->>'multipla_parcial')::boolean AND cardinality(p.corretas) > 0 THEN
      SELECT count(*) FILTER (WHERE m = ANY(p.corretas)), count(*) FILTER (WHERE NOT (m = ANY(p.corretas)))
        INTO v_hits, v_erros FROM unnest(v_marc) m;
      v_pts := round(p.pontos * greatest(v_hits - v_erros, 0)::numeric / cardinality(p.corretas), 2);
    ELSE
      v_pts := 0;
    END IF;
    IF v_ok THEN v_acertos := v_acertos + 1; END IF;
    v_obt := v_obt + v_pts;
    v_itens := v_itens || jsonb_build_object('id', p.pid, 'ok', v_ok, 'pontos', v_pts, 'max', p.pontos,
                                             'marcadas', to_jsonb(v_marc), 'corretas', to_jsonb(p.corretas),
                                             'explicacao', p.explicacao);
  END LOOP;
  IF v_total = 0 THEN RAISE EXCEPTION 'Esta provinha ainda não tem perguntas.'; END IF;

  v_nota  := CASE WHEN v_total_pts = 0 THEN 0 ELSE round(100.0 * v_obt / v_total_pts) END;
  v_aprov := v_nota >= it.nota_minima;

  INSERT INTO public."TRN_CAMPANHA_RESPOSTA"(campanha_id, item_id, item_titulo, nome, documento, respostas, correcao,
                                             acertos, total, pontos, pontos_total, nota, aprovado)
  VALUES (c.id, it.id, coalesce(nullif(it.prova_config->>'titulo', ''), it.titulo, 'Provinha'), v_nome, v_doc, _respostas, v_itens,
          v_acertos, v_total, v_obt, v_total_pts, v_nota, v_aprov);

  v_gab := cfg->>'gabarito';
  RETURN jsonb_build_object(
    'nota', v_nota, 'aprovado', v_aprov, 'nota_minima', it.nota_minima,
    'pontos', v_obt, 'pontos_total', v_total_pts, 'acertos', v_acertos, 'total', v_total,
    'itens', CASE
               WHEN v_gab = 'nunca' THEN NULL
               WHEN v_gab IN ('sempre', 'ao_final') THEN v_itens
               ELSE (SELECT jsonb_agg(i - 'corretas' - 'explicacao') FROM jsonb_array_elements(v_itens) i)
             END);
END $$;
REVOKE ALL ON FUNCTION public.trn_campanha_responder(text, uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trn_campanha_responder(text, uuid, text, text, jsonb) TO anon, authenticated;

-- ── 7) RPC de gestão: duplicar campanha (vira rascunho, slug novo) ───────
CREATE OR REPLACE FUNCTION public.trn_campanha_duplicar(_id uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public."TRN_CAMPANHA"; v_nova uuid;
BEGIN
  IF NOT (public.trn_acesso('treinamentos_campanhas','incluir') OR public.trn_acesso('treinamentos_campanhas','alterar')) THEN
    RAISE EXCEPTION 'Sem permissão para criar campanhas.';
  END IF;
  SELECT * INTO c FROM public."TRN_CAMPANHA" WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campanha não encontrada.'; END IF;

  INSERT INTO public."TRN_CAMPANHA"(titulo, slug, resumo, capa_path, cor, publicada, inicio_em, fim_em, pedir_identificacao, pedir_documento)
  VALUES (c.titulo || ' (cópia)', c.slug || '-copia', c.resumo, c.capa_path, c.cor, false, c.inicio_em, c.fim_em, c.pedir_identificacao, c.pedir_documento)
  RETURNING id INTO v_nova;

  INSERT INTO public."TRN_CAMPANHA_ITEM"(campanha_id, posicao, tipo, titulo, texto, video_url, video_path, imagem_path,
                                         arquivo_path, arquivo_nome, link_url, link_rotulo, quiz, nota_minima, prova_config)
  SELECT v_nova, posicao, tipo, titulo, texto, video_url, video_path, imagem_path,
         arquivo_path, arquivo_nome, link_url, link_rotulo, quiz, nota_minima, prova_config
    FROM public."TRN_CAMPANHA_ITEM" WHERE campanha_id = c.id;
  RETURN v_nova;
END $$;
REVOKE ALL ON FUNCTION public.trn_campanha_duplicar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_campanha_duplicar(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.trn_campanha_duplicar(uuid);
-- DROP FUNCTION IF EXISTS public.trn_campanha_responder(text, uuid, text, text, jsonb);
-- DROP FUNCTION IF EXISTS public.trn_campanha_publica(text, boolean);
-- DROP FUNCTION IF EXISTS public.trn_campanha_no_ar(public."TRN_CAMPANHA");
-- DROP TABLE IF EXISTS public."TRN_CAMPANHA_ACESSO";
-- DROP TABLE IF EXISTS public."TRN_CAMPANHA_RESPOSTA";
-- DROP TABLE IF EXISTS public."TRN_CAMPANHA_ITEM";
-- DROP TABLE IF EXISTS public."TRN_CAMPANHA";
-- DROP FUNCTION IF EXISTS public.trn_campanha_slug();
-- -- Storage: voltar às policies da mig 190 (só trn_ve_modulo()):
-- DROP POLICY IF EXISTS "trn midia insert" ON storage.objects;
-- DROP POLICY IF EXISTS "trn midia update" ON storage.objects;
-- DROP POLICY IF EXISTS "trn midia delete" ON storage.objects;
-- CREATE POLICY "trn midia insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'trn-midia' AND public.trn_ve_modulo());
-- CREATE POLICY "trn midia update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'trn-midia' AND public.trn_ve_modulo());
-- CREATE POLICY "trn midia delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'trn-midia' AND public.trn_ve_modulo());
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'treinamentos_campanhas';
-- DELETE FROM public.app_menu_acao          WHERE menu_codigo = 'treinamentos_campanhas';
-- DELETE FROM public.app_menu               WHERE codigo      = 'treinamentos_campanhas';
-- NOTIFY pgrst, 'reload schema';
