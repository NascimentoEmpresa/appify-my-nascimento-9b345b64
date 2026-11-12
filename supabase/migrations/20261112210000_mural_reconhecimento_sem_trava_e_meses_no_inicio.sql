-- =========================================================================
-- FORMULÁRIOS — MURAL DE RECONHECIMENTO: SEM A TRAVA DO DIA 20 E TODOS OS
-- MESES PUBLICADOS NO INÍCIO
--
-- PEDIDO (12/11/2026, Pablo)
--   1. "Tirar a trava do dia 20": os votos de um mês podiam ir ao mural só a
--      partir do dia 20 do mês seguinte (mig 20261103001300, trigger
--      cs_form_mural_trava_liberacao). Agora dá para publicar QUANDO QUISER —
--      o freio passou a ser humano: a tela pede DUAS confirmações seguidas
--      ("Tem certeza?" e depois "Confirma sua certeza?") antes de liberar.
--      Sai o trigger, sai a função do portão e sai cs_form_mural_libera_em
--      (só o portão a usava).
--   2. No cartão do Início, com mais de um mês publicado, dá para passar os
--      meses (‹ ›), como no modal de moderação.
--   3. BUG: "a Fernanda publicou setembro e não apareceu no Início".
--
-- POR QUE SETEMBRO SUMIU (o bug do item 3)
--   cs_form_mural_inicio (mig 20261030003200) só devolvia o MÊS ANTERIOR ao
--   de hoje em Brasília — em novembro, só outubro. A liberação de setembro
--   gravou certo em CS_FORM_MURAL_RECONHECIMENTO (status 'liberado', mesma
--   assinatura), mas o Início nunca perguntava por setembro: o filtro de mês
--   do Início (aqui e de novo em filtrarMural, no front) jogava fora. Não era
--   RLS nem status diferente — era a janela de um mês só.
--
-- O QUE O INÍCIO LÊ AGORA
--   Todo comentário liberado + positivo (mesmas travas de antes: nota alta,
--   assinatura igual) dos últimos 12 meses, INCLUINDO o mês corrente — sem a
--   trava, dá para publicar novembro em novembro, e publicado aparece. Cada
--   item leva o seu 'mes' ("AAAA-MM", Brasília); 'meses' lista os meses que
--   têm algo, do mais novo ao mais velho; 'mes' é o mais novo (o que o
--   cartão abre). Doze meses é teto de tamanho, não regra de negócio: o
--   cartão é um mural, não um arquivo.
--
--   Compatível com o front antigo enquanto o Lovable não publica: ele lia
--   'mes' + 'itens' e refiltrava o mês anterior — continua funcionando, só
--   sem os outros meses.
--
-- A mesma regra mora em src/lib/formularios/muralReconhecimento.ts
-- (mesesDoMural, testada em src/test/mural-reconhecimento.test.ts): mudou
-- aqui, muda lá.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Fora a trava do dia 20 ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS cs_form_mural_trava_liberacao ON public."CS_FORM_MURAL_RECONHECIMENTO";
DROP FUNCTION IF EXISTS public.cs_form_mural_trava_liberacao();
DROP FUNCTION IF EXISTS public.cs_form_mural_libera_em(timestamptz);

-- ── 2) O Início: todos os meses publicados (até 12) ──────────────────────
CREATE OR REPLACE FUNCTION public.cs_form_mural_inicio()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hoje  timestamp := now() AT TIME ZONE 'America/Sao_Paulo';
  v_ini   timestamptz;
  v_fim   timestamptz;
  v_itens jsonb;
  v_meses jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  -- Do 1º dia de 11 meses atrás até o fim do mês corrente: 12 meses civis.
  v_ini := date_trunc('month', v_hoje - interval '11 months') AT TIME ZONE 'America/Sao_Paulo';
  v_fim := (date_trunc('month', v_hoje) + interval '1 month') AT TIME ZONE 'America/Sao_Paulo';

  WITH pub AS (
    SELECT l.*, m.status,
           to_char(l.enviado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS mes
      FROM public.cs_form_mural_linhas(NULL, v_ini, v_fim) l
      JOIN public."CS_FORM_MURAL_RECONHECIMENTO" m
        ON m.resposta_id = l.resposta_id AND m.pergunta_id = l.pergunta_id AND m.linha = l.linha
       AND m.status = 'liberado' AND m.assinatura = l.assinatura
     WHERE l.positivo
  )
  SELECT jsonb_agg(jsonb_build_object(
           'chave', p.resposta_id::text || ':' || p.pergunta_id || ':' || p.linha,
           'mes', p.mes,
           'colaborador', p.colaborador, 'setor', coalesce(p.setor, c.setor),
           'cargo', c.cargo, 'avatar_url', c.avatar_url,
           'nota', p.nota, 'escala', p.escala, 'comentario', p.comentario,
           'formulario', p.formulario, 'enviado_em', p.enviado_em, 'status', p.status)
         ORDER BY p.mes DESC, p.enviado_em DESC, p.linha),
         (SELECT jsonb_agg(x.mes ORDER BY x.mes DESC) FROM (SELECT DISTINCT mes FROM pub) x)
    INTO v_itens, v_meses
    FROM pub p
    LEFT JOIN LATERAL (
      SELECT pr.avatar_url,
             nullif(btrim(coalesce(e."Título do Cargo", '')), '') AS cargo,
             nullif(btrim(coalesce(e."Setor_ERP", '')), '') AS setor
        FROM public."EMPREGADOS" e
        LEFT JOIN public.profiles pr ON pr.id = e.auth_user_id
       WHERE upper(btrim(e."Nome")) = upper(p.colaborador)
       ORDER BY (coalesce(e."Situação", '') ~* 'demitid'), (e.auth_user_id IS NULL)
       LIMIT 1
    ) c ON true;

  RETURN jsonb_build_object(
    'mes', coalesce(v_meses->>0, to_char(date_trunc('month', v_hoje - interval '1 month'), 'YYYY-MM')),
    'meses', coalesce(v_meses, '[]'::jsonb),
    'itens', coalesce(v_itens, '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.cs_form_mural_inicio() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_mural_inicio() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- Reaplicar a seção 1 e 2 de 20261103001300 (cs_form_mural_libera_em,
-- cs_form_mural_trava_liberacao + trigger) e a seção 5 de 20261030003200
-- (cs_form_mural_inicio só do mês anterior).
-- NOTIFY pgrst, 'reload schema';
-- =========================================================================
