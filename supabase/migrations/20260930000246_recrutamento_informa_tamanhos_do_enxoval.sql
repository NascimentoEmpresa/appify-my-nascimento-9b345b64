-- =========================================================================
-- Recrutamento: ao mandar o candidato pra SST + COMPRAS, o enxoval da função
-- vem do Catálogo e o Recrutamento só informa os TAMANHOS
--
-- CHAMADO (25/09/2026, Pablo)
--   "Quando o setor do recrutamento faz a contratação deve puxar do catálogo
--   com as informações já adicionadas na função ofertada, ficando somente de
--   responsabilidade do recrutamento informar os tamanhos necessários para o
--   colaborador contratado." — no kanban, ao enviar pro SST + COMPRAS aparece
--   o enxoval da função (contrato → posto → função da vaga) exigindo o
--   tamanho de cada item; item sem grade (óculos, máscara) não pede tamanho.
--   Chega no card do Compras em Suprimentos › EPIs — Admissões.
--
-- GRADE: a do próprio Catálogo (sup_item_opcao tipo 'tamanho') — decisão do
-- Pablo em 25/09/2026 ("segue as regras já existentes").
--
-- COMO: reaproveita o enxoval de admissão que o Suprimentos já tinha
-- (sup_admissao_enxoval + _item — antes preenchido pelo CANDIDATO por link).
-- O Recrutamento preenche direto; o enxoval nasce `preenchido_em`, e o
-- Compras já pode "Gerar pedido de materiais" (sup_adm_criar_pedido, sem
-- mudança). O link pro candidato continua existindo para o caso antigo.
--
--   rec_enxoval_preview(candidato, [contrato, posto, função]) — o que mostrar
--     no card: resolve contrato/posto/função pela vaga (ou pelo que a tela
--     escolheu, quando a vaga é antiga e não tem catálogo), os itens e a
--     grade de cada um, e os tamanhos já informados (reabrir).
--   rec_enxoval_informar(candidato, contrato, posto, função, itens, obs) —
--     grava; valida que todo item com grade tem tamanho da grade. Devolve o
--     resumo em texto, que a tela grava em compras_necessidades (a busca e o
--     card antigo do Compras continuam funcionando).
--
-- Permissão: quem move o candidato no kanban (recrutamento_gestao/alterar);
-- o preview também abre para o Suprimentos (sup_epis_admissao).
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rec_enxoval_grade(p_item_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT coalesce((SELECT io.opcoes FROM public.sup_item_opcao io
                    WHERE io.item_id = p_item_id AND io.tipo = 'tamanho' AND cardinality(io.opcoes) > 0
                    LIMIT 1), '{}'::text[]);
$fn$;
REVOKE ALL ON FUNCTION public.rec_enxoval_grade(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_enxoval_grade(uuid) TO authenticated;

-- ── Preview (o card do kanban) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rec_enxoval_preview(
  p_candidato_id bigint, p_contrato_id uuid DEFAULT NULL, p_posto_id uuid DEFAULT NULL, p_funcao_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_vaga    record;
  v_ctr     uuid;
  v_pst     uuid;
  v_fun     uuid;
  v_enx     public.sup_admissao_enxoval;
  v_itens   jsonb;
BEGIN
  IF NOT (public.can_access(v_uid, 'recrutamento_gestao', 'alterar') OR public.can_access(v_uid, 'sup_epis_admissao', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem permissão para ver o enxoval da admissão.' USING ERRCODE = '42501';
  END IF;

  SELECT v.id, v.contrato_id, v.posto_id, v.funcao_id, v.cargo, v.contrato AS contrato_texto
    INTO v_vaga
    FROM public."WA_CURRICULOS" c
    JOIN public."SISTEMA_RECRUTAMENTO" v ON v.id = c.vaga_id
   WHERE c.id = p_candidato_id;
  SELECT * INTO v_enx FROM public.sup_admissao_enxoval WHERE candidato_id = p_candidato_id;

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
                      WHERE ai.enxoval_id = v_enx.id AND ai.sup_item_id = i.id LIMIT 1) END
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
    'tem_pedido', v_enx.pedido_id IS NOT NULL
  );
END $fn$;
REVOKE ALL ON FUNCTION public.rec_enxoval_preview(bigint, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_enxoval_preview(bigint, uuid, uuid, uuid) TO authenticated;

-- ── Gravar (o Recrutamento informou os tamanhos) ─────────────────────────
-- p_itens: [{ "item_id": uuid, "tamanho": "M" }, ...]
-- tamanho 'NAO_PRECISA' tira o item do enxoval (ex.: a função tem sapato
-- feminino E masculino no catálogo; a candidata só leva o feminino).
CREATE OR REPLACE FUNCTION public.rec_enxoval_informar(
  p_candidato_id bigint, p_contrato_id uuid, p_posto_id uuid, p_funcao_id uuid, p_itens jsonb, p_obs text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_vaga_id bigint;
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
  SELECT c.vaga_id INTO v_vaga_id FROM public."WA_CURRICULOS" c WHERE c.id = p_candidato_id;
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
  IF v_enx.id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.sup_admissao_enxoval_item ai
                     JOIN public.sup_admissao_tamanho_hist h ON h.enxoval_item_id = ai.id
                    WHERE ai.enxoval_id = v_enx.id) INTO v_tem_hist;
    IF v_tem_hist AND v_enx.funcao_id IS DISTINCT FROM p_funcao_id THEN
      RAISE EXCEPTION 'Este candidato já tem enxoval com histórico de tamanhos em outra função — fale com o Suprimentos.';
    END IF;
  END IF;

  INSERT INTO public.sup_admissao_enxoval (candidato_id, vaga_id, contrato_id, posto_id, funcao_id, token, expira_em,
                                           preenchido_em, observacoes, created_by)
  VALUES (p_candidato_id, v_vaga_id, p_contrato_id, p_posto_id, p_funcao_id,
          replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), now(),
          now(), nullif(btrim(coalesce(p_obs, '')), ''), v_uid)
  ON CONFLICT (candidato_id) DO UPDATE SET
    vaga_id = EXCLUDED.vaga_id, contrato_id = EXCLUDED.contrato_id, posto_id = EXCLUDED.posto_id,
    funcao_id = EXCLUDED.funcao_id, preenchido_em = now(), observacoes = EXCLUDED.observacoes
  RETURNING id INTO v_enx_id;

  IF v_tem_hist THEN
    -- Mesma função e já com histórico: corrige no lugar (o gatilho registra a troca).
    PERFORM set_config('app.sup_admissao_motivo', 'Recrutamento — tamanhos informados ao enviar pro Compras', true);
    UPDATE public.sup_admissao_enxoval_item ai
       SET tamanho = nullif(btrim((SELECT e->>'tamanho' FROM jsonb_array_elements(p_itens) e WHERE e->>'item_id' = ai.sup_item_id::text LIMIT 1)), '')
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
           1, fi.ordem
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

  SELECT string_agg(ai.nome_item || coalesce(' — tam. ' || ai.tamanho, ''), E'\n' ORDER BY ai.ordem, ai.nome_item)
    INTO v_resumo
    FROM public.sup_admissao_enxoval_item ai WHERE ai.enxoval_id = v_enx_id;
  v_resumo := concat_ws(E'\n',
    'Enxoval da função (' || coalesce((SELECT nome FROM public.sup_funcao WHERE id = p_funcao_id), '—') || '):',
    v_resumo,
    CASE WHEN nullif(btrim(coalesce(p_obs, '')), '') IS NOT NULL THEN 'Obs.: ' || btrim(p_obs) END);

  RETURN jsonb_build_object('enxoval_id', v_enx_id, 'resumo', v_resumo);
END $fn$;
REVOKE ALL ON FUNCTION public.rec_enxoval_informar(bigint, uuid, uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_enxoval_informar(bigint, uuid, uuid, uuid, jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.rec_enxoval_informar(bigint, uuid, uuid, uuid, jsonb, text);
-- DROP FUNCTION IF EXISTS public.rec_enxoval_preview(bigint, uuid, uuid, uuid);
-- DROP FUNCTION IF EXISTS public.rec_enxoval_grade(uuid);
-- NOTIFY pgrst, 'reload schema';
-- (Enxovais gravados ficam — são os mesmos que o Suprimentos já usava.)
