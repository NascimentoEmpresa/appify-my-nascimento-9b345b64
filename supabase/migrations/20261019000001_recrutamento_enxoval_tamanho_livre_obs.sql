-- =========================================================================
-- RECRUTAMENTO → enxoval: tamanho escrito à mão e observação por item (19/10/2026)
--
-- Pablo (print do "Enviar ao SST e ao Compras" com o aviso "Enxoval salvo, mas
-- o pedido não foi gerado: Uniforme "CRACHÁ" exige o tamanho"):
--   "quando não conseguir passar dessa parte, deixa enviar sem preencher, só
--    que tem que botar OBSERVAÇÃO pra cada coisa que não está preenchida. a
--    opção não precisa é preenchimento. Tipo o jaleco ali não tem tamanho,
--    então não tem como selecionar, só que a pessoa precisa e não tá
--    preenchido. Mesmo se não tiver opção por parte do compras, o recrutamento
--    tem que conseguir colocar o tamanho."
--
-- O BURACO
-- A tela deixava uniforme SEM grade no Catálogo seguir sem tamanho (não havia
-- chip pra clicar) e rec_enxoval_informar nem gravava tamanho de item sem
-- grade. Na geração do pedido o gatilho trg_sup_pedido_item_exige_tamanho
-- (mig 20261006140000) recusava — o enxoval ficava salvo e o pedido não.
--
-- O QUE MUDA
--   1. sup_admissao_enxoval_item.obs_recrutamento: observação do Recrutamento
--      sobre o item (o porquê de ir sem tamanho, ou qualquer detalhe).
--   2. rec_enxoval_informar: o tamanho pode ser da grade OU escrito (fora da
--      grade também — o Catálogo pode não ter a opção). Item que exige tamanho
--      (tem grade, ou é uniforme) e vai sem ele precisa de observação; "Não
--      precisa" continua tirando o item. Grava tamanho de todo item.
--   3. rec_enxoval_preview devolve a observação de cada item (reabrindo).
--   4. sup_adm_criar_pedido_interno: as observações dos itens vão para as
--      observações do pedido ("JALECO - CINZA: <obs>"), para o Compras ver.
--   5. sup_pedido_item_exige_tamanho: o pedido de admissão gerado pelo envio do
--      Recrutamento (marca sup.pedido_admissao_recrutamento, ligada só dentro de
--      sup_adm_criar_pedido_interno) aceita uniforme sem tamanho — a
--      rec_enxoval_informar já cobrou a observação dele. Os outros caminhos
--      (encarregado, operador) seguem travados como antes.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- ROLLBACK:
--   reaplicar rec_enxoval_informar/rec_enxoval_preview da 20261014000045,
--   sup_adm_criar_pedido_interno da 20261015000011 e
--   sup_pedido_item_exige_tamanho da 20261006140000;
--   ALTER TABLE public.sup_admissao_enxoval_item DROP COLUMN IF EXISTS obs_recrutamento;
--   NOTIFY pgrst, 'reload schema';
-- =========================================================================

ALTER TABLE public.sup_admissao_enxoval_item
  ADD COLUMN IF NOT EXISTS obs_recrutamento text;

-- ── 2. Informar: tamanho livre + observação obrigatória quando falta ───────
CREATE OR REPLACE FUNCTION public.rec_enxoval_informar(p_candidato_id bigint, p_contrato_id uuid, p_posto_id uuid, p_funcao_id uuid,
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

  -- 19/10/2026: o tamanho pode vir de fora da grade (escrito pelo Recrutamento).
  -- Item que exige tamanho (tem grade, ou é uniforme) e vai sem ele precisa de
  -- observação dizendo o porquê.
  WITH itens AS (
    SELECT i.id, i.nome, i.tipo, public.rec_enxoval_grade(i.id) AS grade,
           nullif(btrim((SELECT e->>'tamanho' FROM jsonb_array_elements(p_itens) e WHERE e->>'item_id' = i.id::text LIMIT 1)), '') AS tamanho,
           nullif(btrim((SELECT e->>'obs' FROM jsonb_array_elements(p_itens) e WHERE e->>'item_id' = i.id::text LIMIT 1)), '') AS obs
      FROM public.sup_funcao_item fi JOIN public.sup_item i ON i.id = fi.item_id
     WHERE fi.funcao_id = p_funcao_id AND fi.ativo AND fi.aprovado AND i.ativo AND i.aprovado
  )
  SELECT string_agg(nome, ', ')
    INTO v_faltam
    FROM itens
   WHERE tamanho IS NULL AND obs IS NULL
     AND (cardinality(grade) > 0 OR tipo = 'uniforme');
  IF v_faltam IS NOT NULL THEN
    RAISE EXCEPTION 'Informe o tamanho (ou escreva uma observação) de: %', v_faltam;
  END IF;

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
           obs_recrutamento = nullif(btrim((SELECT e->>'obs' FROM jsonb_array_elements(p_itens) e WHERE e->>'item_id' = ai.sup_item_id::text LIMIT 1)), ''),
           quantidade = public.rec_enxoval_qtd(p_itens, ai.sup_item_id)
     WHERE ai.enxoval_id = v_enx_id
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_itens) e
                        WHERE e->>'item_id' = ai.sup_item_id::text AND e->>'tamanho' = 'NAO_PRECISA');
  ELSE
    DELETE FROM public.sup_admissao_enxoval_item WHERE enxoval_id = v_enx_id;
    INSERT INTO public.sup_admissao_enxoval_item (enxoval_id, sup_item_id, nome_item, tipo_item, tamanho, obs_recrutamento, quantidade, ordem)
    SELECT v_enx_id, i.id, i.nome, i.tipo,
           -- 19/10/2026: grava o tamanho de todo item (antes só de quem tinha grade).
           nullif(btrim((SELECT e->>'tamanho' FROM jsonb_array_elements(p_itens) e WHERE e->>'item_id' = i.id::text LIMIT 1)), ''),
           nullif(btrim((SELECT e->>'obs' FROM jsonb_array_elements(p_itens) e WHERE e->>'item_id' = i.id::text LIMIT 1)), ''),
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

  SELECT string_agg(ai.quantidade || '× ' || ai.nome_item || coalesce(' — tam. ' || ai.tamanho, '')
                    || coalesce(' (obs.: ' || ai.obs_recrutamento || ')', ''), E'\n' ORDER BY ai.ordem, ai.nome_item)
    INTO v_resumo
    FROM public.sup_admissao_enxoval_item ai WHERE ai.enxoval_id = v_enx_id;
  v_resumo := concat_ws(E'\n',
    'Enxoval da função (' || coalesce((SELECT nome FROM public.sup_funcao WHERE id = p_funcao_id), '—') || '):',
    v_resumo,
    CASE WHEN nullif(btrim(coalesce(p_obs, '')), '') IS NOT NULL THEN 'Obs.: ' || btrim(p_obs) END);

  RETURN jsonb_build_object('enxoval_id', v_enx_id, 'resumo', v_resumo);
