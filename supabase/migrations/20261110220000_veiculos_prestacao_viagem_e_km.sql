-- =========================================================================
-- Central de Serviços › Agendamento de Veículos: PRESTAÇÃO DA VIAGEM
-- obrigatória para iniciar outra, ÚLTIMO KM do veículo e o painel do dia
-- (10/11/2026, branch local dashboardcassio).
--
-- PEDIDO (chamado do Cássio / Senilton):
--   "conforme os agendamentos dos veículos diários precisa aparecer o
--   agendamento do dia [...] quais os carros agendados estão realmente em
--   rota no momento e com checklist de início realizado"; "não permitisse
--   realizar o início do novo trajeto se o responsável do agendamento tiver
--   viagem pendente de informação da última viagem, sendo obrigatório
--   digitar km de saída, km de retorno, foto da nota do combustível, um
--   arquivo de vídeo completo do veículo, também confirmação de verificação
--   de água e óleo e se tem uma possível avaria"; "puxar sempre em cada
--   veículo o último km informado pelo último condutor, mas não pode deixar
--   de ser adicionado o km de início de quem vai sair [...] saber se tem
--   alguém que está utilizando o veículo e não está agendando ou não está
--   fazendo checklist".
--
-- MUDANÇA DE REGRA (de propósito): até aqui "nada bloqueia" (mig 286, 9300).
-- Agora o INÍCIO da viagem — o checklist de saída (ou o KM inicial) — é
-- recusado enquanto a viagem anterior do mesmo responsável não tiver a
-- prestação completa. Agendar continua livre; só não sai.
--
-- O QUE ESTA MIGRATION FAZ
--   1) Checklist de chegada ganha: vídeo completo do veículo, água verificada,
--      óleo verificado, avaria (sim/não) + descrição. O agendamento ganha
--      "não abasteci nesta viagem" (no lugar da nota, quando não houve).
--   2) prestacao_exigida: true daqui para a frente, false no que já existia
--      (não se cobra prestação de viagem anterior à regra).
--   3) cs_veic_prestacao_faltando(agendamento): o que falta na prestação.
--      cs_veiculo_prestacoes_pendentes(): as viagens de alguém com falta —
--      as que começaram, e as que já passaram sem começar (essas fecham com
--      "Não usei o carro no dia").
--   4) cs_veiculo_checklist_salvar (saída, primeira vez) e cs_veiculo_km_inicial
--      recusam com a lista do que falta. Na saída o KM passa a ser obrigatório.
--   5) Último KM: cs_veiculo_ultimo_km(veículo) e cs_veiculo_ultimos_km()
--      (todos os veículos). Ao registrar o KM de saída, o agendamento guarda
--      o último KM anterior (km_anterior_*): se não bate, alguém rodou com o
--      carro sem agendar/checklist — vai para o histórico e para o dashboard.
--   6) Bucket do checklist aceita o vídeo (até 200 MB).
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- 1) Colunas -----------------------------------------------------------------
ALTER TABLE public."CS_VEICULO_CHECKLIST"
  ADD COLUMN IF NOT EXISTS video_veiculo    text,
  ADD COLUMN IF NOT EXISTS agua_verificada  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS oleo_verificado  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS avaria           boolean,
  ADD COLUMN IF NOT EXISTS avaria_descricao text;
COMMENT ON COLUMN public."CS_VEICULO_CHECKLIST".video_veiculo IS 'Vídeo completo do veículo (chegada). Caminho no bucket cs-veiculos-checklist.';
COMMENT ON COLUMN public."CS_VEICULO_CHECKLIST".avaria IS 'Possível avaria no veículo: true/false; NULL = não respondido.';

ALTER TABLE public.cs_veiculo_agendamento
  ADD COLUMN IF NOT EXISTS sem_abastecimento    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prestacao_exigida    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS km_anterior          integer,
  ADD COLUMN IF NOT EXISTS km_anterior_em       timestamptz,
  ADD COLUMN IF NOT EXISTS km_anterior_numero   bigint,
  ADD COLUMN IF NOT EXISTS km_anterior_condutor text;
