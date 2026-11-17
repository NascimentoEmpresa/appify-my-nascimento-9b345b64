-- =========================================================================
-- SIS-2026-0929 — SIMULADOR DO ATENDIMENTO DOS SUPERVISORES (18/11/2026)
--
-- PEDIDO (Pablo): "quero validar na prática, testar o que a I.A vai falar,
-- como vai ficar o atendimento". Até aqui só dava para ver o canal dos
-- supervisores com o número da Meta ligado. WhatsApp › Testes ganha uma aba
-- que roda o MESMO fluxo do webhook (whatsapp-webhook/atendimento.ts,
-- conduzirAtendimento) sem enviar nada nem gravar protocolo/mensagem.
--
-- O que este arquivo acrescenta (a 20261118130000 já está na main e não muda):
--   1. wa_atd_identificar_empregado(id) — o miolo da identificação, agora
--      separado do telefone. wa_atd_identificar(wa_id) passa a chamá-lo
--      (mesma saída de antes).
--   2. wa_atd_consultar_nucleo(ident, categoria, alvo) — a DECISÃO da
--      consulta, sem log. wa_atd_consultar passa a chamá-lo e continua
--      registrando em WA_ATD_CONSULTA_LOG (mesma saída de antes).
--   3. RPCs do simulador (authenticated): wa_atd_simular_pessoas,
--      wa_atd_simular_identidade, wa_atd_simular_consulta. A identidade
--      simulada é montada NO SERVIDOR a partir do colaborador escolhido —
--      nunca recebida do navegador (senão bastaria mandar
--      contratos_encarregado forjados para ler qualquer cadastro).
--      Acesso: menu whatsapp_testes (o da tela Testes) E whatsapp_atd_base
--      visualizar. Cada simulação fica em WA_ATD_ACESSO_LOG — mostrar o
--      cadastro de alguém na tela é acesso a dado, mesmo em teste.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Identificação: miolo por colaborador ─────────────────────────────
CREATE OR REPLACE FUNCTION public.wa_atd_identificar_empregado(p_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_nome  text;
  v_enc   uuid[];
  v_sup   uuid[];
  v_ctr   uuid;
BEGIN
  SELECT e."Nome" INTO v_nome FROM public."EMPREGADOS" e
   WHERE e."ID" = p_id AND public.esp_col_esta_ativo(e."Situação") LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('papel', 'desconhecido', 'motivo', 'numero_nao_cadastrado');
  END IF;
  SELECT coalesce(array_agg(DISTINCT o.contrato_id ORDER BY o.contrato_id), '{}') INTO v_enc
    FROM public."OPE_ORG_CONTRATO" o WHERE o.encarregado_id = p_id;
  SELECT coalesce(array_agg(DISTINCT o.contrato_id ORDER BY o.contrato_id), '{}') INTO v_sup
    FROM public."OPE_ORG_CONTRATO" o WHERE o.supervisor_id = p_id;
  SELECT a.contrato_id INTO v_ctr FROM public.rh_ac_ativos() a WHERE a.empregado_id = p_id LIMIT 1;

  RETURN jsonb_build_object(
    'papel', CASE WHEN cardinality(v_enc) > 0 THEN 'encarregado'
                  WHEN cardinality(v_sup) > 0 THEN 'supervisor'
                  ELSE 'colaborador' END,
    'empregado_id', p_id,
    'primeiro_nome', split_part(btrim(coalesce(v_nome, '')), ' ', 1),
    'contrato_id', v_ctr,
    'contratos_encarregado', to_jsonb(v_enc),
    'contratos_supervisor', to_jsonb(v_sup),
    'motivo', NULL);
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_identificar_empregado(bigint) FROM PUBLIC, anon, authenticated;

-- Mesma saída da 20261118130000; o miolo agora é compartilhado.
CREATE OR REPLACE FUNCTION public.wa_atd_identificar(p_wa_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_chave text := public.wa_atd_chave_telefone(p_wa_id);
  v_ids   bigint[];
BEGIN
  IF v_chave IS NULL THEN
    RETURN jsonb_build_object('papel', 'desconhecido', 'motivo', 'numero_invalido');
  END IF;
  SELECT array_agg(DISTINCT e."ID"::bigint) INTO v_ids
    FROM public."EMPREGADOS" e
   WHERE public.esp_col_esta_ativo(e."Situação")
     AND public.wa_atd_chave_telefone(e.telefone) = v_chave;
  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RETURN jsonb_build_object('papel', 'desconhecido', 'motivo', 'numero_nao_cadastrado');
  END IF;
  IF cardinality(v_ids) > 1 THEN
    RETURN jsonb_build_object('papel', 'divergente', 'motivo', 'numero_em_mais_de_um_cadastro');
  END IF;
  RETURN public.wa_atd_identificar_empregado(v_ids[1]);
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_identificar(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_atd_identificar(text) TO service_role;

-- ── 2) Consulta: a decisão, sem log ─────────────────────────────────────
-- Corpo igual ao da 20261118130000 (sem o INSERT no log), devolvendo também
-- quem pediu e quem foi consultado para quem chama registrar.
CREATE OR REPLACE FUNCTION public.wa_atd_consultar_nucleo(p_ident jsonb, p_categoria text, p_alvo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_ident   jsonb := coalesce(p_ident, '{}'::jsonb);
  v_papel   text := coalesce(v_ident->>'papel', 'desconhecido');
  v_eu      bigint := nullif(v_ident->>'empregado_id', '')::bigint;
  v_regra   public."WA_ATD_REGRA_DADO";
  v_termo   text := btrim(coalesce(p_alvo, ''));
  v_t       text := lower(regexp_replace(btrim(coalesce(p_alvo, '')), '[^[:alnum:] ]', '', 'g'));
  v_proprio boolean;
  v_alvos   bigint[];
  v_alvo    bigint;
  v_ctr_alvo uuid;
  v_motivo  text;
  v_ok      boolean := false;
  v_dados   jsonb;
  v_e       record;
BEGIN
  v_proprio := v_t IN ('', 'eu', 'meu', 'minha', 'meus', 'minhas', 'proprio', 'propria', 'mim', 'o meu', 'a minha');
  SELECT * INTO v_regra FROM public."WA_ATD_REGRA_DADO" r WHERE r.categoria = lower(coalesce(p_categoria, '')) AND r.ativo;

  IF v_papel = 'divergente' THEN
    v_motivo := 'cadastro_divergente';
  ELSIF v_papel = 'desconhecido' OR v_eu IS NULL THEN
    v_motivo := 'numero_nao_cadastrado';
  ELSIF v_regra.categoria IS NULL THEN
    v_motivo := 'categoria_desconhecida';
  ELSIF v_regra.sensivel THEN
    v_motivo := 'categoria_sensivel';
  ELSIF v_proprio THEN
    v_alvo := v_eu;
    IF v_regra.proprio THEN v_ok := true; v_motivo := 'proprio'; ELSE v_motivo := 'funcao_nao_permite'; END IF;
  ELSE
    SELECT array_agg(DISTINCT a.empregado_id), (array_agg(a.contrato_id))[1] INTO v_alvos, v_ctr_alvo
      FROM public.rh_ac_ativos() a
     WHERE (a.empregado_id = v_eu
            OR a.contrato_id IN (SELECT (jsonb_array_elements_text(coalesce(v_ident->'contratos_encarregado', '[]')))::uuid
                                 UNION
                                 SELECT (jsonb_array_elements_text(coalesce(v_ident->'contratos_supervisor', '[]')))::uuid))
       AND length(v_t) >= 3
       AND (a.cadastro = regexp_replace(v_termo, '\D', '', 'g')
            OR lower(regexp_replace(coalesce(a.nome, ''), '[^[:alnum:] ]', '', 'g')) LIKE '%' || v_t || '%');

    IF v_alvos IS NULL OR cardinality(v_alvos) = 0 THEN
      v_motivo := 'alvo_nao_encontrado';
    ELSIF cardinality(v_alvos) > 1 THEN
      v_motivo := 'alvo_ambiguo';
    ELSE
      v_alvo := v_alvos[1];
      IF v_alvo = v_eu THEN
        IF v_regra.proprio THEN v_ok := true; v_motivo := 'proprio'; ELSE v_motivo := 'funcao_nao_permite'; END IF;
      ELSIF v_ctr_alvo IS NOT NULL AND coalesce(v_ident->'contratos_encarregado', '[]') ? v_ctr_alvo::text THEN
        IF v_regra.encarregado THEN v_ok := true; v_motivo := 'subordinado'; ELSE v_motivo := 'funcao_nao_permite'; END IF;
      ELSIF v_ctr_alvo IS NOT NULL AND coalesce(v_ident->'contratos_supervisor', '[]') ? v_ctr_alvo::text THEN
        IF v_regra.supervisor THEN v_ok := true; v_motivo := 'supervisionado'; ELSE v_motivo := 'funcao_nao_permite'; END IF;
      ELSE
        v_motivo := 'alvo_nao_encontrado';
      END IF;
    END IF;
  END IF;

  IF v_ok THEN
    SELECT e."Nome" AS nome, e."Título do Cargo" AS cargo, e."Nome Filial" AS contrato,
           e."Nome do Posto" AS posto, e."Escala" AS escala, e."Admissão"::text AS admissao,
           e."Situação" AS situacao
      INTO v_e FROM public."EMPREGADOS" e WHERE e."ID" = v_alvo LIMIT 1;
    v_dados := jsonb_build_object('primeiro_nome', split_part(btrim(coalesce(v_e.nome, '')), ' ', 1))
      || CASE v_regra.categoria
           WHEN 'cadastro_basico' THEN jsonb_build_object('cargo', v_e.cargo, 'contrato', v_e.contrato, 'posto', v_e.posto)
           WHEN 'escala'   THEN jsonb_build_object('escala', v_e.escala)
           WHEN 'admissao' THEN jsonb_build_object('admissao', v_e.admissao)
           WHEN 'situacao' THEN jsonb_build_object('situacao',
                  CASE WHEN v_e.situacao ILIKE '%f_rias%' THEN 'em férias'
                       WHEN v_e.situacao ILIKE 'trabalhando%' THEN 'trabalhando'
                       ELSE 'afastado ou em outra situação — o motivo é tratado com o RH' END)
           ELSE '{}'::jsonb
         END;
  END IF;

  RETURN jsonb_build_object('autorizada', v_ok, 'motivo', v_motivo, 'proprio', v_ok AND v_alvo = v_eu,
                            'dados', CASE WHEN v_ok THEN v_dados END,
                            'solicitante_id', v_eu, 'papel', v_papel, 'alvo_id', CASE WHEN v_ok THEN v_alvo END,
                            'categoria', lower(coalesce(p_categoria, '')), 'termo', left(v_termo, 120));
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_consultar_nucleo(jsonb, text, text) FROM PUBLIC, anon, authenticated;

-- Mesma assinatura e mesma saída da 20261118130000; agora usa o núcleo.
CREATE OR REPLACE FUNCTION public.wa_atd_consultar(p_atendimento uuid, p_wa_id text, p_categoria text, p_alvo text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_r jsonb;
BEGIN
  v_r := public.wa_atd_consultar_nucleo(public.wa_atd_identificar(p_wa_id), p_categoria, p_alvo);
  INSERT INTO public."WA_ATD_CONSULTA_LOG"
    (atendimento_id, wa_id, solicitante_empregado_id, solicitante_papel, categoria, alvo_termo, alvo_empregado_id, resultado, motivo)
  VALUES (p_atendimento, p_wa_id, nullif(v_r->>'solicitante_id', '')::bigint, v_r->>'papel', v_r->>'categoria', v_r->>'termo',
          nullif(v_r->>'alvo_id', '')::bigint,
          CASE WHEN (v_r->>'autorizada')::boolean THEN 'autorizada' ELSE 'negada' END, v_r->>'motivo');
  RETURN jsonb_build_object('autorizada', v_r->'autorizada', 'motivo', v_r->'motivo', 'proprio', v_r->'proprio', 'dados', v_r->'dados');
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_consultar(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_atd_consultar(uuid, text, text, text) TO service_role;

-- ── 3) Simulador ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wa_atd_simular_pode()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.tem_acesso_menu('whatsapp_testes')
     AND public.wa_atd_pode('visualizar', 'whatsapp_atd_base')
$$;
REVOKE ALL ON FUNCTION public.wa_atd_simular_pode() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_atd_simular_pode() TO authenticated;

-- Identidade simulada. p_quem: empregado | desconhecido | divergente.
CREATE OR REPLACE FUNCTION public.wa_atd_simular_ident_interna(p_quem text, p_empregado bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF p_quem = 'empregado' AND p_empregado IS NOT NULL THEN
    RETURN public.wa_atd_identificar_empregado(p_empregado);
  ELSIF p_quem = 'divergente' THEN
    RETURN jsonb_build_object('papel', 'divergente', 'motivo', 'numero_em_mais_de_um_cadastro');
  END IF;
  RETURN jsonb_build_object('papel', 'desconhecido', 'motivo', 'numero_nao_cadastrado');
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_simular_ident_interna(text, bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.wa_atd_simular_identidade(p_quem text, p_empregado bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v jsonb;
BEGIN
  IF NOT public.wa_atd_simular_pode() THEN
    RAISE EXCEPTION 'Sem acesso ao simulador do atendimento (WhatsApp › Testes + Base e Regras).' USING ERRCODE = '42501';
  END IF;
  v := public.wa_atd_simular_ident_interna(p_quem, p_empregado);
  PERFORM public.wa_atd_log('simular_identidade', NULL, jsonb_build_object('quem', p_quem, 'empregado_id', p_empregado));
  -- Para a tela: só o necessário (papel, primeiro nome, quantos contratos).
  RETURN jsonb_build_object(
    'papel', v->>'papel', 'primeiro_nome', v->>'primeiro_nome', 'motivo', v->>'motivo',
    'contratos_encarregado', jsonb_array_length(coalesce(v->'contratos_encarregado', '[]')),
    'contratos_supervisor', jsonb_array_length(coalesce(v->'contratos_supervisor', '[]')),
    'tem_contrato', (v->>'contrato_id') IS NOT NULL);
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_simular_identidade(text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_atd_simular_identidade(text, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.wa_atd_simular_consulta(p_quem text, p_empregado bigint, p_categoria text, p_alvo text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_r jsonb;
BEGIN
  IF NOT public.wa_atd_simular_pode() THEN
    RAISE EXCEPTION 'Sem acesso ao simulador do atendimento (WhatsApp › Testes + Base e Regras).' USING ERRCODE = '42501';
  END IF;
  v_r := public.wa_atd_consultar_nucleo(public.wa_atd_simular_ident_interna(p_quem, p_empregado), p_categoria, p_alvo);
  PERFORM public.wa_atd_log('simular_consulta', NULL, jsonb_build_object(
    'quem', p_quem, 'empregado_id', p_empregado, 'categoria', v_r->>'categoria', 'alvo', v_r->>'termo',
    'alvo_id', v_r->'alvo_id', 'resultado', v_r->'autorizada', 'motivo', v_r->>'motivo'));
  RETURN jsonb_build_object('autorizada', v_r->'autorizada', 'motivo', v_r->'motivo', 'proprio', v_r->'proprio', 'dados', v_r->'dados');
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_simular_consulta(text, bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_atd_simular_consulta(text, bigint, text, text) TO authenticated;

-- Escolher quem está escrevendo: colaboradores ativos, com o papel no
-- organograma. Mínimo 3 letras, no máximo 20 resultados.
CREATE OR REPLACE FUNCTION public.wa_atd_simular_pessoas(p_termo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_t text := btrim(coalesce(p_termo, ''));
BEGIN
  IF NOT public.wa_atd_simular_pode() THEN
    RAISE EXCEPTION 'Sem acesso ao simulador do atendimento.' USING ERRCODE = '42501';
  END IF;
  IF length(v_t) < 3 THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'nome') FROM (
      SELECT jsonb_build_object(
               'id', e."ID", 'nome', e."Nome", 'cargo', e."Título do Cargo", 'contrato', e."Nome Filial",
               'papel', CASE WHEN EXISTS (SELECT 1 FROM public."OPE_ORG_CONTRATO" o WHERE o.encarregado_id = e."ID") THEN 'encarregado'
                             WHEN EXISTS (SELECT 1 FROM public."OPE_ORG_CONTRATO" o WHERE o.supervisor_id = e."ID") THEN 'supervisor'
                             ELSE 'colaborador' END) x
        FROM public."EMPREGADOS" e
       WHERE public.esp_col_esta_ativo(e."Situação")
         AND (e."Nome" ILIKE '%' || replace(replace(v_t, '%', ''), '_', '') || '%' OR e."Cadastro" = v_t)
       ORDER BY e."Nome"
       LIMIT 20) t), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.wa_atd_simular_pessoas(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_atd_simular_pessoas(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.wa_atd_simular_pessoas(text), public.wa_atd_simular_consulta(text, bigint, text, text),
--   public.wa_atd_simular_identidade(text, bigint), public.wa_atd_simular_ident_interna(text, bigint),
--   public.wa_atd_simular_pode();
-- Reaplicar wa_atd_identificar e wa_atd_consultar da 20261118130000; depois:
-- DROP FUNCTION IF EXISTS public.wa_atd_consultar_nucleo(jsonb, text, text), public.wa_atd_identificar_empregado(bigint);
-- NOTIFY pgrst, 'reload schema';
