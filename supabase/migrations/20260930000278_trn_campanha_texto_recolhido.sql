-- =====================================================================
-- Campanhas: texto recolhido (título + setinha, abre ao clicar)
-- 30/09/2026
--
-- "Ao criar uma campanha, ter como criar textos assim, onde só apareça o
-- título do texto com uma setinha ao lado e, ao clicar na setinha, apareça
-- toda a descrição" (Pablo, com print das seções da Wikipédia).
--
-- Um item de texto ganha a opção `recolhido`: na página pública ele aparece
-- só com o título e a setinha; o conteúdo abre e fecha ao tocar. Vários
-- textos recolhidos em sequência formam a lista de seções da referência.
-- A página pública lê pela RPC trn_campanha_publica (anon não lê a tabela),
-- então ela passa a devolver o campo; duplicar a campanha também o copia.
-- =====================================================================

ALTER TABLE public."TRN_CAMPANHA_ITEM" ADD COLUMN IF NOT EXISTS recolhido boolean NOT NULL DEFAULT false;

-- 1) Página pública: devolve `recolhido` (resto igual à mig 268).
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
           'id', i.id, 'tipo', i.tipo, 'titulo', i.titulo, 'texto', i.texto, 'recolhido', i.recolhido,
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

-- 2) Duplicar a campanha copia também o `recolhido`.
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

  INSERT INTO public."TRN_CAMPANHA_ITEM"(campanha_id, posicao, tipo, titulo, texto, recolhido, video_url, video_path, imagem_path,
                                         arquivo_path, arquivo_nome, link_url, link_rotulo, quiz, nota_minima, prova_config)
  SELECT v_nova, posicao, tipo, titulo, texto, recolhido, video_url, video_path, imagem_path,
         arquivo_path, arquivo_nome, link_url, link_rotulo, quiz, nota_minima, prova_config
    FROM public."TRN_CAMPANHA_ITEM" WHERE campanha_id = c.id;
  RETURN v_nova;
END $$;
REVOKE ALL ON FUNCTION public.trn_campanha_duplicar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_campanha_duplicar(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (recriar trn_campanha_publica e trn_campanha_duplicar como na mig 268)
-- ALTER TABLE public."TRN_CAMPANHA_ITEM" DROP COLUMN IF EXISTS recolhido;
