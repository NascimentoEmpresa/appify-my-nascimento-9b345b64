-- =====================================================================
-- Mural do Início — triagem por IA dos comentários antes de publicar
-- (12/11/2026, pedido do Pablo)
--
-- "ao clicar em mural do inicio, preciso que a i.a sugira quais elogios não
-- vão pro mural do inicio tipo: tem um comentário que fala que é mais
-- competente que o lider, que deveria ser o lider do setor, coisas assim,
-- faz esse filtro e mostra me um card já desabilitado esses comentários, se
-- o usuario quiser habilitar aí habilita e manda, mas por padrão devem ficar
-- desabilitados comentários assim."
--
-- A Edge Function mural-triagem-ia lê os positivos do mês por
-- cs_form_mural_triagem (com o JWT de quem abriu o modal), manda para a IA só
-- os que ainda não têm triagem válida e grava o resultado por
-- cs_form_mural_triagem_gravar — abrir o modal de novo não reclassifica.
--
-- A triagem vale para o TEXTO que a IA leu: a assinatura é a mesma de
-- cs_form_mural_linhas (md5 do colaborador + comentário). Texto mudou →
-- triagem velha é ignorada e o comentário volta a ser lido.
--
-- "Não recomendado" não é recusa: o comentário continua pendente, só fica
-- FORA do "Liberar os N" / "Liberar todos" até alguém habilitar
-- (cs_form_mural_triagem_habilitar). Quem decide continua sendo quem tem
-- acesso às permissões do formulário (cs_form_pode(_, 'acesso')), o mesmo
-- portão da moderação.
--
-- Tabela fechada como CS_FORM_MURAL_RECONHECIMENTO: RLS ligada, sem policy,
-- só as RPCs (SECURITY DEFINER) leem e escrevem.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public."CS_FORM_MURAL_TRIAGEM_IA" (
  resposta_id     uuid NOT NULL REFERENCES public."CS_FORM_RESPOSTAS"(id) ON DELETE CASCADE,
  pergunta_id     text NOT NULL,
  linha           integer NOT NULL CHECK (linha >= 0),
  formulario_id   uuid NOT NULL,
  assinatura      text NOT NULL,
  recomendado     boolean NOT NULL,
  motivo          text,
  modelo          text,
  classificado_em timestamptz NOT NULL DEFAULT now(),
  -- Reabilitado à mão (só faz sentido quando recomendado = false).
  habilitado_por  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  habilitado_em   timestamptz,
  PRIMARY KEY (resposta_id, pergunta_id, linha)
);
CREATE INDEX IF NOT EXISTS cs_form_mural_triagem_ia_form_idx
  ON public."CS_FORM_MURAL_TRIAGEM_IA" (formulario_id);

ALTER TABLE public."CS_FORM_MURAL_TRIAGEM_IA" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CS_FORM_MURAL_TRIAGEM_IA" FROM PUBLIC, anon, authenticated;

