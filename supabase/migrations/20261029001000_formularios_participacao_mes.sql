-- =========================================================================
-- FORMULÁRIOS — QUEM JÁ RESPONDEU NO MÊS E QUANTOS FALTAM
--
-- PEDIDO (29/10/2026, Pablo)
--   Na aba Resumo das respostas (ex.: AVALIAÇÃO DE RECONHECIMENTO E
--   CONVIVÊNCIA PROFISSIONAL, 1 resposta por mês civil) navegar mês a mês e
--   ver, no mês escolhido, quantos do público-alvo já votaram e quantos faltam.
--
-- POR QUE UMA RPC
--   * O público-alvo não é uma tabela: é a conta de `cs_form_alvo`, que só
--     responde "e EU, posso?" (auth.uid()). Aqui ela é refeita para TODOS os
--     usuários, ramo por ramo, com o mesmo corpo da versão no ar (mig 276):
--     restrito sem filtro = todo logado; setores_acesso pelo Setor_ERP;
--     setor ENCARREGADOS pela user_setor; CS_FORM_ALVO_USUARIOS; e a lista
--     do botão "Acesso" SOMA ao alvo (mig 20260921000004).
--   * Quem respondeu sai de CS_FORM_ENVIOS — o relógio do intervalo, que é
--     fechado a anon/authenticated justamente para não desanonimizar.
--
-- QUEM PODE CHAMAR
--   Só quem lê TODAS as respostas do formulário (mesma régua do ramo "todas"
--   de cs_form_resp_select / respsEscopo da tela): ver_tudo valendo no
--   formulário, setor-dono, ou papel da lista. Quem lê só as próprias ou só
--   um setor não ganha a participação do formulário inteiro por aqui.
--
-- ANONIMATO
--   Formulário que aceita resposta anônima (ou que tem anônima no mês) devolve
--   SÓ os números: a lista de quem falta é o complemento de quem votou, e
--   entregá-la diria quem respondeu. `faltantes` vem NULL nesses casos.
--
-- UNIVERSO
--   "Qualquer logado" = profiles.ativo e login não bloqueado pela situação
--   (erp_login_bloqueado): demitido não "falta" votar.
--   Formulário 'liberado' (link sem login) não tem alvo contável: devolve
--   `alvo_total` NULL e a tela mostra só as respostas.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.cs_form_participacao_mes(_form_id uuid, _mes date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_form     record;
  v_ini      timestamptz;
  v_fim      timestamptz;
  v_anonimo  boolean;
  v_total    int;
  v_resp     int;
  v_faltam   jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  SELECT f.id, f.seguranca, f.setores_acesso, f.permite_anonimo
    INTO v_form
    FROM public."CS_FORMULARIOS" f
   WHERE f.id = _form_id AND f.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Formulário não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
       (NOT public.cs_form_lista_exclui(_form_id)
         AND (public.cs_form_cap_ver(_form_id, 'ver_tudo') OR public.cs_form_cap_form_setor(_form_id)))
       OR public.cs_form_pode(_form_id, 'ver')
     ) THEN
    RAISE EXCEPTION 'Sem permissão para ver a participação deste formulário.' USING ERRCODE = '42501';
  END IF;

  -- Mês civil de Brasília, a mesma régua de cs_form_pode_responder (mig 189).
  v_ini := date_trunc('month', _mes::timestamp) AT TIME ZONE 'America/Sao_Paulo';
  v_fim := (date_trunc('month', _mes::timestamp) + interval '1 month') AT TIME ZONE 'America/Sao_Paulo';

  v_anonimo := v_form.permite_anonimo OR EXISTS (
    SELECT 1 FROM public."CS_FORM_RESPOSTAS" r
     WHERE r.formulario_id = _form_id AND r.anonimo
       AND r.enviado_em >= v_ini AND r.enviado_em < v_fim);

  IF v_form.seguranca = 'liberado' THEN
    RETURN jsonb_build_object('alvo_total', NULL, 'responderam', NULL, 'faltam', NULL,
                              'anonimo', v_anonimo, 'faltantes', NULL);
  END IF;

  -- Função STABLE: nada de tabela temporária, tudo numa consulta só.
  -- MATERIALIZED: a checagem de login travado (CPF, situação, exceção) roda
  -- só sobre quem já passou no alvo, não sobre todos os profiles.
  WITH alvo AS MATERIALIZED (
    SELECT p.id AS user_id,
           EXISTS (SELECT 1 FROM public."CS_FORM_ENVIOS" e
                    WHERE e.formulario_id = _form_id AND e.user_id = p.id
                      AND e.enviado_em >= v_ini AND e.enviado_em < v_fim) AS respondeu
      FROM public.profiles p
     WHERE p.ativo
       AND (
         (COALESCE(array_length(v_form.setores_acesso, 1), 0) = 0
          AND NOT EXISTS (SELECT 1 FROM public."CS_FORM_ALVO_USUARIOS" u WHERE u.formulario_id = _form_id))
         OR EXISTS (SELECT 1 FROM public."EMPREGADOS" e
                     WHERE e.auth_user_id = p.id AND e."Setor_ERP" = ANY (v_form.setores_acesso))
         OR (public.cs_form_para_encarregados(v_form.setores_acesso) AND public.cs_form_eh_encarregado(p.id))
         OR EXISTS (SELECT 1 FROM public."CS_FORM_ALVO_USUARIOS" u
                     WHERE u.formulario_id = _form_id AND u.user_id = p.id)
         -- a lista do botão "Acesso" SOMA ao alvo (mig 20260921000004)
         OR EXISTS (SELECT 1 FROM public."CS_FORM_ACESSOS" a
                     WHERE a.formulario_id = _form_id AND a.user_id = p.id
                       AND a.papel IN ('form_dono','form_gerenciar','form_editar','form_ver'))
       )
  ), ativos AS MATERIALIZED (
    -- Login travado pela situação (demitido etc.) não "falta" votar.
    SELECT alvo.* FROM alvo WHERE NOT public.erp_login_bloqueado(alvo.user_id)
  )
  SELECT count(*)::int,
         (count(*) FILTER (WHERE a.respondeu))::int,
         CASE WHEN v_anonimo THEN NULL ELSE coalesce(
           jsonb_agg(jsonb_build_object('nome', n.nome, 'setor', n.setor) ORDER BY n.nome)
             FILTER (WHERE NOT a.respondeu), '[]'::jsonb) END
    INTO v_total, v_resp, v_faltam
    FROM ativos a
    JOIN public.profiles p ON p.id = a.user_id
    LEFT JOIN LATERAL (
      SELECT e."Nome"::text AS nome_emp, e."Setor_ERP"::text AS setor_emp
        FROM public."EMPREGADOS" e
       WHERE e.auth_user_id = a.user_id LIMIT 1
    ) emp ON true
    CROSS JOIN LATERAL (
      SELECT coalesce(nullif(btrim(emp.nome_emp), ''), nullif(btrim(p.display_name), ''), p.email, '?') AS nome,
             nullif(btrim(emp.setor_emp), '') AS setor
    ) n;

  RETURN jsonb_build_object('alvo_total', v_total, 'responderam', v_resp, 'faltam', v_total - v_resp,
                            'anonimo', v_anonimo, 'faltantes', v_faltam);
END $$;

REVOKE ALL ON FUNCTION public.cs_form_participacao_mes(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_participacao_mes(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.cs_form_participacao_mes(uuid, date);
-- NOTIFY pgrst, 'reload schema';
-- =========================================================================
