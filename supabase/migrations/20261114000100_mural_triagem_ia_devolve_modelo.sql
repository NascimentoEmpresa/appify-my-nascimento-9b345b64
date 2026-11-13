-- =====================================================================
-- [SEM-CHAMADO] Mural do Início — triagem por IA mais rigorosa (régua v2)
--
-- 12/11/2026, Pablo: "a i.a não tá sugerindo nada de descente [...] dá pra
-- tirar bem mais comentários que podem ser um risco".
--
-- A régua nova mora na Edge (supabase/functions/_shared/mural-triagem-ia.ts)
-- e grava a versão no começo de `modelo` ("v2|gemini:..."). Para a Edge saber
-- quem foi lido pela régua antiga e reler só esses, cs_form_mural_triagem
-- passa a devolver `modelo`. Nada mais muda: mesma assinatura, mesmo portão
-- (cs_form_pode(_, 'acesso')), mesmas colunas da tabela.
--
-- A releitura só acontece para pendente que a régua antiga RECOMENDOU; o que
-- já foi desabilitado, ou habilitado à mão, fica como está (e o gravar já
-- preserva o "habilitado" quando a assinatura é a mesma).
--
-- Idempotente (CREATE OR REPLACE da mesma assinatura). ROLLBACK no fim.
-- =====================================================================
SET lock_timeout = '5s';

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
             'habilitado', t.habilitado_em IS NOT NULL,
             'modelo', t.modelo)
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

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK: reaplicar a função da 20261112234500 (a mesma, sem 'modelo').
-- A Edge v2 sem 'modelo' trata tudo como régua antiga e relê os
-- recomendados a cada abertura — volte também a Edge para a v1.
-- =====================================================================