-- ── 1) Positivos do mês + triagem válida (ou null) ───────────────────────
-- Devolve o texto porque é a Edge que precisa dele para perguntar à IA; o
-- portão é o mesmo da fila de moderação, que já mostra esse texto.
CREATE OR REPLACE FUNCTION public.cs_form_mural_triagem(_form_id uuid, _mes date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ini timestamptz;
  v_fim timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.cs_form_pode(_form_id, 'acesso') THEN
    RAISE EXCEPTION 'Sem permissão para liberar o mural deste formulário.' USING ERRCODE = '42501';
  END IF;

  v_ini := date_trunc('month', _mes::timestamp) AT TIME ZONE 'America/Sao_Paulo';
  v_fim := (date_trunc('month', _mes::timestamp) + interval '1 month') AT TIME ZONE 'America/Sao_Paulo';

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'resposta_id', l.resposta_id, 'pergunta_id', l.pergunta_id, 'linha', l.linha,
             'colaborador', l.colaborador, 'setor', l.setor, 'comentario', l.comentario,
             'assinatura', l.assinatura,
             'status', CASE WHEN m.assinatura = l.assinatura THEN m.status ELSE 'pendente' END,
             'triado', t.assinatura IS NOT NULL,
             'recomendado', t.recomendado,
             'motivo', t.motivo,
             'habilitado', t.habilitado_em IS NOT NULL)
           ORDER BY l.enviado_em, l.linha)
      FROM public.cs_form_mural_linhas(_form_id, v_ini, v_fim) l
      LEFT JOIN public."CS_FORM_MURAL_RECONHECIMENTO" m
        ON m.resposta_id = l.resposta_id AND m.pergunta_id = l.pergunta_id AND m.linha = l.linha
      LEFT JOIN public."CS_FORM_MURAL_TRIAGEM_IA" t
        ON t.resposta_id = l.resposta_id AND t.pergunta_id = l.pergunta_id AND t.linha = l.linha
       AND t.assinatura = l.assinatura
     WHERE l.positivo
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.cs_form_mural_triagem(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_mural_triagem(uuid, date) TO authenticated;

-- ── 2) Gravar o que a IA decidiu (em lote) ───────────────────────────────
-- _itens: [{resposta_id, pergunta_id, linha, assinatura, recomendado, motivo}]
-- Só grava linha de resposta DESTE formulário. Assinatura nova zera a
-- reabilitação (era de outro texto).
CREATE OR REPLACE FUNCTION public.cs_form_mural_triagem_gravar(_form_id uuid, _itens jsonb, _modelo text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.cs_form_pode(_form_id, 'acesso') THEN
    RAISE EXCEPTION 'Sem permissão para liberar o mural deste formulário.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_itens) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Lista de itens inválida.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public."CS_FORM_MURAL_TRIAGEM_IA" AS t
         (resposta_id, pergunta_id, linha, formulario_id, assinatura, recomendado, motivo, modelo, classificado_em)
  SELECT (i->>'resposta_id')::uuid, i->>'pergunta_id', (i->>'linha')::int, _form_id,
         i->>'assinatura', coalesce((i->>'recomendado')::boolean, true),
         left(nullif(btrim(coalesce(i->>'motivo', '')), ''), 200), left(_modelo, 80), now()
    FROM jsonb_array_elements(_itens) i
    JOIN public."CS_FORM_RESPOSTAS" r ON r.id = (i->>'resposta_id')::uuid AND r.formulario_id = _form_id
   WHERE coalesce(i->>'pergunta_id', '') <> '' AND coalesce(i->>'assinatura', '') <> ''
     AND (i->>'linha') ~ '^[0-9]+$'
  ON CONFLICT (resposta_id, pergunta_id, linha) DO UPDATE
     SET assinatura = EXCLUDED.assinatura, recomendado = EXCLUDED.recomendado,
         motivo = EXCLUDED.motivo, modelo = EXCLUDED.modelo, classificado_em = EXCLUDED.classificado_em,
         habilitado_por = CASE WHEN t.assinatura = EXCLUDED.assinatura THEN t.habilitado_por END,
         habilitado_em  = CASE WHEN t.assinatura = EXCLUDED.assinatura THEN t.habilitado_em END;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.cs_form_mural_triagem_gravar(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_mural_triagem_gravar(uuid, jsonb, text) TO authenticated;

-- ── 3) Habilitar / desabilitar à mão um não recomendado ──────────────────
CREATE OR REPLACE FUNCTION public.cs_form_mural_triagem_habilitar(
  _resposta_id uuid, _pergunta_id text, _linha integer, _habilitado boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_form uuid;
BEGIN
  SELECT r.formulario_id INTO v_form FROM public."CS_FORM_RESPOSTAS" r WHERE r.id = _resposta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resposta não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NULL OR NOT public.cs_form_pode(v_form, 'acesso') THEN
    RAISE EXCEPTION 'Sem permissão para liberar o mural deste formulário.' USING ERRCODE = '42501';
  END IF;

  UPDATE public."CS_FORM_MURAL_TRIAGEM_IA"
     SET habilitado_por = CASE WHEN _habilitado THEN auth.uid() END,
         habilitado_em  = CASE WHEN _habilitado THEN now() END
   WHERE resposta_id = _resposta_id AND pergunta_id = _pergunta_id AND linha = _linha;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este comentário ainda não passou pela triagem.' USING ERRCODE = 'P0002';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.cs_form_mural_triagem_habilitar(uuid, text, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_mural_triagem_habilitar(uuid, text, integer, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.cs_form_mural_triagem_habilitar(uuid, text, integer, boolean);
-- DROP FUNCTION IF EXISTS public.cs_form_mural_triagem_gravar(uuid, jsonb, text);
-- DROP FUNCTION IF EXISTS public.cs_form_mural_triagem(uuid, date);
-- DROP TABLE IF EXISTS public."CS_FORM_MURAL_TRIAGEM_IA";