END $fn$;

-- ── 3. Preview: devolve a observação de cada item ──────────────────────────
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
             'obs', (SELECT ai.obs_recrutamento FROM public.sup_admissao_enxoval_item ai
                      WHERE ai.enxoval_id = v_enx.id AND ai.sup_item_id = i.id LIMIT 1),
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

-- ── 4. Pedido: as observações dos itens vão para o Compras ─────────────────
CREATE OR REPLACE FUNCTION public.sup_adm_criar_pedido_interno(p_enxoval_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_enxoval    public.sup_admissao_enxoval;
  v_candidato  record;
  v_itens      jsonb;
  v_observacao text;
  v_obs_itens  text;
  v_payload    jsonb;
  v_pedido_id  uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT * INTO v_enxoval FROM public.sup_admissao_enxoval e WHERE e.id = p_enxoval_id FOR UPDATE;
  IF v_enxoval.id IS NULL THEN RAISE EXCEPTION 'Enxoval não encontrado'; END IF;
  IF v_enxoval.pedido_id IS NOT NULL THEN RETURN v_enxoval.pedido_id; END IF;
  IF v_enxoval.preenchido_em IS NULL THEN RAISE EXCEPTION 'O enxoval ainda não tem os tamanhos'; END IF;

  SELECT c.nome, c.empregado_id, c.cracha_foto_path, c.compras_obs_rh INTO v_candidato
    FROM public."WA_CURRICULOS" c WHERE c.id = v_enxoval.candidato_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'item_id', ai.sup_item_id,
           'tamanho', COALESCE(NULLIF(btrim(ai.tamanho), ''), NULLIF(btrim(ai.tamanho_informado), '')),
           'quantidade', ai.quantidade) ORDER BY ai.ordem, ai.id), '[]'::jsonb)
    INTO v_itens
    FROM public.sup_admissao_enxoval_item ai WHERE ai.enxoval_id = v_enxoval.id;

  SELECT string_agg(ai.nome_item || ': ' || btrim(ai.tamanho_informado), E'\n' ORDER BY ai.ordem, ai.id)
    INTO v_observacao
    FROM public.sup_admissao_enxoval_item ai
   WHERE ai.enxoval_id = v_enxoval.id
     AND NULLIF(btrim(ai.tamanho), '') IS NOT NULL AND NULLIF(btrim(ai.tamanho_informado), '') IS NOT NULL;

  -- 19/10/2026: observação do Recrutamento por item (o porquê do item ir sem tamanho).
  SELECT string_agg(ai.nome_item
                    || CASE WHEN NULLIF(btrim(ai.tamanho), '') IS NULL AND NULLIF(btrim(ai.tamanho_informado), '') IS NULL
                            THEN ' (sem tamanho)' ELSE '' END
                    || ': ' || btrim(ai.obs_recrutamento), E'\n' ORDER BY ai.ordem, ai.id)
    INTO v_obs_itens
    FROM public.sup_admissao_enxoval_item ai
   WHERE ai.enxoval_id = v_enxoval.id AND NULLIF(btrim(ai.obs_recrutamento), '') IS NOT NULL;

  v_observacao := concat_ws(E'\n',
    CASE WHEN NULLIF(btrim(coalesce(v_candidato.compras_obs_rh, '')), '') IS NOT NULL
         THEN 'Observação do Recrutamento: ' || btrim(v_candidato.compras_obs_rh) END,
    NULLIF(btrim(coalesce(v_enxoval.observacoes, '')), ''),
    CASE WHEN v_obs_itens IS NOT NULL THEN 'Observações do Recrutamento por item:' || E'\n' || v_obs_itens END,
    CASE WHEN v_observacao IS NOT NULL THEN 'Observações do colaborador sobre os tamanhos:' || E'\n' || v_observacao END);

  v_payload := jsonb_build_object(
    'contrato_id', v_enxoval.contrato_id, 'posto_id', v_enxoval.posto_id, 'funcao_id', v_enxoval.funcao_id,
    'tipo_pedido', 'ambos', 'admissao', true,
    'nome_colaborador', v_candidato.nome, 'colaborador_empregado_id', v_candidato.empregado_id,
    'imagem_cracha_path', coalesce(v_enxoval.foto_cracha_path, v_candidato.cracha_foto_path),
    'observacoes_solicitante', NULLIF(v_observacao, ''),
    'itens', v_itens);

  PERFORM set_config('sup.pedido_admissao_recrutamento', 'on', true);
  SELECT (public.sup_ext_criar_pedido(v_payload)).id INTO v_pedido_id;
  PERFORM set_config('sup.pedido_admissao_recrutamento', 'off', true);

  UPDATE public.sup_admissao_enxoval SET pedido_id = v_pedido_id WHERE id = v_enxoval.id;
  RETURN v_pedido_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sup_adm_criar_pedido_interno(uuid) FROM PUBLIC, anon, authenticated;

