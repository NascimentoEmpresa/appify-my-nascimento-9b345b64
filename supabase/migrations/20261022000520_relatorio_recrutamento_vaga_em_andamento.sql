-- =========================================================================
-- Relatórios › Gestão Recrutamento: "Em andamento" = VAGA EM ANDAMENTO (22/10/2026)
--
-- Pablo: "/relatorios/recrutamento e /relatorios/vagas ainda estão puxando 90
-- vagas, arruma pra ficar igual à TV e à Gestão, onde é 76". A régua única
-- (src/lib/recrutamento/vagaEmAndamento.ts; TV na mig 20261022000510):
-- em andamento = todas menos Pendente Operacional/Analista/Diretoria,
-- Pendente Recrutamento, concluídas (Contratado / Concluído…) e
-- reprovadas/canceladas.
--
-- Aqui o relatório genérico (dir_rel_montar) conta o cartão "Em andamento"
-- pelo grupo 'aberto'. No ramo 'recrutamento' de dir_rel_dados a vaga que
-- espera aprovação ou o Recrutamento passa para o grupo novo 'pendente'
-- (fica no total e no "por status", fora do Em andamento). De carona:
-- "Concluído…" com sufixo contava como aberto (só 'Concluído' exato era
-- concluído) — agora é LIKE 'Concluído%', igual ao resto do sistema.
--
-- Corpo de dir_rel_dados igual ao da 20261013000003 (a última), fora o ramo
-- 'recrutamento'. Idempotente.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.dir_rel_dados(_slug text, _de date DEFAULT NULL::date, _ate date DEFAULT NULL::date, _contrato uuid DEFAULT NULL::uuid, _meses integer[] DEFAULT NULL::integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  CASE _slug
  WHEN 'recrutamento' THEN RETURN public.dir_rel_montar('Gestão Recrutamento', $q$
    SELECT created_at::date, '#' || id || ' · ' || COALESCE(cargo, 'vaga') || COALESCE(' — ' || contrato, '')
           || ' · Resp.: ' || COALESCE((SELECT rr.responsavel_nome FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" rr WHERE rr.vaga_id = "SISTEMA_RECRUTAMENTO".id), 'sem responsável'), status,
           CASE WHEN btrim(status) = 'Contratado' OR btrim(status) LIKE 'Concluído%' THEN 'concluido'
                WHEN btrim(status) IN ('Reprovada', 'Cancelada') THEN 'recusado'
                -- Esperando aprovação (Operacional/Analista/Diretoria) ou o Recrutamento: fora do Em andamento.
                WHEN btrim(status) IN ('Pendente Analista', 'Pendente Operacional', 'Pendente Diretoria', 'Pendente Recrutamento') THEN 'pendente'
                ELSE 'aberto' END,
           contrato, cargo, motivo_vaga,
           CASE WHEN (btrim(status) = 'Contratado' OR btrim(status) LIKE 'Concluído%') AND status_changed_at IS NOT NULL
                THEN extract(epoch FROM status_changed_at - created_at) / 86400 END,
           contrato_id, contrato
      FROM public."SISTEMA_RECRUTAMENTO" $q$,
    _de, _ate, '["Vagas por contrato", "Vagas por cargo", "Motivo da vaga"]'::jsonb, 'vagas', _contrato, _meses);

  WHEN 'demissoes' THEN RETURN public.dir_rel_montar('Demissões', $q$
    SELECT COALESCE(data_solicitacao, criado_em::date), COALESCE(colaborador_nome, 'colaborador') || COALESCE(' — ' || colaborador_cargo, ''), status,
           CASE WHEN status IN ('Concluída', 'ASO válido', 'Agendamento concluído') THEN 'concluido'
                WHEN status IN ('Reprovada', 'Cancelada') THEN 'recusado' ELSE 'aberto' END,
           contrato, COALESCE(motivo_solicitacao, motivo_pedido), colaborador_cargo,
           CASE WHEN status IN ('Concluída', 'ASO válido', 'Agendamento concluído')
                THEN extract(epoch FROM atualizado_em - criado_em) / 86400 END,
           NULL::uuid, COALESCE(contrato, colaborador_filial)   -- contrato_id aqui é bigint (outro cadastro): casa pelo nome
      FROM public."SISTEMA_SOLICITACOES_DEMISSAO" $q$,
    _de, _ate, '["Demissões por contrato", "Motivo da demissão", "Cargo"]'::jsonb, 'demissões', _contrato, _meses);

  WHEN 'materiais' THEN RETURN public.dir_rel_montar('Materiais', $q$
    SELECT COALESCE(data_solicitacao, created_at::date), 'Pedido ' || COALESCE(pedido_id::text, id::text) || COALESCE(' — ' || nome_colaborador, ''), status,
           CASE WHEN status IN ('DESPACHADO', 'RETIRADO PARA ENTREGA') THEN 'concluido'
                WHEN status = 'CANCELADO' THEN 'recusado' ELSE 'aberto' END,
           contrato_nome, tipo_pedido, funcao_nome,
           CASE WHEN data_despachado IS NOT NULL
                THEN extract(epoch FROM data_despachado - COALESCE(data_solicitacao::timestamptz, created_at)) / 86400 END,
           contrato_id, contrato_nome
      FROM public.sup_pedido $q$,
    _de, _ate, '["Pedidos por contrato", "Tipo de pedido", "Função"]'::jsonb, 'pedidos', _contrato, _meses);

  WHEN 'ferias' THEN RETURN public.dir_rel_montar('Férias', $q$
    SELECT criado_em::date, COALESCE(colaborador_nome, 'colaborador') || COALESCE(' · ' || dias_ferias || ' dias', ''), status,
           CASE WHEN status = 'Aprovada' THEN 'concluido'
                WHEN status IN ('Reprovada', 'Cancelada') THEN 'recusado' ELSE 'aberto' END,
           colaborador_filial, colaborador_cargo, COALESCE(dias_ferias::text || ' dias', NULL),
           CASE WHEN status = 'Aprovada' AND aprovado_em IS NOT NULL THEN extract(epoch FROM aprovado_em - criado_em) / 86400 END,
           NULL::uuid, colaborador_filial
      FROM public."SISTEMA_SOLICITACOES_FERIAS" $q$,
    _de, _ate, '["Férias por filial/contrato", "Cargo", "Dias de férias"]'::jsonb, 'solicitações', _contrato, _meses);

  WHEN 'medida-disciplinar' THEN RETURN public.dir_rel_montar('Medida Disciplinar', $q$
    SELECT created_at::date, COALESCE(colaborador_nome, 'colaborador') || COALESCE(' — ' || tipo_advertencia, ''), status,
           CASE WHEN status IN ('Concluída', 'Registrada') THEN 'concluido'
                WHEN status IN ('Reprovada', 'Cancelada') THEN 'recusado' ELSE 'aberto' END,
           contrato, tipo_advertencia, grau,
           CASE WHEN status IN ('Concluída', 'Registrada') AND status_changed_at IS NOT NULL
                THEN extract(epoch FROM status_changed_at - created_at) / 86400 END,
           NULL::uuid, COALESCE(contrato, colaborador_filial)   -- contrato_id aqui é bigint (outro cadastro): casa pelo nome
      FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA" $q$,
    _de, _ate, '["Medidas por contrato", "Tipo de medida", "Grau"]'::jsonb, 'medidas', _contrato, _meses);

  WHEN 'chamados' THEN RETURN public.dir_rel_montar('Chamados', $q$
    SELECT created_at::date, COALESCE(numero, '#' || id::text) || ' · ' || COALESCE(assunto, ''), status,
           CASE WHEN status = 'concluido' THEN 'concluido'
                WHEN status IN ('reprovado', 'cancelado') THEN 'recusado' ELSE 'aberto' END,
           COALESCE(NULLIF(modulo_sistema, ''), modulo_sistema_outro), prioridade, setor,
           CASE WHEN status = 'concluido' AND concluido_em IS NOT NULL THEN extract(epoch FROM concluido_em - created_at) / 86400 END,
           NULL::uuid, NULL::text
      FROM public."CHAMADO_SISTEMA" $q$,
    _de, _ate, '["Chamados por módulo", "Prioridade", "Setor"]'::jsonb, 'chamados', _contrato, _meses);

  WHEN 'orientacoes' THEN RETURN public.dir_rel_montar('Orientações Jurídicas', $q$
    SELECT created_at::date, COALESCE(titulo, left(pergunta, 80)), status,
           CASE WHEN status = 'Respondida' THEN 'concluido'
                WHEN status IN ('Reprovada', 'Recusada', 'Oculta', 'Cancelada') THEN 'recusado' ELSE 'aberto' END,
           categoria, origem, autor_nome,
           CASE WHEN respondido_em IS NOT NULL THEN extract(epoch FROM respondido_em - created_at) / 86400 END,
           NULL::uuid, NULL::text
      FROM public."JUR_DUVIDAS" $q$,
    _de, _ate, '["Orientações por categoria", "Origem", "Quem perguntou"]'::jsonb, 'orientações', _contrato, _meses);

  WHEN 'mudanca-funcao' THEN RETURN public.dir_rel_montar('Mudança de Função', $q$
    SELECT criado_em::date, COALESCE(colaborador_nome, 'colaborador') || ': ' || COALESCE(cargo_atual, '?') || ' → ' || COALESCE(cargo_novo, '?'), status,
           CASE WHEN status = 'Concluída' THEN 'concluido'
                WHEN status IN ('Reprovada', 'Cancelada') THEN 'recusado' ELSE 'aberto' END,
           COALESCE(NULLIF(setor, ''), filial), COALESCE(cargo_atual, '?') || ' → ' || COALESCE(cargo_novo, '?'),
           CASE WHEN e_escritorio THEN 'Escritório' ELSE 'Operação' END,
           CASE WHEN status = 'Concluída' THEN extract(epoch FROM atualizado_em - criado_em) / 86400 END,
           NULL::uuid, filial
      FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" $q$,
    _de, _ate, '["Por setor/filial", "De → para", "Escritório × operação"]'::jsonb, 'mudanças', _contrato, _meses);

  WHEN 'colaboradores' THEN RETURN public.dir_rel_colaboradores_dados(_de, _ate, _contrato, _meses);
  WHEN 'turnover' THEN RETURN public.dir_rel_turnover_dados(_de, _ate, _contrato, _meses);
  ELSE RAISE EXCEPTION 'Relatório desconhecido: %', _slug;
  END CASE;
END $function$;
REVOKE ALL ON FUNCTION public.dir_rel_dados(text, date, date, uuid, int[]) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar o CREATE OR REPLACE FUNCTION public.dir_rel_dados(...) da
-- 20261013000003 (ramo 'recrutamento' volta a: 'Concluído'/'Contratado' =
-- concluido, 'Reprovada'/'Cancelada' = recusado, o resto = aberto) e
-- NOTIFY pgrst, 'reload schema';
