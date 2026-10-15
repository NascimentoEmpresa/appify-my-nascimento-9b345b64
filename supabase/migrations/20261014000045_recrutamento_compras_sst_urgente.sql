-- =========================================================================
-- RECRUTAMENTO ↔ COMPRAS e SST (14/10/2026)
--
-- Pablo, com o print do kanban (coluna "SST + COMPRAS"):
--   "Integrar kanban do recrutamento no compras, quando for enviado ao
--    compras e ser aprovado no EPIs admissões, ir direto pro PEDIDOS DE
--    MATERIAIS. Quando for enviado pro status compras, tem que ser anexado a
--    imagem do candidato pro crachá e a quantidade de itens. SST tem que
--    conseguir marcar como VISTO igual do demissional […] RH ao enviar pro
--    COMPRAS e SST tem que conseguir marcar como urgente, pra aparecer um card
--    na tela dos respectivos setores."
--
-- O que muda:
--   1. WA_CURRICULOS ganha a foto do crachá (cracha_foto_path, bucket
--      sup-crachas), o VISTO de cada setor (sst_visto_*, compras_visto_*) e a
--      marca de URGENTE por setor (urgente_sst / urgente_compras + quem/quando/
--      motivo). A view VW_RECRUTAMENTO_CANDIDATOS passa a expor tudo isso.
--   2. rec_enxoval_informar recebe a QUANTIDADE de cada item e a foto; a foto
--      é obrigatória (do candidato ou do enxoval). rec_enxoval_preview devolve
--      as duas coisas para a tela.
--   3. sup_adm_criar_pedido usa a foto do candidato quando o enxoval não tem.
--   4. sup_adm_aprovar_compras: o "Materiais providenciados" do EPIs —
--      Admissões vira UMA operação: gera o pedido de materiais (se o enxoval
--      está pronto e ainda não tem pedido) e carimba o Compras. O pedido cai
--      em Suprimentos › Pedidos de Materiais na hora.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- ── 1. Colunas ─────────────────────────────────────────────────────────────
ALTER TABLE public."WA_CURRICULOS"
  ADD COLUMN IF NOT EXISTS cracha_foto_path  text,
  ADD COLUMN IF NOT EXISTS sst_visto_em      timestamptz,
  ADD COLUMN IF NOT EXISTS sst_visto_por     text,
  ADD COLUMN IF NOT EXISTS compras_visto_em  timestamptz,
  ADD COLUMN IF NOT EXISTS compras_visto_por text,
  ADD COLUMN IF NOT EXISTS urgente_sst       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS urgente_compras   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS urgente_em        timestamptz,
  ADD COLUMN IF NOT EXISTS urgente_por       text,
  ADD COLUMN IF NOT EXISTS urgente_motivo    text,
  -- O link do Maps do exame: a tela antiga gravava e caía num contorno porque a coluna nunca existiu.
  ADD COLUMN IF NOT EXISTS sst_maps_url      text;

-- O card de urgente consulta isso a cada minuto em todas as telas.
CREATE INDEX IF NOT EXISTS wa_curriculos_urgente_idx ON public."WA_CURRICULOS" (etapa_processo)
  WHERE urgente_sst OR urgente_compras;