-- DEFAULT false no ADD preenche o que já existe; daqui para a frente, true.
ALTER TABLE public.cs_veiculo_agendamento ALTER COLUMN prestacao_exigida SET DEFAULT true;
COMMENT ON COLUMN public.cs_veiculo_agendamento.sem_abastecimento IS 'Condutor declarou que não abasteceu nesta viagem (substitui a nota na prestação).';
COMMENT ON COLUMN public.cs_veiculo_agendamento.prestacao_exigida IS 'false = viagem anterior a 10/11/2026: a prestação (vídeo, água/óleo, avaria…) não é cobrada.';
COMMENT ON COLUMN public.cs_veiculo_agendamento.km_anterior IS 'Último KM do veículo antes desta viagem (de outra viagem), gravado quando o KM de saída é registrado. km_inicial − km_anterior = KM rodado sem registro.';

-- 2) O bucket aceita vídeo ----------------------------------------------------
UPDATE storage.buckets SET file_size_limit = 209715200 -- 200 MB
 WHERE id = 'cs-veiculos-checklist' AND coalesce(file_size_limit, 0) < 209715200;

-- 3) Último KM do veículo -------------------------------------------------------
-- O mais recente entre KM final e KM inicial das outras viagens (a que tem a
-- data de registro mais nova; empate, o maior KM).
CREATE OR REPLACE FUNCTION public.cs_veiculo_ultimo_km(p_patrimonio uuid, p_exceto uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('km', x.km, 'em', x.em, 'numero', x.numero, 'condutor', x.condutor, 'agendamento_id', x.id, 'momento', x.momento)
    FROM (
      SELECT a.id, a.numero, a.solicitante_nome AS condutor, v.km, v.em, v.momento
        FROM public.cs_veiculo_agendamento a
        CROSS JOIN LATERAL (VALUES (a.km_final, coalesce(a.km_final_em, a.updated_at), 'retorno'),
                                   (a.km_inicial, coalesce(a.km_inicial_em, a.created_at), 'saida')) v(km, em, momento)
       WHERE a.patrimonio_id = p_patrimonio
         AND a.status <> 'cancelado'
         AND (p_exceto IS NULL OR a.id <> p_exceto)
         AND v.km IS NOT NULL
       ORDER BY v.em DESC, v.km DESC
       LIMIT 1) x;
$$;
REVOKE ALL ON FUNCTION public.cs_veiculo_ultimo_km(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_ultimo_km(uuid, uuid) TO authenticated;

-- Todos os veículos de uma vez (cards da frota).
CREATE OR REPLACE FUNCTION public.cs_veiculo_ultimos_km()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('patrimonio_id', y.patrimonio_id, 'km', y.km, 'em', y.em,
                                               'numero', y.numero, 'condutor', y.condutor, 'momento', y.momento)), '[]'::jsonb)
    FROM (
      SELECT DISTINCT ON (a.patrimonio_id) a.patrimonio_id, a.numero, a.solicitante_nome AS condutor, v.km, v.em, v.momento
        FROM public.cs_veiculo_agendamento a
        CROSS JOIN LATERAL (VALUES (a.km_final, coalesce(a.km_final_em, a.updated_at), 'retorno'),
                                   (a.km_inicial, coalesce(a.km_inicial_em, a.created_at), 'saida')) v(km, em, momento)
       WHERE a.status <> 'cancelado' AND v.km IS NOT NULL
       ORDER BY a.patrimonio_id, v.em DESC, v.km DESC) y;
$$;
REVOKE ALL ON FUNCTION public.cs_veiculo_ultimos_km() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_ultimos_km() TO authenticated;