-- ── 5. Trava do uniforme: exceção só para o pedido gerado pelo Recrutamento ─
CREATE OR REPLACE FUNCTION public.sup_pedido_item_exige_tamanho()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- "Reordenar não é mexer": sup_pedido_editar dá UPDATE em TODO item retido a
  -- cada save (só pra gravar a ordem), então um UPDATE que não mexeu no tamanho
  -- nem no tipo não pode revalidar a linha. É isso que mantém editável um
  -- pedido antigo que tem uniforme sem tamanho (a JAQUETA do chamado): corrigir
  -- a observação não exige preencher o tamanho de uma linha histórica. A trava
  -- vale para INSERT (item novo, criação/admissão) e para o UPDATE que de fato
  -- muda o tamanho ou o tipo do item.
  IF TG_OP = 'UPDATE'
     AND coalesce(btrim(NEW.tamanho), '') = coalesce(btrim(OLD.tamanho), '')
     AND NEW.tipo_item IS NOT DISTINCT FROM OLD.tipo_item THEN
    RETURN NEW;
  END IF;

  -- 19/10/2026: o pedido de admissão gerado pelo envio do Recrutamento
  -- (sup_adm_criar_pedido_interno liga a marca só ali dentro; set_config não é
  -- chamável pela API) pode levar uniforme sem tamanho — rec_enxoval_informar
  -- já exigiu a observação do item, que vai nas observações do pedido. Caso
  -- real: JALECO sem grade no Catálogo e o crachá, que travavam o pedido.
  IF current_setting('sup.pedido_admissao_recrutamento', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Todo uniforme exige tamanho — da grade ou escrito. Insumo/EPI fica livre:
  -- o que ele oferece (quantidade, litros) já é conferido por quem monta o item.
  IF NEW.tipo_item = 'uniforme'
     AND coalesce(btrim(NEW.tamanho), '') = '' THEN
    RAISE EXCEPTION 'Uniforme "%" exige o tamanho', NEW.nome_item
      USING ERRCODE = '23514';  -- check_violation
  END IF;
  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';