-- ── View: as colunas novas entram no FIM (CREATE OR REPLACE só aceita assim) ─
CREATE OR REPLACE VIEW public."VW_RECRUTAMENTO_CANDIDATOS" WITH (security_invoker = true) AS
 SELECT c.id AS candidato_id,
    c.vaga_id, c.nome, c.telefone, c.email,
    COALESCE(c.cpf, c.cpf_cand) AS cpf,
    c.origem, c.storage_path, c.mensagem, c.etapa_processo, c.etapa_changed_at,
    c.selecionado_por, c.selecionado_em,
    c.juridico_ok, c.juridico_obs, c.juridico_por, c.juridico_em,
    c.sst_ok, c.sst_obs, c.sst_por, c.sst_em, c.sst_data_exame, c.sst_hora_exame, c.sst_local_exame,
    c.sst_agendado_por, c.sst_agendado_em,
    c.compras_necessidades, c.compras_por, c.compras_em, c.compras_obs, c.compras_data_chegada,
    c.epis_informados, c.epis_informados_em,
    c.enviado_admissao_por, c.enviado_admissao_em, c.admitido_por, c.admitido_em,
    c.empregado_id, c.motivo_reprovacao,
    c.experiencia_1, c.experiencia_2, c.experiencia_3,
    c.favorito, c.tipo_candidatura,
    c.created_at AS candidatura_em,
    s.cargo, s.contrato, s.cidade, s.status AS vaga_status, s.motivo_vaga, s.nome_substituido,
    s.escala, s.horario, s.salario, s.beneficios, s.insalubridade_recebe, s.insalubridade_quanto,
    s.local_exato, s.data_inicio_prevista, s.quantidade_vagas,
    s.req_obrigatorios, s.req_desejaveis, s.exp_minima, s.exp_minima_qual, s.grau_urgencia,
    s.solicitante_nome,
    (b.cpf_digits IS NOT NULL) AS possui_restricao,
    b.motivo AS restricao_motivo,
    c.compras_ok,
    c.desistiu, c.desistencia_motivo, c.desistencia_etapa, c.desistencia_em, c.desistencia_por,
    s.contrato_id, s.posto_id, s.funcao_id,
    c.juridico_nivel, c.juridico_pulado,
    -- 14/10/2026
    c.cracha_foto_path,
    c.sst_visto_em, c.sst_visto_por, c.compras_visto_em, c.compras_visto_por,
    c.urgente_sst, c.urgente_compras, c.urgente_em, c.urgente_por, c.urgente_motivo,
    c.sst_maps_url
   FROM ((public."WA_CURRICULOS" c
     JOIN public."SISTEMA_RECRUTAMENTO" s ON ((s.id = c.vaga_id)))
     LEFT JOIN public."RECRUTAMENTO_CPF_BLACKLIST" b ON ((b.cpf_digits = regexp_replace(COALESCE(c.cpf, c.cpf_cand, ''::text), '\D'::text, ''::text, 'g'::text))))
  WHERE (c.etapa_processo IS NOT NULL);

