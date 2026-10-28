-- =========================================================================
-- SISTEMAS › TV's — AVISO GERAL COM IMAGEM (28/10/2026)
--
-- Pablo: "deixar colocar uma IMAGEM no aviso geral, que aparece na tela
-- inteira das TVs pelo tempo que eu escolher, em segundos ou minutos".
--
--   · imagem: caminho no bucket público tv-midia (o mesmo da playlist — a TV
--     não tem login), pasta aviso/. O aviso pode ser só texto, só imagem ou
--     os dois; texto continua NOT NULL ('' quando é só imagem) para não
--     quebrar quem lê a coluna.
--   · duracao_seg: o tempo escolhido, sempre em segundos (a tela deixa
--     escolher segundos ou minutos). A TV consulta o ERP a cada 15 s, então
--     um aviso de 20 s pelo `fim` podia aparecer só 5 s. Agora a TV conta o
--     tempo a partir de quando ELA desenhou o aviso, e o `fim` gravado leva
--     uma folga (2 consultas) para o tv_estado seguir devolvendo o aviso
--     até a TV terminar de contar. Encerrar continua imediato: o aviso some
--     do tv_estado e a TV tira na próxima consulta.
--     NULL = aviso antigo, vale só o `fim` (comportamento de antes).
--
-- tv_estado é a da mig 20261020000004 com imagem/duracao_seg/inicio no
-- 'alerta'. Idempotente.
-- =========================================================================

ALTER TABLE public."TV_ALERTA" ADD COLUMN IF NOT EXISTS imagem text;
ALTER TABLE public."TV_ALERTA" ADD COLUMN IF NOT EXISTS duracao_seg integer;

ALTER TABLE public."TV_ALERTA" DROP CONSTRAINT IF EXISTS tv_alerta_duracao_seg_ck;
ALTER TABLE public."TV_ALERTA" ADD CONSTRAINT tv_alerta_duracao_seg_ck CHECK (duracao_seg IS NULL OR duracao_seg BETWEEN 5 AND 86400);
ALTER TABLE public."TV_ALERTA" DROP CONSTRAINT IF EXISTS tv_alerta_texto_ou_imagem_ck;
ALTER TABLE public."TV_ALERTA" ADD CONSTRAINT tv_alerta_texto_ou_imagem_ck CHECK (btrim(texto) <> '' OR imagem IS NOT NULL);

CREATE OR REPLACE FUNCTION public.tv_estado(p_token text, p_tela text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp' AS $function$
DECLARE d public."TV_DISPOSITIVO"; v_cmd text;
BEGIN
  SELECT * INTO d FROM public."TV_DISPOSITIVO" WHERE token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  IF NOT FOUND THEN RETURN jsonb_build_object('desconhecida', true); END IF;
  v_cmd := CASE WHEN d.comando IS NOT NULL AND d.comando_em > now() - interval '10 minutes' THEN d.comando END;
  UPDATE public."TV_DISPOSITIVO" SET ultimo_ping = now(), tela = coalesce(left(p_tela, 30), tela), comando = NULL, comando_em = NULL WHERE id = d.id;
  IF d.pareado_em IS NULL THEN RETURN jsonb_build_object('pareada', false, 'codigo', d.codigo); END IF;
  RETURN jsonb_build_object(
    'pareada', true, 'nome', d.nome, 'local', d.local, 'ativa', d.ativo, 'comando', v_cmd,
    'itens', CASE WHEN NOT d.ativo THEN '[]'::jsonb ELSE (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'tipo', i.tipo, 'titulo', i.titulo, 'url', i.url, 'arquivo', i.arquivo,
                                                   'texto', i.texto, 'cor', i.cor, 'duracao_seg', i.duracao_seg, 'relatorio', i.relatorio,
                                                   'rel_periodo', i.rel_periodo, 'rel_visual', i.rel_visual) ORDER BY i.ordem, i.created_at), '[]'::jsonb)
        FROM public."TV_ITEM" i
       WHERE i.playlist_id = d.playlist_id AND i.ativo
         AND (i.valido_de IS NULL OR i.valido_de <= now()) AND (i.valido_ate IS NULL OR i.valido_ate > now())) END,
    'alerta', (SELECT jsonb_build_object('id', a.id, 'texto', a.texto, 'cor', a.cor, 'fim', a.fim, 'inicio', a.inicio,
                                         'imagem', a.imagem, 'duracao_seg', a.duracao_seg)
                 FROM public."TV_ALERTA" a
                WHERE a.encerrado_em IS NULL AND a.inicio <= now() AND a.fim > now() AND (a.todas OR d.id = ANY (a.dispositivos))
                ORDER BY a.created_at DESC LIMIT 1));
END $function$;
REVOKE ALL ON FUNCTION public.tv_estado(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tv_estado(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (recriar a tv_estado da mig 20261020000004)
-- ALTER TABLE public."TV_ALERTA" DROP CONSTRAINT IF EXISTS tv_alerta_texto_ou_imagem_ck;
-- ALTER TABLE public."TV_ALERTA" DROP CONSTRAINT IF EXISTS tv_alerta_duracao_seg_ck;
-- ALTER TABLE public."TV_ALERTA" DROP COLUMN IF EXISTS duracao_seg;
-- ALTER TABLE public."TV_ALERTA" DROP COLUMN IF EXISTS imagem;
