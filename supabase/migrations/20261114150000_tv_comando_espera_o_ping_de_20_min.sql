-- =========================================================================
-- TVs: O COMANDO ESPERA O PING DE 20 MIN (13/11/2026)
--
-- Pablo: "não pode ter nem 2k de requisições por dia" (todas as TVs). A
-- pergunta de comando a cada 1 min (tv_tem_comando, mig 20261114140000) dava
-- ~19 mil consultas/dia com 13 TVs. A TV agora só fala com o banco no ping
-- (tv_estado), de 20 em 20 min: ~940 consultas/dia (src/lib/tv/tv.ts).
--
-- Problema que isso criaria: a tv_estado descarta comando com mais de 10 min.
-- Com ping de 20 min, o Recarregar dado logo depois de um ping seria jogado
-- fora calado no seguinte. A janela passa a 1 h (folga para um ping perdido
-- e para a TV que demorou a abrir). O resto da função é igual à da mig
-- 20261028000021.
--
-- A tv_tem_comando fica no banco: TV que ainda roda o JS antigo segue
-- perguntando até se recarregar (a conferência de versão do ping cuida
-- disso), e sem a função ela só pararia de perguntar.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

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
    'itens', CASE WHEN NOT d.ativo THEN '[]'::jsonb ELSE (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'tipo', i.tipo, 'titulo', i.titulo, 'url', i.url, 'arquivo', i.arquivo,
                                                   'texto', i.texto, 'cor', i.cor, 'duracao_seg', i.duracao_seg, 'relatorio', i.relatorio,
                                                   'rel_periodo', i.rel_periodo, 'rel_visual', i.rel_visual) ORDER BY i.ordem, i.created_at), '[]'::jsonb)
        FROM public."TV_ITEM" i
       WHERE i.playlist_id = d.playlist_id AND i.ativo
         AND (i.valido_de IS NULL OR i.valido_de <= now()) AND (i.valido_ate IS NULL OR i.valido_ate > now())) END,
    'alerta', (SELECT jsonb_build_object('id', a.id, 'texto', a.texto, 'cor', a.cor, 'fim', a.fim, 'inicio', a.inicio,
                                         'imagem', a.imagem, 'duracao_seg', a.duracao_seg, 'layout', a.layout)
                 FROM public."TV_ALERTA" a
                WHERE a.encerrado_em IS NULL AND a.inicio <= now() AND a.fim > now() AND (a.todas OR d.id = ANY (a.dispositivos))
                ORDER BY a.created_at DESC LIMIT 1));
END $function$;
REVOKE ALL ON FUNCTION public.tv_estado(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tv_estado(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Recriar a tv_estado da mig 20261028000021 (a mesma acima, com
-- interval '10 minutes' no lugar de interval '1 hour').