-- ── 2a. Enxoval: quantidade e foto ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.rec_enxoval_informar(bigint, uuid, uuid, uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.rec_enxoval_informar(bigint, uuid, uuid, uuid, jsonb, text, text);
CREATE FUNCTION public.rec_enxoval_informar(p_candidato_id bigint, p_contrato_id uuid, p_posto_id uuid, p_funcao_id uuid,
                                            p_itens jsonb, p_obs text DEFAULT NULL, p_foto_path text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_vaga_id bigint;
  v_foto_cand text;
  v_foto    text;
  v_enx     public.sup_admissao_enxoval;
  v_enx_id  uuid;
  v_tem_hist boolean := false;
  v_faltam  text;
  v_fora    text;
  v_resumo  text;
BEGIN
  IF NOT public.can_access(v_uid, 'recrutamento_gestao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para informar o enxoval (Gestão Recrutamento › Alterar).' USING ERRCODE = '42501';
  END IF;
  IF p_contrato_id IS NULL OR p_posto_id IS NULL OR p_funcao_id IS NULL THEN
    RAISE EXCEPTION 'Escolha o contrato, o posto e a função do Catálogo.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sup_funcao f WHERE f.id = p_funcao_id AND f.posto_id = p_posto_id) THEN
    RAISE EXCEPTION 'A função não pertence ao posto escolhido.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sup_posto p WHERE p.id = p_posto_id AND p.contrato_id = p_contrato_id) THEN
    RAISE EXCEPTION 'O posto não pertence ao contrato escolhido.';
  END IF;
  IF jsonb_typeof(coalesce(p_itens, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'Itens inválidos.'; END IF;

  PERFORM pg_advisory_xact_lock(p_candidato_id);
  SELECT c.vaga_id, c.cracha_foto_path INTO v_vaga_id, v_foto_cand FROM public."WA_CURRICULOS" c WHERE c.id = p_candidato_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidato não encontrado.'; END IF;

  -- Validação contra o catálogo: todo item com grade precisa de tamanho da grade.
  WITH itens AS (
    SELECT i.id, i.nome, public.rec_enxoval_grade(i.id) AS grade,
           nullif(btrim((SELECT e->>'tamanho' FROM jsonb_array_elements(p_itens) e WHERE e->>'item_id' = i.id::text LIMIT 1)), '') AS tamanho
      FROM public.sup_funcao_item fi JOIN public.sup_item i ON i.id = fi.item_id
     WHERE fi.funcao_id = p_funcao_id AND fi.ativo AND fi.aprovado AND i.ativo AND i.aprovado
  ),
  usados AS (SELECT * FROM itens WHERE tamanho IS DISTINCT FROM 'NAO_PRECISA')
  SELECT string_agg(nome, ', ') FILTER (WHERE cardinality(grade) > 0 AND tamanho IS NULL),
         string_agg(nome || ' (' || tamanho || ')', ', ') FILTER (WHERE cardinality(grade) > 0 AND tamanho IS NOT NULL AND NOT (tamanho = ANY (grade)))
    INTO v_faltam, v_fora
    FROM usados;
  IF v_faltam IS NOT NULL THEN RAISE EXCEPTION 'Informe o tamanho de: %', v_faltam; END IF;
  IF v_fora IS NOT NULL THEN RAISE EXCEPTION 'Tamanho fora da grade do Catálogo: %', v_fora; END IF;

  SELECT * INTO v_enx FROM public.sup_admissao_enxoval WHERE candidato_id = p_candidato_id FOR UPDATE;
  IF v_enx.pedido_id IS NOT NULL THEN
    RAISE EXCEPTION 'O Compras já gerou o pedido de materiais deste candidato — ajuste os tamanhos com o Suprimentos.';
  END IF;

  -- Foto do crachá (14/10/2026): obrigatória — vai junto no pedido de materiais.
  v_foto := coalesce(nullif(btrim(coalesce(p_foto_path, '')), ''), v_foto_cand, v_enx.foto_cracha_path);
  IF v_foto IS NULL THEN
    RAISE EXCEPTION 'Anexe a foto do candidato para o crachá.';
  END IF;
  UPDATE public."WA_CURRICULOS" SET cracha_foto_path = v_foto WHERE id = p_candidato_id AND cracha_foto_path IS DISTINCT FROM v_foto;

  IF v_enx.id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.sup_admissao_enxoval_item ai
                     JOIN public.sup_admissao_tamanho_hist h ON h.enxoval_item_id = ai.id
                    WHERE ai.enxoval_id = v_enx.id) INTO v_tem_hist;
    IF v_tem_hist AND v_enx.funcao_id IS DISTINCT FROM p_funcao_id THEN
      RAISE EXCEPTION 'Este candidato já tem enxoval com histórico de tamanhos em outra função — fale com o Suprimentos.';
    END IF;
  END IF;

  INSERT INTO public.sup_admissao_enxoval (candidato_id, vaga_id, contrato_id, posto_id, funcao_id, token, expira_em,
                                           preenchido_em, observacoes, foto_cracha_path, created_by)
  VALUES (p_candidato_id, v_vaga_id, p_contrato_id, p_posto_id, p_funcao_id,
          replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), now(),
          now(), nullif(btrim(coalesce(p_obs, '')), ''), v_foto, v_uid)
  ON CONFLICT (candidato_id) DO UPDATE SET
    vaga_id = EXCLUDED.vaga_id, contrato_id = EXCLUDED.contrato_id, posto_id = EXCLUDED.posto_id,
    funcao_id = EXCLUDED.funcao_id, preenchido_em = now(), observacoes = EXCLUDED.observacoes,
    foto_cracha_path = EXCLUDED.foto_cracha_path
  RETURNING id INTO v_enx_id;

  IF v_tem_hist THEN
    -- Mesma função e já com histórico: corrige no lugar (o gatilho registra a troca).
    PERFORM set_config('app.sup_admissao_motivo', 'Recrutamento — tamanhos informados ao enviar pro Compras', true);
    UPDATE public.sup_admissao_enxoval_item ai
       SET tamanho = nullif(btrim((SELECT e->>'tamanho' FROM jsonb_array_elements(p_itens) e WHERE e->>'item_id' = ai.sup_item_id::text LIMIT 1)), ''),
           quantidade = public.rec_enxoval_qtd(p_itens, ai.sup_item_id)
     WHERE ai.enxoval_id = v_enx_id
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_itens) e
                        WHERE e->>'item_id' = ai.sup_item_id::text AND e->>'tamanho' = 'NAO_PRECISA');
  ELSE
    DELETE FROM public.sup_admissao_enxoval_item WHERE enxoval_id = v_enx_id;
    INSERT INTO public.sup_admissao_enxoval_item (enxoval_id, sup_item_id, nome_item, tipo_item, tamanho, quantidade, ordem)
    SELECT v_enx_id, i.id, i.nome, i.tipo,
           CASE WHEN cardinality(public.rec_enxoval_grade(i.id)) > 0
                THEN nullif(btrim((SELECT e->>'tamanho' FROM jsonb_array_elements(p_itens) e WHERE e->>'item_id' = i.id::text LIMIT 1)), '')
           END,
           public.rec_enxoval_qtd(p_itens, i.id), fi.ordem
      FROM public.sup_funcao_item fi JOIN public.sup_item i ON i.id = fi.item_id
     WHERE fi.funcao_id = p_funcao_id AND fi.ativo AND fi.aprovado AND i.ativo AND i.aprovado
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_itens) e
                        WHERE e->>'item_id' = i.id::text AND e->>'tamanho' = 'NAO_PRECISA')
     ORDER BY fi.ordem, fi.created_at;
    IF NOT FOUND THEN RAISE EXCEPTION 'Marque ao menos um item do enxoval.'; END IF;
  END IF;

  -- A vaga antiga passa a carregar o catálogo (como sup_adm_gerar_enxoval faz).
  UPDATE public."SISTEMA_RECRUTAMENTO" s SET
    contrato_id = coalesce(s.contrato_id, p_contrato_id),
    posto_id = coalesce(s.posto_id, p_posto_id),
    funcao_id = coalesce(s.funcao_id, p_funcao_id)
   WHERE s.id = v_vaga_id;

  SELECT string_agg(ai.quantidade || '× ' || ai.nome_item || coalesce(' — tam. ' || ai.tamanho, ''), E'\n' ORDER BY ai.ordem, ai.nome_item)
    INTO v_resumo
    FROM public.sup_admissao_enxoval_item ai WHERE ai.enxoval_id = v_enx_id;
  v_resumo := concat_ws(E'\n',
    'Enxoval da função (' || coalesce((SELECT nome FROM public.sup_funcao WHERE id = p_funcao_id), '—') || '):',
    v_resumo,
    CASE WHEN nullif(btrim(coalesce(p_obs, '')), '') IS NOT NULL THEN 'Obs.: ' || btrim(p_obs) END);

  RETURN jsonb_build_object('enxoval_id', v_enx_id, 'resumo', v_resumo);
