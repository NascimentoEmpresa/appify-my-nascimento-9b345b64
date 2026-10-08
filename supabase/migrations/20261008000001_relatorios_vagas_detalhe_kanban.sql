-- =========================================================================
-- RELATÓRIOS › VAGAS — DETALHE COM O KANBAN DOS CANDIDATOS (08/10/2026)
--
-- PEDIDO (Pablo): "selecionar UMA vaga específica e ter um gráfico sobre os
-- tempos que passou pelos status dos kanbans". O detalhe da vaga
-- (dir_vagas_detalhe, mig 20261007000020) passa a devolver o candidato_id de
-- cada movimentação da trilha e a data da desistência do candidato — é o
-- que liga a trilha a cada candidato e permite desenhar quanto tempo cada um
-- ficou em cada coluna do kanban de candidatos. Mesma assinatura e acesso.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

DROP FUNCTION IF EXISTS public.dir_vagas_detalhe(bigint);
CREATE FUNCTION public.dir_vagas_detalhe(_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.dir_vagas_exige();
  RETURN jsonb_build_object(
    'vaga', (SELECT jsonb_build_object(
               'id', s.id, 'criada', s.created_at, 'status', s.status, 'status_em', s.status_changed_at,
               'cargo', s.cargo, 'cidade', s.cidade, 'uf', s.estado, 'contrato', s.contrato, 'setor', s.setor,
               'motivo', s.motivo_vaga, 'urgencia', s.grau_urgencia, 'qtd', COALESCE(s.quantidade_vagas, 1),
               'escala', s.escala, 'horario', s.horario, 'salario', s.salario, 'local', s.local_exato,
               'inicio_previsto', s.data_inicio_prevista, 'substituido', s.nome_substituido,
               'solicitante', s.solicitante_nome, 'analista', s.analista_nome, 'aprovado_por', s.aprovado_por_nome,
               'contratado', s.contratado_nome, 'contratado_inicio', s.contratado_data_inicio,
               'motivo_reprovacao', s.motivo_reprovacao, 'legado', s.legado_chave IS NOT NULL,
               'req_obrigatorios', s.req_obrigatorios, 'observacao', s.observacao_importante)
               FROM public."SISTEMA_RECRUTAMENTO" s WHERE s.id = _id),
    'log', COALESCE((SELECT jsonb_agg(jsonb_build_array(l.status_anterior, l.status_novo, l.changed_at) ORDER BY l.changed_at, l.id)
                       FROM public."SISTEMA_RECRUTAMENTO_STATUS_LOG" l WHERE l.solicitacao_id = _id), '[]'::jsonb),
    'historico', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'id', h.id, 'created_at', h.created_at, 'evento', h.evento, 'de_status', h.de_status,
                   'para_status', h.para_status, 'papel', h.papel, 'usuario_nome', h.usuario_nome,
                   'usuario_email', NULL, 'detalhe', h.detalhe, 'candidato_nome', h.candidato_nome, 'candidato_id', h.candidato_id) ORDER BY h.created_at, h.id)
                     FROM public."RECRUTAMENTO_HISTORICO" h WHERE h.solicitacao_id = _id), '[]'::jsonb),
    'candidatos', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'id', c.id, 'nome', COALESCE(c.nome_informado, c.nome), 'criado', c.created_at,
                   'etapa', upper(COALESCE(NULLIF(trim(c.etapa_processo), ''), 'ENTRADA')), 'etapa_em', c.etapa_changed_at,
                   'origem', COALESCE(c.tipo_candidatura, c.origem), 'selecionado_em', c.selecionado_em,
                   'enviado_em', c.enviado_admissao_em, 'desistiu', COALESCE(c.desistiu, false),
                   'desistencia_motivo', c.desistencia_motivo, 'desistencia_em', c.desistencia_em, 'motivo_reprovacao', c.motivo_reprovacao) ORDER BY c.created_at)
                     FROM public."WA_CURRICULOS" c WHERE c.vaga_id = _id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.dir_vagas_detalhe(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dir_vagas_detalhe(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';
