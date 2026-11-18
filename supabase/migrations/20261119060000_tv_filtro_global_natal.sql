-- =========================================================================
-- SISTEMAS › TV's — FILTROS DE TELA PARA TODAS AS TVs (18/11/2026)
--
-- Pablo, com o mascote de Natal (o "bigodinho"): "filtros pras TVs, por
-- enquanto só o de Natal — ao adicionar, todas as TVs ficam com esse
-- filtro". O filtro é uma camada POR CIMA do que a TV mostra (neve, brilho,
-- o mascote num canto); não mexe em playlist nem em relatório.
--
--   · TV_CONFIG: config GLOBAL das TVs, uma linha só (id = 1). Não existia
--     config global — o que havia era por TV (TV_DISPOSITIVO) ou por aviso
--     (TV_ALERTA). Fica pronta para outras chaves globais no futuro.
--   · filtro_ativo: NULL = sem filtro; 'natal' = Filtro de Natal. Filtro
--     novo = só ampliar o CHECK (e desenhar no front, src/pages/tv/FiltroTv.tsx).
--   · Quem liga/desliga: quem tem 'alterar' em sistemas_tvs (o mesmo do
--     Recarregar), pela tv_definir_filtro. Ler: quem vê a tela.
--   · A TV recebe o filtro no tv_estado (o ping de 20 min — sem timer novo,
--     ver INTERVALO_PING_S em src/lib/tv/tv.ts). Quem liga pode usar o
--     "Recarregar todas" para não esperar.
--
-- tv_estado é a da mig 20261118140000 com a chave 'filtro'. Idempotente.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."TV_CONFIG" (
  id smallint PRIMARY KEY DEFAULT 1,
  filtro_ativo text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  CONSTRAINT tv_config_uma_linha_ck CHECK (id = 1)
);
ALTER TABLE public."TV_CONFIG" DROP CONSTRAINT IF EXISTS tv_config_filtro_ck;
ALTER TABLE public."TV_CONFIG" ADD CONSTRAINT tv_config_filtro_ck CHECK (filtro_ativo IS NULL OR filtro_ativo IN ('natal'));
INSERT INTO public."TV_CONFIG" (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public."TV_CONFIG" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tv_config_select ON public."TV_CONFIG";
CREATE POLICY tv_config_select ON public."TV_CONFIG" FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar'));
-- Escrita só pela tv_definir_filtro (SECURITY DEFINER): sem policy de INSERT/UPDATE/DELETE.
REVOKE ALL ON public."TV_CONFIG" FROM anon;
GRANT SELECT ON public."TV_CONFIG" TO authenticated;

CREATE OR REPLACE FUNCTION public.tv_definir_filtro(p_filtro text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'sistemas_tvs', 'alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para alterar as TVs.' USING ERRCODE = '42501';
  END IF;
  p_filtro := NULLIF(btrim(coalesce(p_filtro, '')), '');
  INSERT INTO public."TV_CONFIG" (id, filtro_ativo, atualizado_em, atualizado_por)
  VALUES (1, p_filtro, now(), auth.uid())
  ON CONFLICT (id) DO UPDATE SET filtro_ativo = EXCLUDED.filtro_ativo, atualizado_em = now(), atualizado_por = auth.uid();
END $fn$;
REVOKE ALL ON FUNCTION public.tv_definir_filtro(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tv_definir_filtro(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.tv_definir_filtro(text) TO authenticated;

-- ── tv_estado: igual à da mig 20261118140000, com o 'filtro' ──────────────
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
                ORDER BY a.created_at DESC LIMIT 1),
    'filtro', (SELECT c.filtro_ativo FROM public."TV_CONFIG" c WHERE c.id = 1));
END $function$;
REVOKE ALL ON FUNCTION public.tv_estado(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tv_estado(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (recriar a tv_estado da mig 20261118140000, sem o 'filtro')
-- DROP FUNCTION IF EXISTS public.tv_definir_filtro(text);
-- DROP TABLE IF EXISTS public."TV_CONFIG";
-- NOTIFY pgrst, 'reload schema';