END $fn$;

-- Quantidade de um item no payload: 1 a 99, padrão 1 (antes era sempre 1).
CREATE OR REPLACE FUNCTION public.rec_enxoval_qtd(p_itens jsonb, p_item uuid)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT greatest(1, least(99, coalesce(
    (SELECT CASE WHEN e->>'quantidade' ~ '^\d+$' THEN (e->>'quantidade')::int END
       FROM jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e WHERE e->>'item_id' = p_item::text LIMIT 1), 1)));
$fn$;

REVOKE ALL ON FUNCTION public.rec_enxoval_informar(bigint, uuid, uuid, uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_enxoval_informar(bigint, uuid, uuid, uuid, jsonb, text, text) TO authenticated;

-- ── 2b. Preview: quantidade por item e a foto já anexada ───────────────────
CREATE OR REPLACE FUNCTION public.rec_enxoval_preview(p_candidato_id bigint, p_contrato_id uuid DEFAULT NULL, p_posto_id uuid DEFAULT NULL, p_funcao_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_vaga    record;
  v_ctr     uuid;
  v_pst     uuid;
  v_fun     uuid;
  v_enx     public.sup_admissao_enxoval;
  v_itens   jsonb;
  v_foto    text;
BEGIN
  IF NOT (public.can_access(v_uid, 'recrutamento_gestao', 'alterar') OR public.can_access(v_uid, 'sup_epis_admissao', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem permissão para ver o enxoval da admissão.' USING ERRCODE = '42501';
  END IF;

  SELECT v.id, v.contrato_id, v.posto_id, v.funcao_id, v.cargo, v.contrato AS contrato_texto, c.cracha_foto_path
    INTO v_vaga
    FROM public."WA_CURRICULOS" c
    JOIN public."SISTEMA_RECRUTAMENTO" v ON v.id = c.vaga_id
   WHERE c.id = p_candidato_id;
  SELECT * INTO v_enx FROM public.sup_admissao_enxoval WHERE candidato_id = p_candidato_id;
  v_foto := coalesce(v_vaga.cracha_foto_path, v_enx.foto_cracha_path);

  -- O que a tela escolheu vence; senão o enxoval já gravado; senão a vaga.
  v_ctr := coalesce(p_contrato_id, v_enx.contrato_id, v_vaga.contrato_id);
  v_pst := coalesce(p_posto_id,    v_enx.posto_id,    v_vaga.posto_id);
  v_fun := coalesce(p_funcao_id,   v_enx.funcao_id,   v_vaga.funcao_id);

  IF v_fun IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'item_id', i.id, 'nome', i.nome, 'tipo', i.tipo,
             'grade', to_jsonb(public.rec_enxoval_grade(i.id)),
             'tamanho', CASE
               WHEN v_enx.preenchido_em IS NOT NULL AND v_enx.funcao_id = v_fun
                    AND NOT EXISTS (SELECT 1 FROM public.sup_admissao_enxoval_item ai WHERE ai.enxoval_id = v_enx.id AND ai.sup_item_id = i.id)
               THEN 'NAO_PRECISA'
               ELSE (SELECT ai.tamanho FROM public.sup_admissao_enxoval_item ai
                      WHERE ai.enxoval_id = v_enx.id AND ai.sup_item_id = i.id LIMIT 1) END,
             'quantidade', coalesce((SELECT ai.quantidade FROM public.sup_admissao_enxoval_item ai
                                      WHERE ai.enxoval_id = v_enx.id AND ai.sup_item_id = i.id LIMIT 1), 1)
           ) ORDER BY fi.ordem, fi.created_at), '[]'::jsonb)
      INTO v_itens
      FROM public.sup_funcao_item fi
      JOIN public.sup_item i ON i.id = fi.item_id
     WHERE fi.funcao_id = v_fun AND fi.ativo AND fi.aprovado AND i.ativo AND i.aprovado;
  END IF;

  RETURN jsonb_build_object(
    'vaga_id', v_vaga.id, 'cargo', v_vaga.cargo, 'contrato_texto', v_vaga.contrato_texto,
    'vaga_tem_catalogo', v_vaga.funcao_id IS NOT NULL,
    'contrato_id', v_ctr, 'posto_id', v_pst, 'funcao_id', v_fun,
    'contrato_nome', (SELECT nome FROM public.contratos WHERE id = v_ctr),
    'posto_nome',    (SELECT nome FROM public.sup_posto WHERE id = v_pst),
    'funcao_nome',   (SELECT nome FROM public.sup_funcao WHERE id = v_fun),
    'itens', coalesce(v_itens, '[]'::jsonb),
    'observacoes', v_enx.observacoes,
    'ja_informado', v_enx.preenchido_em IS NOT NULL,
    'tem_pedido', v_enx.pedido_id IS NOT NULL,
    'foto_cracha_path', v_foto
  );
END $fn$;

-- ── 3. Pedido: foto do candidato quando o enxoval não tem ──────────────────
CREATE OR REPLACE FUNCTION public.sup_adm_criar_pedido(p_enxoval_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_enxoval    public.sup_admissao_enxoval;
  v_candidato  record;
  v_itens      jsonb;
  v_observacao text;
  v_payload    jsonb;
  v_pedido_id  uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_epis_admissao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para gerar o pedido de materiais';
  END IF;

  SELECT * INTO v_enxoval
    FROM public.sup_admissao_enxoval e
   WHERE e.id = p_enxoval_id
   FOR UPDATE;
  IF v_enxoval.id IS NULL THEN RAISE EXCEPTION 'Enxoval não encontrado'; END IF;
  IF v_enxoval.pedido_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este candidato já tem pedido de materiais';
  END IF;
  IF v_enxoval.preenchido_em IS NULL THEN
    RAISE EXCEPTION 'O candidato ainda não informou os tamanhos';
  END IF;

  SELECT c.nome, c.empregado_id, c.cracha_foto_path INTO v_candidato
    FROM public."WA_CURRICULOS" c WHERE c.id = v_enxoval.candidato_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'item_id', ai.sup_item_id,
      -- (1) o escrito só entra onde não havia grade
      'tamanho', COALESCE(
        NULLIF(btrim(ai.tamanho), ''),
        NULLIF(btrim(ai.tamanho_informado), '')
      ),
      'quantidade', ai.quantidade
    ) ORDER BY ai.ordem, ai.id
  ), '[]'::jsonb)
  INTO v_itens
  FROM public.sup_admissao_enxoval_item ai
  WHERE ai.enxoval_id = v_enxoval.id;

  -- (2) observação de item que JÁ tinha tamanho escolhido
  SELECT string_agg(
           ai.nome_item || ': ' || btrim(ai.tamanho_informado),
           E'\n' ORDER BY ai.ordem, ai.id
         )
    INTO v_observacao
    FROM public.sup_admissao_enxoval_item ai
   WHERE ai.enxoval_id = v_enxoval.id
     AND NULLIF(btrim(ai.tamanho), '')           IS NOT NULL
     AND NULLIF(btrim(ai.tamanho_informado), '') IS NOT NULL;

  IF v_observacao IS NOT NULL THEN
    v_observacao := concat_ws(
      E'\n',
      NULLIF(btrim(coalesce(v_enxoval.observacoes, '')), ''),
      'Observações do colaborador sobre os tamanhos:',
      v_observacao
    );
  ELSE
    v_observacao := v_enxoval.observacoes;
  END IF;

  v_payload := jsonb_build_object(
    'contrato_id', v_enxoval.contrato_id,
    'posto_id', v_enxoval.posto_id,
    'funcao_id', v_enxoval.funcao_id,
    'tipo_pedido', 'ambos',
    'admissao', true,
    'nome_colaborador', v_candidato.nome,
    'colaborador_empregado_id', v_candidato.empregado_id,
    -- 14/10/2026: a foto que o Recrutamento anexou ao mandar pro Compras.
    'imagem_cracha_path', coalesce(v_enxoval.foto_cracha_path, v_candidato.cracha_foto_path),
    'observacoes_solicitante', v_observacao,
    'itens', v_itens
  );

  -- A criação e os itens permanecem centralizados na RPC oficial do pedido.
  SELECT (public.sup_ext_criar_pedido(v_payload)).id INTO v_pedido_id;

  UPDATE public.sup_admissao_enxoval
     SET pedido_id = v_pedido_id
   WHERE id = v_enxoval.id;

  RETURN v_pedido_id;