-- Grava no agendamento o último KM anterior e, se não bate, o histórico.
CREATE OR REPLACE FUNCTION public.cs_veic_registrar_km_anterior(p_agendamento uuid, p_km integer, p_nome text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a record; u jsonb; v_dif integer;
BEGIN
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento;
  IF a.id IS NULL OR p_km IS NULL OR a.km_anterior IS NOT NULL THEN RETURN; END IF;
  u := public.cs_veiculo_ultimo_km(a.patrimonio_id, a.id);
  IF u IS NULL THEN RETURN; END IF;
  UPDATE public.cs_veiculo_agendamento
     SET km_anterior = (u->>'km')::int, km_anterior_em = (u->>'em')::timestamptz,
         km_anterior_numero = (u->>'numero')::bigint, km_anterior_condutor = u->>'condutor'
   WHERE id = p_agendamento;
  v_dif := p_km - (u->>'km')::int;
  IF v_dif <> 0 THEN
    INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
    VALUES (p_agendamento, 'km_divergente',
            CASE WHEN v_dif > 0
              THEN 'KM de saída ' || p_km || ' · último KM registrado ' || (u->>'km') || ' (nº ' || (u->>'numero') || ', '
                   || coalesce(u->>'condutor', '—') || '): ' || v_dif || ' km rodados sem agendamento/checklist'
              ELSE 'KM de saída ' || p_km || ' MENOR que o último registrado ' || (u->>'km') || ' (nº ' || (u->>'numero') || ', '
                   || coalesce(u->>'condutor', '—') || ') — conferir a digitação' END,
            auth.uid(), p_nome);
  END IF;
EXCEPTION WHEN others THEN
  -- Nunca derruba o checklist por causa da conferência.
  RAISE NOTICE 'cs_veic_registrar_km_anterior: %', SQLERRM;
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veic_registrar_km_anterior(uuid, integer, text) FROM PUBLIC, anon, authenticated;

-- 4) A prestação da viagem ----------------------------------------------------
-- Espelho de src/lib/checklistVeiculo.ts (faltandoPrestacao). Mudou aqui, muda lá.
CREATE OR REPLACE FUNCTION public.cs_veic_prestacao_faltando(p_agendamento uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN a.km_inicial IS NULL THEN 'KM de saída' END,
    CASE WHEN a.km_final IS NULL THEN 'KM de retorno' END,
    CASE WHEN NOT a.sem_abastecimento
              AND NOT EXISTS (SELECT 1 FROM public.cs_veiculo_abastecimento ab WHERE ab.agendamento_id = a.id)
         THEN 'Foto da nota do combustível (ou "não abasteci")' END,
    CASE WHEN c.video_veiculo IS NULL THEN 'Vídeo completo do veículo' END,
    CASE WHEN NOT coalesce(c.agua_verificada, false) OR NOT coalesce(c.oleo_verificado, false) THEN 'Verificação de água e óleo' END,
    CASE WHEN c.avaria IS NULL THEN 'Informar se há avaria'
         WHEN c.avaria AND nullif(btrim(coalesce(c.avaria_descricao, '')), '') IS NULL THEN 'Descrição da avaria' END
  ], NULL)
    FROM public.cs_veiculo_agendamento a
    LEFT JOIN public."CS_VEICULO_CHECKLIST" c ON c.agendamento_id = a.id AND c.tipo = 'chegada'
   WHERE a.id = p_agendamento;
