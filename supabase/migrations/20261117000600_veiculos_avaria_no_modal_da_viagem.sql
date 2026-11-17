-- =========================================================================
-- FROTA: "Houve avaria?" no próprio modal da viagem (17/11/2026)
--
-- RELATO (Pablo, print da Viagem nº 244 · ONIX, "Viagem finalizada — Para
-- concluir, falta: Informar se há avaria", botão Concluir desabilitado):
-- "tá impedindo de solicitar por não informar se tem avaria, mas não tem
-- NENHUM LUGAR PRA INFORMAR SE TEVE AVARIA".
--
-- POR QUÊ: a avaria só existia no checklist de CHEGADA
-- (CS_VEICULO_CHECKLIST.avaria). Quem não fez o checklist de chegada (o
-- histórico da viagem mostrava "Checklist não preenchido") ficava sem onde
-- responder, e cs_veic_prestacao_faltando cobrava para sempre: a viagem não
-- concluía e travava o próximo agendamento do motorista.
--
-- O QUE MUDA
--   1. cs_veiculo_agendamento ganha avaria / avaria_descricao (a resposta dada
--      na viagem).
--   2. cs_veiculo_avaria_responder(agendamento, avaria, descrição): Sim exige
--      a descrição. Se a viagem tem checklist de chegada, grava lá também
--      (fica igual nos dois lugares). Vai para o histórico do agendamento.
--   3. cs_veic_prestacao_faltando aceita a resposta da viagem: vale a do
--      checklist de chegada; sem ela, a da viagem.
--   4. cs_veiculo_viagem devolve avaria / avaria_descricao para o modal.
-- Espelho na tela: src/lib/veiculos/rotaDoDia.ts (faltandoPrestacao).
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

ALTER TABLE public.cs_veiculo_agendamento ADD COLUMN IF NOT EXISTS avaria boolean;
ALTER TABLE public.cs_veiculo_agendamento ADD COLUMN IF NOT EXISTS avaria_descricao text;

-- 1) Responder ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cs_veiculo_avaria_responder(p_agendamento uuid, p_avaria boolean, p_descricao text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a record; v_nome text; v_desc text := nullif(btrim(coalesce(p_descricao, '')), '');
BEGIN
  IF p_avaria IS NULL THEN RAISE EXCEPTION 'Responda Sim ou Não.'; END IF;
  IF p_avaria AND v_desc IS NULL THEN RAISE EXCEPTION 'Descreva a avaria.'; END IF;
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  IF a.solicitante_id <> auth.uid() AND NOT can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Só quem agendou (ou quem gerencia a frota) responde pela avaria.';
  END IF;
  IF a.status = 'cancelado' THEN RAISE EXCEPTION 'Agendamento cancelado.'; END IF;

  UPDATE public.cs_veiculo_agendamento
     SET avaria = p_avaria, avaria_descricao = CASE WHEN p_avaria THEN v_desc END, updated_at = now()
   WHERE id = p_agendamento;
  -- Com checklist de chegada, a resposta fica a mesma nos dois lugares.
  UPDATE public."CS_VEICULO_CHECKLIST"
     SET avaria = p_avaria, avaria_descricao = CASE WHEN p_avaria THEN v_desc END
   WHERE agendamento_id = p_agendamento AND tipo = 'chegada';

  SELECT coalesce(display_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
  VALUES (p_agendamento, 'avaria',
          CASE WHEN p_avaria THEN 'Houve avaria: Sim — ' || v_desc ELSE 'Houve avaria: Não' END,
          auth.uid(), v_nome);
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_avaria_responder(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_avaria_responder(uuid, boolean, text) TO authenticated;

-- 2) A prestação aceita a resposta da viagem ---------------------------------
-- Igual à 20261112173000, com a avaria do checklist de chegada OU da viagem.
CREATE OR REPLACE FUNCTION public.cs_veic_prestacao_faltando(p_agendamento uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN a.km_inicial IS NULL THEN 'KM de saída' END,
    CASE WHEN a.km_final IS NULL THEN 'KM de retorno' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.cs_veiculo_abastecimento ab WHERE ab.agendamento_id = a.id) THEN NULL
         WHEN a.houve_abastecimento = false OR a.sem_abastecimento THEN NULL
         WHEN a.houve_abastecimento THEN 'Foto da nota do combustível'
         ELSE 'Responder se houve abastecimento' END,
    CASE WHEN coalesce(c.avaria, a.avaria) IS NULL THEN 'Informar se há avaria'
         WHEN coalesce(c.avaria, a.avaria)
              AND nullif(btrim(coalesce(CASE WHEN c.avaria IS NOT NULL THEN c.avaria_descricao ELSE a.avaria_descricao END, '')), '') IS NULL
           THEN 'Descrição da avaria' END
  ], NULL)
    FROM public.cs_veiculo_agendamento a
    LEFT JOIN public."CS_VEICULO_CHECKLIST" c ON c.agendamento_id = a.id AND c.tipo = 'chegada'
   WHERE a.id = p_agendamento;