END $fn$;

-- ── 4. Aprovar no EPIs — Admissões = gerar o pedido + carimbar o Compras ───
CREATE OR REPLACE FUNCTION public.sup_adm_aprovar_compras(p_candidato_id bigint, p_obs text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_nome   text;
  v_cand   public."WA_CURRICULOS";
  v_enx    public.sup_admissao_enxoval;
  v_pedido uuid;
  v_novo   boolean := false;
BEGIN
  IF v_uid IS NULL OR NOT public.can_access(v_uid, 'sup_epis_admissao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar o Compras (EPIs — Admissões › Alterar).' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(nullif(btrim(display_name), ''), email) INTO v_nome FROM public.profiles WHERE id = v_uid;

  SELECT * INTO v_cand FROM public."WA_CURRICULOS" WHERE id = p_candidato_id FOR UPDATE;
  IF v_cand.id IS NULL THEN RAISE EXCEPTION 'Candidato não encontrado.'; END IF;
  IF v_cand.etapa_processo NOT IN ('SST + COMPRAS', 'EXAME SST', 'COMPRAS') THEN
    RAISE EXCEPTION 'O candidato não está mais em SST + COMPRAS (está em %).', v_cand.etapa_processo;
  END IF;
  IF v_cand.compras_ok IS TRUE THEN RAISE EXCEPTION 'O Compras já aprovou este candidato.'; END IF;

  SELECT * INTO v_enx FROM public.sup_admissao_enxoval WHERE candidato_id = p_candidato_id;
  v_pedido := v_enx.pedido_id;
  IF v_enx.id IS NOT NULL AND v_enx.pedido_id IS NULL AND v_enx.preenchido_em IS NOT NULL THEN
    v_pedido := public.sup_adm_criar_pedido(v_enx.id);
    v_novo := true;
  END IF;

  UPDATE public."WA_CURRICULOS" SET
    compras_ok = true, compras_por = v_nome, compras_em = now(),
    compras_obs = nullif(btrim(coalesce(p_obs, '')), ''),
    compras_visto_em = coalesce(compras_visto_em, now()), compras_visto_por = coalesce(compras_visto_por, v_nome)
  WHERE id = p_candidato_id;

  RETURN jsonb_build_object(
    'pedido_id', v_pedido, 'pedido_novo', v_novo,
    'protocolo', (SELECT p.pedido_id FROM public.sup_pedido p WHERE p.id = v_pedido),
    'sst_ok', v_cand.sst_ok IS TRUE);
END $fn$;
REVOKE ALL ON FUNCTION public.sup_adm_aprovar_compras(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_adm_aprovar_compras(bigint, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.sup_adm_aprovar_compras(bigint, text);
-- DROP FUNCTION IF EXISTS public.rec_enxoval_informar(bigint, uuid, uuid, uuid, jsonb, text, text);
-- (reaplicar rec_enxoval_informar/rec_enxoval_preview da 20260930000246 e sup_adm_criar_pedido da 20260930000017)
-- DROP FUNCTION IF EXISTS public.rec_enxoval_qtd(jsonb, uuid);
-- (recriar VW_RECRUTAMENTO_CANDIDATOS sem as colunas novas: DROP VIEW + CREATE — as colunas novas não saem com CREATE OR REPLACE)
-- ALTER TABLE public."WA_CURRICULOS" DROP COLUMN IF EXISTS cracha_foto_path, DROP COLUMN IF EXISTS sst_visto_em, DROP COLUMN IF EXISTS sst_visto_por,
--   DROP COLUMN IF EXISTS compras_visto_em, DROP COLUMN IF EXISTS compras_visto_por, DROP COLUMN IF EXISTS urgente_sst,
--   DROP COLUMN IF EXISTS urgente_compras, DROP COLUMN IF EXISTS urgente_em, DROP COLUMN IF EXISTS urgente_por, DROP COLUMN IF EXISTS urgente_motivo,
--   DROP COLUMN IF EXISTS sst_maps_url;
-- NOTIFY pgrst, 'reload schema';