$$;
REVOKE ALL ON FUNCTION public.cs_veic_prestacao_faltando(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veic_prestacao_faltando(uuid) TO authenticated;

-- As viagens de alguém com prestação em falta: as que começaram (KM inicial
-- ou checklist de saída) e as que já terminaram sem começar.
CREATE OR REPLACE FUNCTION public.cs_veiculo_prestacoes_pendentes(p_solicitante uuid DEFAULT NULL, p_exceto uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_quem uuid := coalesce(p_solicitante, auth.uid()); v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF auth.uid() IS NOT NULL AND v_quem <> auth.uid()
     AND NOT public.can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso às viagens de outra pessoa.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'agendamento_id', x.id, 'numero', x.numero, 'veiculo', x.veiculo_nome, 'placa', x.veiculo_identificador,
             'data_inicio', x.data_inicio, 'data_fim', x.data_fim, 'iniciada', x.iniciada, 'faltando', to_jsonb(x.faltando))
             ORDER BY x.data_inicio, x.numero)
      FROM (
        SELECT a.*, public.cs_veic_prestacao_faltando(a.id) AS faltando,
               (a.km_inicial IS NOT NULL OR EXISTS (SELECT 1 FROM public."CS_VEICULO_CHECKLIST" s
                                                    WHERE s.agendamento_id = a.id AND s.tipo = 'saida')) AS iniciada
          FROM public.cs_veiculo_agendamento a
         WHERE a.solicitante_id = v_quem
           AND a.prestacao_exigida
           AND a.status <> 'cancelado'
           AND a.nao_utilizado_em IS NULL
           AND (p_exceto IS NULL OR a.id <> p_exceto)) x
     WHERE cardinality(x.faltando) > 0
       AND (x.iniciada OR x.data_fim < v_hoje)), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_prestacoes_pendentes(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_prestacoes_pendentes(uuid, uuid) TO authenticated;

-- A trava do início: recusa com a lista do que falta.
CREATE OR REPLACE FUNCTION public.cs_veic_exige_prestacao(p_agendamento uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a record; p jsonb; v_msg text;
BEGIN
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento;
  IF a.id IS NULL THEN RETURN; END IF;
  p := public.cs_veiculo_prestacoes_pendentes(a.solicitante_id, a.id);
  IF jsonb_array_length(p) = 0 THEN RETURN; END IF;
  SELECT string_agg('nº ' || (e->>'numero') || ' (' || (e->>'veiculo') || ', ' || to_char((e->>'data_inicio')::date, 'DD/MM')
                    || CASE WHEN (e->>'iniciada')::boolean THEN '' ELSE ', não iniciada — se não usou, marque "Não usei o carro no dia"' END
                    || '): falta ' || (SELECT string_agg(f, ', ') FROM jsonb_array_elements_text(e->'faltando') f), '; ')
    INTO v_msg FROM jsonb_array_elements(p) e;
  RAISE EXCEPTION 'Não dá para iniciar esta viagem: % tem viagem anterior sem a prestação completa — %.',
    coalesce(a.solicitante_nome, 'o responsável'), v_msg
    USING ERRCODE = 'P0001';
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veic_exige_prestacao(uuid) FROM PUBLIC, anon, authenticated;

-- 5) Checklist: saída exige prestação anterior e KM; chegada guarda a prestação
-- Cópia da 20261105009300 com o que mudou marcado "prestação" / "km anterior".
DROP FUNCTION IF EXISTS public.cs_veiculo_checklist_salvar(uuid, text, timestamptz, integer, jsonb, text);
CREATE OR REPLACE FUNCTION public.cs_veiculo_checklist_salvar(
  p_agendamento uuid, p_tipo text, p_realizado_em timestamptz, p_km integer, p_fotos jsonb, p_observacao text,
  p_extra jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  a          record;
  c          public."CS_VEICULO_CHECKLIST"%ROWTYPE;
  v_fotos    jsonb := coalesce(p_fotos, '{}'::jsonb);
  v_extra    jsonb := coalesce(p_extra, '{}'::jsonb);
  v_prefixo  text := p_agendamento::text || '/';
  v_caminho  text;
  v_nome     text;
  v_era      boolean;
  v_falta    int;
  v_existia  boolean;
BEGIN
  IF p_tipo NOT IN ('saida', 'chegada') THEN RAISE EXCEPTION 'Tipo de checklist inválido.'; END IF;
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  IF a.solicitante_id <> auth.uid() AND NOT public.can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Só quem agendou (ou quem gerencia a frota) preenche este checklist.';
  END IF;
  IF a.status = 'cancelado' THEN RAISE EXCEPTION 'Agendamento cancelado não tem checklist.'; END IF;
  IF p_km IS NOT NULL AND p_km < 0 THEN RAISE EXCEPTION 'KM inválido.'; END IF;
  IF p_tipo = 'chegada' AND p_km IS NOT NULL AND a.km_inicial IS NOT NULL AND p_km < a.km_inicial THEN
    RAISE EXCEPTION 'O KM da chegada (%) não pode ser menor que o KM inicial da viagem (%).', p_km, a.km_inicial;
  END IF;

  v_existia := EXISTS (SELECT 1 FROM public."CS_VEICULO_CHECKLIST" WHERE agendamento_id = p_agendamento AND tipo = p_tipo);
  -- prestação: o INÍCIO (primeiro checklist de saída, sem KM inicial ainda)
  -- só com a viagem anterior do responsável completa; e o KM é obrigatório.
  IF p_tipo = 'saida' AND NOT v_existia AND a.km_inicial IS NULL AND a.prestacao_exigida THEN
    PERFORM public.cs_veic_exige_prestacao(p_agendamento);
  END IF;
  IF p_tipo = 'saida' AND a.prestacao_exigida AND p_km IS NULL AND a.km_inicial IS NULL
     AND NOT EXISTS (SELECT 1 FROM public."CS_VEICULO_CHECKLIST" WHERE agendamento_id = p_agendamento AND tipo = 'saida' AND km IS NOT NULL) THEN
    RAISE EXCEPTION 'Informe o KM do painel na saída.';
  END IF;

  -- Só aceita arquivo da pasta deste agendamento (é o que a policy do bucket deixou subir).
  FOR v_caminho IN SELECT x #>> '{}' FROM jsonb_path_query(v_fotos, '$.** ? (@.type() == "string")') x LOOP
    IF left(v_caminho, length(v_prefixo)) <> v_prefixo THEN
      RAISE EXCEPTION 'Arquivo fora da pasta do agendamento: %', v_caminho;
    END IF;
  END LOOP;
  IF (v_extra ? 'avaria') AND (v_extra->>'avaria')::boolean
     AND nullif(btrim(coalesce(v_extra->>'avaria_descricao', '')), '') IS NULL THEN
    RAISE EXCEPTION 'Descreva a avaria.';
  END IF;

  SELECT coalesce(display_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public."CS_VEICULO_CHECKLIST"(agendamento_id, tipo, condutor_id, condutor_nome, preenchido_por_id, preenchido_por_nome)
  VALUES (p_agendamento, p_tipo, a.solicitante_id, a.solicitante_nome, auth.uid(), v_nome)
  ON CONFLICT (agendamento_id, tipo) DO NOTHING;

  SELECT * INTO c FROM public."CS_VEICULO_CHECKLIST" WHERE agendamento_id = p_agendamento AND tipo = p_tipo FOR UPDATE;
  v_era := c.completo;

  UPDATE public."CS_VEICULO_CHECKLIST" SET
    realizado_em          = coalesce(p_realizado_em, realizado_em),
    km                    = coalesce(p_km, km),
    foto_lateral_direita  = coalesce(nullif(v_fotos->>'foto_lateral_direita', ''),  foto_lateral_direita),
    foto_lateral_esquerda = coalesce(nullif(v_fotos->>'foto_lateral_esquerda', ''), foto_lateral_esquerda),
    foto_dianteira        = coalesce(nullif(v_fotos->>'foto_dianteira', ''),        foto_dianteira),
    foto_traseira         = coalesce(nullif(v_fotos->>'foto_traseira', ''),         foto_traseira),
    foto_km               = coalesce(nullif(v_fotos->>'foto_km', ''),               foto_km),
    video_veiculo         = coalesce(nullif(v_fotos->>'video_veiculo', ''),         video_veiculo),   -- prestação
    fotos_interior        = CASE WHEN jsonb_typeof(v_fotos->'fotos_interior') = 'array'
                                 THEN ARRAY(SELECT jsonb_array_elements_text(v_fotos->'fotos_interior')) ELSE fotos_interior END,
    fotos_defeito         = CASE WHEN jsonb_typeof(v_fotos->'fotos_defeito') = 'array'
                                 THEN ARRAY(SELECT jsonb_array_elements_text(v_fotos->'fotos_defeito')) ELSE fotos_defeito END,
    observacao            = CASE WHEN p_observacao IS NULL THEN observacao ELSE nullif(btrim(p_observacao), '') END,
    agua_verificada       = CASE WHEN v_extra ? 'agua_verificada' THEN coalesce((v_extra->>'agua_verificada')::boolean, false) ELSE agua_verificada END,  -- prestação
    oleo_verificado       = CASE WHEN v_extra ? 'oleo_verificado' THEN coalesce((v_extra->>'oleo_verificado')::boolean, false) ELSE oleo_verificado END,  -- prestação
    avaria                = CASE WHEN v_extra ? 'avaria' THEN (v_extra->>'avaria')::boolean ELSE avaria END,                                              -- prestação
    avaria_descricao      = CASE WHEN v_extra ? 'avaria' THEN CASE WHEN (v_extra->>'avaria')::boolean
                                                                   THEN nullif(btrim(coalesce(v_extra->>'avaria_descricao', '')), '') END
                                 ELSE avaria_descricao END,                                                                                                 -- prestação
    condutor_id           = coalesce(condutor_id, a.solicitante_id),
    condutor_nome         = coalesce(condutor_nome, a.solicitante_nome),
    preenchido_por_id     = auth.uid(),
    preenchido_por_nome   = v_nome
  WHERE id = c.id
  RETURNING * INTO c;

  -- prestação: "não abasteci nesta viagem" é do agendamento.
  IF p_tipo = 'chegada' AND v_extra ? 'sem_abastecimento' THEN
    BEGIN
      UPDATE public.cs_veiculo_agendamento SET sem_abastecimento = coalesce((v_extra->>'sem_abastecimento')::boolean, false), updated_at = now()
       WHERE id = p_agendamento;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'cs_veiculo_checklist_salvar: sem_abastecimento não gravado (%)', SQLERRM;
    END;
  END IF;

  -- O KM do checklist é o KM da viagem: preenche o que ainda estiver vazio,
  -- nunca sobrescreve (o KM inicial/final têm trilha própria). Em bloco
  -- protegido: o UPDATE passa pelo trg_cs_veic_checar, e um carro que entrou
  -- em manutenção depois não pode impedir o checklist de ser salvo.
  BEGIN
    IF p_tipo = 'saida' AND (c.km IS NOT NULL OR c.foto_km IS NOT NULL)
       AND (a.km_inicial IS NULL OR a.km_inicial_foto IS NULL) THEN
      UPDATE public.cs_veiculo_agendamento
         SET km_inicial      = coalesce(km_inicial, c.km),
             km_inicial_foto = coalesce(km_inicial_foto, c.foto_km),
             km_inicial_em   = coalesce(km_inicial_em, now()),
             updated_at      = now()
       WHERE id = p_agendamento;
      IF a.km_inicial IS NULL AND c.km IS NOT NULL THEN
        PERFORM public.cs_veic_registrar_km_anterior(p_agendamento, c.km, v_nome);   -- km anterior
      END IF;
    ELSIF p_tipo = 'chegada' THEN
      UPDATE public.cs_veiculo_agendamento
         SET km_final      = coalesce(km_final, c.km),
             km_final_foto = coalesce(km_final_foto, c.foto_km),
             km_final_em   = CASE WHEN (km_final IS NULL AND c.km IS NOT NULL) OR (km_final_foto IS NULL AND c.foto_km IS NOT NULL)
                                  THEN coalesce(km_final_em, now()) ELSE km_final_em END,
             -- Chegada completa = carro devolvido: finaliza a viagem.
             finalizada_em = CASE WHEN c.completo THEN coalesce(finalizada_em, now()) ELSE finalizada_em END,
             updated_at    = now()
       WHERE id = p_agendamento;
    END IF;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'cs_veiculo_checklist_salvar: KM da viagem não atualizado (%)', SQLERRM;
  END;

  v_falta := (CASE WHEN c.foto_lateral_direita IS NULL THEN 1 ELSE 0 END) + (CASE WHEN c.foto_lateral_esquerda IS NULL THEN 1 ELSE 0 END)
           + (CASE WHEN c.foto_dianteira IS NULL THEN 1 ELSE 0 END) + (CASE WHEN c.foto_traseira IS NULL THEN 1 ELSE 0 END)
           + greatest(0, 4 - coalesce(cardinality(c.fotos_interior), 0)) + (CASE WHEN c.foto_km IS NULL THEN 1 ELSE 0 END);

  INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
  VALUES (p_agendamento, 'checklist_' || p_tipo,
          concat_ws(' · ',
            'Checklist de ' || CASE p_tipo WHEN 'saida' THEN 'saída' ELSE 'chegada' END
              || CASE WHEN c.completo AND NOT v_era THEN ' preenchido'
                      WHEN c.completo THEN ' atualizado'
                      ELSE ' salvo pela metade (falta' || CASE WHEN v_falta > 1 THEN 'm ' ELSE ' ' END || v_falta || ' foto' || CASE WHEN v_falta > 1 THEN 's' ELSE '' END || ')' END,
            CASE WHEN c.km IS NOT NULL THEN 'KM ' || c.km END,
            CASE WHEN c.video_veiculo IS NOT NULL AND p_tipo = 'chegada' THEN 'vídeo do veículo' END,
            CASE WHEN p_tipo = 'chegada' AND c.agua_verificada AND c.oleo_verificado THEN 'água e óleo verificados' END,
            CASE WHEN c.avaria THEN 'AVARIA: ' || left(c.avaria_descricao, 120) WHEN c.avaria = false THEN 'sem avaria' END,
            CASE WHEN cardinality(c.fotos_defeito) > 0 THEN cardinality(c.fotos_defeito) || ' foto(s) de defeito' END,
            CASE WHEN c.preenchido_por_id IS DISTINCT FROM a.solicitante_id THEN 'preenchido por ' || coalesce(v_nome, '—') END),
          auth.uid(), v_nome);

  RETURN to_jsonb(c);
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_checklist_salvar(uuid, text, timestamptz, integer, jsonb, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_checklist_salvar(uuid, text, timestamptz, integer, jsonb, text, jsonb) TO authenticated;

-- 6) KM inicial pela tela da viagem: mesma trava e mesma conferência ----------
-- Cópia da 20260930000219 com a trava de prestação e o KM anterior.
CREATE OR REPLACE FUNCTION public.cs_veiculo_km_inicial(p_agendamento uuid, p_km integer, p_foto text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a record; v_nome text; v_foto text := nullif(btrim(coalesce(p_foto, '')), '');
BEGIN
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  IF a.solicitante_id <> auth.uid() AND NOT can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Só quem agendou (ou o Patrimônio) registra o KM desta viagem.';
  END IF;
  IF p_km IS NULL AND v_foto IS NULL THEN RAISE EXCEPTION 'Informe o KM inicial ou a foto do painel.'; END IF;
  -- prestação: começar a viagem pelo KM inicial também exige a anterior completa.
  IF a.km_inicial IS NULL AND a.prestacao_exigida
     AND NOT EXISTS (SELECT 1 FROM public."CS_VEICULO_CHECKLIST" s WHERE s.agendamento_id = a.id AND s.tipo = 'saida') THEN
    PERFORM public.cs_veic_exige_prestacao(p_agendamento);
  END IF;
  IF p_km IS NOT NULL THEN
    IF a.km_inicial IS NOT NULL THEN RAISE EXCEPTION 'O KM inicial desta viagem já foi registrado (% km).', a.km_inicial; END IF;
    IF p_km < 0 THEN RAISE EXCEPTION 'KM inicial inválido.'; END IF;
    IF a.km_final IS NOT NULL AND p_km > a.km_final THEN
      RAISE EXCEPTION 'O KM inicial (%) não pode ser maior que o final (%).', p_km, a.km_final;
    END IF;
  END IF;
  IF v_foto IS NOT NULL AND a.km_inicial_foto IS NOT NULL THEN
    RAISE EXCEPTION 'A foto do KM inicial desta viagem já foi anexada.';
  END IF;

  UPDATE public.cs_veiculo_agendamento
     SET km_inicial      = coalesce(p_km, km_inicial),
         km_inicial_foto = coalesce(v_foto, km_inicial_foto),
         km_inicial_em   = coalesce(km_inicial_em, now()),
         updated_at      = now()
   WHERE id = p_agendamento;

  SELECT coalesce(display_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
  VALUES (p_agendamento, 'km_inicial',
          concat_ws(' · ',
            CASE WHEN p_km IS NOT NULL THEN 'KM inicial ' || p_km END,
            CASE WHEN v_foto IS NOT NULL THEN 'foto do painel anexada' END) || ' (registrado depois)',
          auth.uid(), v_nome);
  IF p_km IS NOT NULL THEN PERFORM public.cs_veic_registrar_km_anterior(p_agendamento, p_km, v_nome); END IF;  -- km anterior
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_km_inicial(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_km_inicial(uuid, integer, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.cs_veiculo_checklist_salvar(uuid, text, timestamptz, integer, jsonb, text, jsonb);
--   (reaplicar cs_veiculo_checklist_salvar da 20261105009300 e cs_veiculo_km_inicial da 20260930000219)
--   DROP FUNCTION IF EXISTS public.cs_veic_exige_prestacao(uuid), public.cs_veiculo_prestacoes_pendentes(uuid, uuid),
--     public.cs_veic_prestacao_faltando(uuid), public.cs_veic_registrar_km_anterior(uuid, integer, text),
--     public.cs_veiculo_ultimos_km(), public.cs_veiculo_ultimo_km(uuid, uuid);
--   ALTER TABLE public."CS_VEICULO_CHECKLIST" DROP COLUMN IF EXISTS video_veiculo, DROP COLUMN IF EXISTS agua_verificada,
--     DROP COLUMN IF EXISTS oleo_verificado, DROP COLUMN IF EXISTS avaria, DROP COLUMN IF EXISTS avaria_descricao;
--   ALTER TABLE public.cs_veiculo_agendamento DROP COLUMN IF EXISTS sem_abastecimento, DROP COLUMN IF EXISTS prestacao_exigida,
--     DROP COLUMN IF EXISTS km_anterior, DROP COLUMN IF EXISTS km_anterior_em, DROP COLUMN IF EXISTS km_anterior_numero,
--     DROP COLUMN IF EXISTS km_anterior_condutor;
--   UPDATE storage.buckets SET file_size_limit = 15728640 WHERE id = 'cs-veiculos-checklist';
-- =========================================================================