$$;
REVOKE ALL ON FUNCTION public.cs_veic_prestacao_faltando(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veic_prestacao_faltando(uuid) TO authenticated;

-- 3) O modal da viagem recebe a resposta ------------------------------------
-- Igual à 20261112173000 + avaria / avaria_descricao.
CREATE OR REPLACE FUNCTION public.cs_veiculo_viagem(p_agendamento uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a record; v_notas int;
BEGIN
  IF NOT tem_acesso_menu('central_servicos_veiculos') THEN RAISE EXCEPTION 'Sem acesso a Veículos.'; END IF;
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  SELECT count(*) INTO v_notas FROM public.cs_veiculo_abastecimento WHERE agendamento_id = a.id;
  RETURN jsonb_build_object(
    'id', a.id, 'numero', a.numero, 'veiculo_nome', a.veiculo_nome, 'veiculo_identificador', a.veiculo_identificador,
    'data_inicio', a.data_inicio, 'data_fim', a.data_fim, 'turno', a.turno, 'status', a.status,
    'solicitante_nome', a.solicitante_nome, 'solicitante_id', a.solicitante_id,
    'destino', a.destino, 'motivo', a.motivo, 'observacoes', a.observacoes,
    'controle_km', a.controle_km, 'finalizada_em', a.finalizada_em,
    'km_inicial', a.km_inicial, 'km_inicial_foto', a.km_inicial_foto, 'km_inicial_em', a.km_inicial_em,
    'km_final', a.km_final, 'km_final_foto', a.km_final_foto, 'km_final_em', a.km_final_em,
    'rodados', CASE WHEN a.km_final IS NOT NULL AND a.km_inicial IS NOT NULL THEN a.km_final - a.km_inicial END,
    -- 12/11: KM de chegada da última viagem FECHADA do veículo (qualquer motorista).
    'km_sugerido', (SELECT jsonb_build_object('km', u.km_final, 'numero', u.numero, 'condutor', u.solicitante_nome,
                                              'em', coalesce(u.km_final_em, u.finalizada_em))
                      FROM public.cs_veiculo_agendamento u
                     WHERE u.patrimonio_id = a.patrimonio_id AND u.id <> a.id
                       AND u.status <> 'cancelado' AND u.finalizada_em IS NOT NULL AND u.km_final IS NOT NULL
                     ORDER BY coalesce(u.km_final_em, u.finalizada_em) DESC, u.km_final DESC
                     LIMIT 1),
    -- 12/11: resposta do abastecimento (NULL = sem resposta; nota anexada vale Sim).
    'houve_abastecimento', CASE WHEN v_notas > 0 THEN true
                                WHEN a.houve_abastecimento IS NOT NULL THEN a.houve_abastecimento
                                WHEN a.sem_abastecimento THEN false END,
    -- 17/11: "Houve avaria?" — vale a do checklist de chegada; sem ela, a resposta dada na viagem.
    'avaria', (SELECT coalesce(c.avaria, a.avaria) FROM (SELECT 1) x
                 LEFT JOIN public."CS_VEICULO_CHECKLIST" c ON c.agendamento_id = a.id AND c.tipo = 'chegada'),
    'avaria_descricao', (SELECT CASE WHEN c.avaria IS NOT NULL THEN c.avaria_descricao ELSE a.avaria_descricao END FROM (SELECT 1) x
                 LEFT JOIN public."CS_VEICULO_CHECKLIST" c ON c.agendamento_id = a.id AND c.tipo = 'chegada'),
    'prestacao_exigida', a.prestacao_exigida,
    'prestacao_faltando', CASE WHEN a.prestacao_exigida AND a.nao_utilizado_em IS NULL
                               THEN to_jsonb(public.cs_veic_prestacao_faltando(a.id)) ELSE '[]'::jsonb END,
    'relato', a.relato, 'relato_em', a.relato_em, 'relato_por_nome', a.relato_por_nome,
    'midias', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'storage_path', m.storage_path, 'nome_arquivo', m.nome_arquivo,
                                                            'tipo', m.tipo, 'tamanho', m.tamanho, 'criado_por_nome', m.criado_por_nome,
                                                            'created_at', m.created_at) ORDER BY m.created_at)
                          FROM public."CS_VEICULO_VIAGEM_MIDIA" m WHERE m.agendamento_id = a.id), '[]'::jsonb),
    'contratos', coalesce((SELECT jsonb_agg(jsonb_build_object('codigo', c.contrato_codigo, 'nome', c.contrato_nome, 'administrativo', c.administrativo) ORDER BY c.contrato_nome)
                             FROM public.cs_veiculo_agendamento_contrato c WHERE c.agendamento_id = a.id), '[]'::jsonb),
    'abastecimentos', coalesce((SELECT jsonb_agg(jsonb_build_object(
                                 'id', b.id, 'data', b.data, 'descricao', b.descricao, 'valor', b.valor, 'litros', b.litros, 'km', b.km,
                                 'storage_path', b.storage_path, 'nome_arquivo', b.nome_arquivo, 'criado_por_nome', b.criado_por_nome,
                                 'created_at', b.created_at,
                                 'contratos', coalesce((SELECT jsonb_agg(jsonb_build_object('codigo', bc.contrato_codigo, 'nome', bc.contrato_nome, 'administrativo', bc.administrativo) ORDER BY bc.contrato_nome)
                                                          FROM public.cs_veiculo_abastecimento_contrato bc WHERE bc.abastecimento_id = b.id), '[]'::jsonb))
                                 ORDER BY b.data DESC, b.created_at DESC)
                                FROM public.cs_veiculo_abastecimento b WHERE b.agendamento_id = a.id), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_viagem(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_viagem(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar cs_veic_prestacao_faltando e cs_veiculo_viagem da 20261112173000. Depois:
-- DROP FUNCTION IF EXISTS public.cs_veiculo_avaria_responder(uuid, boolean, text);
-- ALTER TABLE public.cs_veiculo_agendamento DROP COLUMN IF EXISTS avaria_descricao;
-- ALTER TABLE public.cs_veiculo_agendamento DROP COLUMN IF EXISTS avaria;
-- NOTIFY pgrst, 'reload schema';
