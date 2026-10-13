-- =========================================================================
-- RECRUTAMENTO: RESPONSÁVEL PELA VAGA (13/10/2026)
--
-- PEDIDO (Pablo): "etiqueta obrigatória puxando automático com opção manual
-- de RESPONSÁVEL PELA VAGA. Quem passar o status da vaga vai marcar
-- automaticamente como responsável, e isso vai ficar na etiqueta em cima da
-- vaga e no histórico também. Todo relatório que tiver vaga tem que ter o
-- responsável pela vaga."
--
-- ONDE MORA: tabela à parte, SISTEMA_RECRUTAMENTO_RESPONSAVEL (1 linha por
-- vaga) — mesmo motivo da SISTEMA_RECRUTAMENTO_ETAPA (mig 20261008000008):
-- coluna nova na vaga escrita por gatilho do candidato passaria pelo
-- sistema_recrutamento_guard (quem não é gestor só muda a data de início →
-- SST/Compras travariam) e o rec_historico_automatico logaria "Solicitação
-- editada" a cada movimento.
--
-- AUTOMÁTICO: todo evento de ANDAMENTO no RECRUTAMENTO_HISTORICO com papel
-- 'Recrutamento' (mover candidato no kanban, abrir a vaga, status da vaga
-- atualizado, concluir...) feito por um usuário logado marca esse usuário
-- como responsável. Edição de campo, Operacional/Analista/Diretoria
-- aprovando, Jurídico, SST e Compras NÃO marcam — não conduzem a vaga.
-- MANUAL: rec_responsavel_definir(vaga, usuário) fixa a pessoa; enquanto
-- estiver fixada, o automático não troca. Passar NULL devolve ao automático.
-- Toda troca (automática ou manual) vira evento no histórico da vaga.
--
-- O gatilho nunca trava o kanban: erro aqui vira WARNING e o movimento segue.
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- ── 1) Tabela ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" (
  vaga_id          bigint PRIMARY KEY REFERENCES public."SISTEMA_RECRUTAMENTO"(id) ON DELETE CASCADE,
  responsavel_id   uuid,
  responsavel_nome text NOT NULL,
  origem           text NOT NULL DEFAULT 'automatico' CHECK (origem IN ('automatico', 'manual')),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_por   uuid
);
ALTER TABLE public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" TO authenticated;
-- Quem vê a vaga vê o responsável (igual à etapa). Escrita só pelas funções.
DROP POLICY IF EXISTS sistema_recrutamento_responsavel_select ON public."SISTEMA_RECRUTAMENTO_RESPONSAVEL";
CREATE POLICY sistema_recrutamento_responsavel_select ON public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."SISTEMA_RECRUTAMENTO" r WHERE r.id = vaga_id));

-- Nome de exibição de um usuário (o nome oficial já vem do vínculo com EMPREGADOS).
CREATE OR REPLACE FUNCTION public.rec_nome_usuario(p_uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(nullif(btrim(p.display_name), ''), p.email, 'Usuário') FROM public.profiles p WHERE p.id = p_uid
$$;
REVOKE ALL ON FUNCTION public.rec_nome_usuario(uuid) FROM PUBLIC, anon, authenticated;

-- ── 2) Automático: evento de andamento do Recrutamento ───────────────────
CREATE OR REPLACE FUNCTION public.rec_responsavel_pelo_historico()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_nome  text;
  v_atual public."SISTEMA_RECRUTAMENTO_RESPONSAVEL"%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NEW.solicitacao_id IS NULL OR NEW.papel IS DISTINCT FROM 'Recrutamento'
     OR (NEW.de_status IS NULL AND NEW.para_status IS NULL AND NEW.candidato_id IS NULL) THEN
    RETURN NULL;
  END IF;
  BEGIN
    SELECT * INTO v_atual FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" WHERE vaga_id = NEW.solicitacao_id FOR UPDATE;
    IF v_atual.vaga_id IS NOT NULL AND (v_atual.origem = 'manual' OR v_atual.responsavel_id = v_uid) THEN
      RETURN NULL;   -- fixado à mão, ou já é a mesma pessoa
    END IF;
    v_nome := public.rec_nome_usuario(v_uid);
    INSERT INTO public."SISTEMA_RECRUTAMENTO_RESPONSAVEL"(vaga_id, responsavel_id, responsavel_nome, origem, atualizado_em, atualizado_por)
    VALUES (NEW.solicitacao_id, v_uid, v_nome, 'automatico', now(), v_uid)
    ON CONFLICT (vaga_id) DO UPDATE
       SET responsavel_id = EXCLUDED.responsavel_id, responsavel_nome = EXCLUDED.responsavel_nome,
           origem = 'automatico', atualizado_em = now(), atualizado_por = v_uid;
    -- Sem de/para/candidato: este evento não dispara o próprio gatilho de novo.
    INSERT INTO public."RECRUTAMENTO_HISTORICO"(solicitacao_id, evento, papel, usuario_nome, usuario_email, detalhe)
    VALUES (NEW.solicitacao_id, 'Responsável pela vaga: ' || v_nome || ' (automático)', 'Recrutamento',
            NEW.usuario_nome, NEW.usuario_email,
            CASE WHEN v_atual.responsavel_nome IS NOT NULL
                 THEN 'Antes: ' || v_atual.responsavel_nome || ' · motivo: ' || NEW.evento
                 ELSE 'Motivo: ' || NEW.evento END);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rec_responsavel_pelo_historico: %', SQLERRM;
  END;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.rec_responsavel_pelo_historico() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rec_responsavel_pelo_historico ON public."RECRUTAMENTO_HISTORICO";
CREATE TRIGGER trg_rec_responsavel_pelo_historico
  AFTER INSERT ON public."RECRUTAMENTO_HISTORICO"
  FOR EACH ROW EXECUTE FUNCTION public.rec_responsavel_pelo_historico();

-- ── 3) Manual ────────────────────────────────────────────────────────────
-- Quem conduz o Recrutamento (alterar na Gestão Recrutamento) escolhe entre
-- as pessoas que também conduzem. p_usuario NULL = volta ao automático
-- (mantém a pessoa atual até o próximo movimento).
CREATE OR REPLACE FUNCTION public.rec_responsavel_definir(p_vaga bigint, p_usuario uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_eu    text;
  v_email text;
  v_nome  text;
  v_antes text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_screen_access(v_uid, 'recrutamento_gestao', 'alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Só quem conduz o Recrutamento define o responsável pela vaga.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."SISTEMA_RECRUTAMENTO" WHERE id = p_vaga) THEN
    RAISE EXCEPTION 'Vaga #% não encontrada.', p_vaga;
  END IF;
  SELECT responsavel_nome INTO v_antes FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" WHERE vaga_id = p_vaga;
  v_eu := public.rec_nome_usuario(v_uid);
  SELECT email INTO v_email FROM public.profiles WHERE id = v_uid;

  IF p_usuario IS NULL THEN
    UPDATE public."SISTEMA_RECRUTAMENTO_RESPONSAVEL"
       SET origem = 'automatico', atualizado_em = now(), atualizado_por = v_uid
     WHERE vaga_id = p_vaga;
    INSERT INTO public."RECRUTAMENTO_HISTORICO"(solicitacao_id, evento, papel, usuario_nome, usuario_email, detalhe)
    VALUES (p_vaga, 'Responsável pela vaga volta a ser automático', 'Recrutamento', v_eu, v_email,
            'Fica ' || coalesce(v_antes, 'sem responsável') || ' até o próximo movimento da vaga.');
  ELSE
    IF NOT public.has_screen_access(p_usuario, 'recrutamento_gestao', 'alterar'::public.app_acao) THEN
      RAISE EXCEPTION 'Essa pessoa não conduz o Recrutamento (sem "alterar" na Gestão Recrutamento).' USING ERRCODE = '22023';
    END IF;
    v_nome := public.rec_nome_usuario(p_usuario);
    INSERT INTO public."SISTEMA_RECRUTAMENTO_RESPONSAVEL"(vaga_id, responsavel_id, responsavel_nome, origem, atualizado_em, atualizado_por)
    VALUES (p_vaga, p_usuario, v_nome, 'manual', now(), v_uid)
    ON CONFLICT (vaga_id) DO UPDATE
       SET responsavel_id = EXCLUDED.responsavel_id, responsavel_nome = EXCLUDED.responsavel_nome,
           origem = 'manual', atualizado_em = now(), atualizado_por = v_uid;
    INSERT INTO public."RECRUTAMENTO_HISTORICO"(solicitacao_id, evento, papel, usuario_nome, usuario_email, detalhe)
    VALUES (p_vaga, 'Responsável pela vaga: ' || v_nome || ' (definido manualmente)', 'Recrutamento', v_eu, v_email,
            CASE WHEN v_antes IS NOT NULL THEN 'Antes: ' || v_antes END);
  END IF;

  RETURN (SELECT to_jsonb(r) FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" r WHERE r.vaga_id = p_vaga);
END $fn$;
REVOKE ALL ON FUNCTION public.rec_responsavel_definir(bigint, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_responsavel_definir(bigint, uuid) TO authenticated;

-- Quem pode ser escolhido: quem conduz o Recrutamento.
CREATE OR REPLACE FUNCTION public.rec_responsaveis_possiveis()
RETURNS TABLE(id uuid, nome text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso à Gestão Recrutamento.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, coalesce(nullif(btrim(p.display_name), ''), p.email)::text
      FROM public.profiles p
     WHERE public.has_screen_access(p.id, 'recrutamento_gestao', 'alterar'::public.app_acao)
     ORDER BY 2;
END $fn$;
REVOKE ALL ON FUNCTION public.rec_responsaveis_possiveis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_responsaveis_possiveis() TO authenticated;

-- ── 4) Carga: quem moveu por último cada vaga até hoje ───────────────────
INSERT INTO public."SISTEMA_RECRUTAMENTO_RESPONSAVEL"(vaga_id, responsavel_id, responsavel_nome, origem, atualizado_em)
SELECT DISTINCT ON (h.solicitacao_id)
       h.solicitacao_id, p.id, coalesce(nullif(btrim(p.display_name), ''), p.email), 'automatico', h.created_at
  FROM public."RECRUTAMENTO_HISTORICO" h
  JOIN public.profiles p ON lower(p.email) = lower(h.usuario_email)
  JOIN public."SISTEMA_RECRUTAMENTO" s ON s.id = h.solicitacao_id
 WHERE h.papel = 'Recrutamento'
   AND (h.de_status IS NOT NULL OR h.para_status IS NOT NULL OR h.candidato_id IS NOT NULL)
 ORDER BY h.solicitacao_id, h.created_at DESC, h.id DESC
ON CONFLICT (vaga_id) DO NOTHING;

-- ── 5) Relatórios: o responsável em toda saída que lista vaga ────────────
-- Relatório da Diretoria (dir_rel_dados): a linha da vaga leva "Resp.: <nome>".
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
           CASE WHEN status IN ('Concluído', 'Contratado') THEN 'concluido'
                WHEN status IN ('Reprovada', 'Cancelada') THEN 'recusado' ELSE 'aberto' END,
           contrato, cargo, motivo_vaga,
           CASE WHEN status IN ('Concluído', 'Contratado') AND status_changed_at IS NOT NULL
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

CREATE OR REPLACE FUNCTION public.dir_vagas_painel_dados(_de date DEFAULT NULL::date, _ate date DEFAULT NULL::date, _contrato uuid DEFAULT NULL::uuid, _meses integer[] DEFAULT NULL::integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ate date := COALESCE(_ate, current_date);
  v_de  date := COALESCE(_de, (date_trunc('month', COALESCE(_ate, current_date)) - interval '11 months')::date);
  v_nn  text := public.dir_rel_contrato_nn(_contrato);
  v_out jsonb;
BEGIN

  WITH v AS (
    SELECT s.*,
           (s.created_at::date BETWEEN v_de AND v_ate AND public.dir_rel_no_mes(s.created_at::date, _meses)) AS no_periodo,
           (s.status NOT IN ('Contratado', 'Reprovada', 'Cancelada') AND s.status NOT LIKE 'Concluído%') AS aberta
      FROM public."SISTEMA_RECRUTAMENTO" s
     WHERE public.dir_rel_no_contrato(s.contrato_id, s.contrato, _contrato, v_nn)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', v.id, 'criada', v.created_at, 'status', v.status, 'status_em', v.status_changed_at,
           'cargo', v.cargo, 'cidade', v.cidade, 'uf', v.estado, 'contrato', v.contrato, 'setor', v.setor,
           'motivo', v.motivo_vaga, 'urgencia', v.grau_urgencia, 'qtd', COALESCE(v.quantidade_vagas, 1),
           'solicitante', v.solicitante_nome, 'analista', v.analista_nome,
           'responsavel', (SELECT rr.responsavel_nome FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" rr WHERE rr.vaga_id = v.id), 'responsavel_origem', (SELECT rr.origem FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" rr WHERE rr.vaga_id = v.id), 'aprovado_por', v.aprovado_por_nome,
           'contratado', v.contratado_nome, 'inicio_previsto', v.data_inicio_prevista, 'substituido', v.nome_substituido,
           'motivo_reprovacao', v.motivo_reprovacao,
           'legado', v.legado_chave IS NOT NULL, 'administrativa', COALESCE(v.administrativa, false),
           'reserva', COALESCE(v.reserva_tecnica, false), 'encarregado', COALESCE(v.vaga_encarregado, false),
           'no_periodo', v.no_periodo, 'aberta', v.aberta,
           'log', COALESCE(lg.log, '[]'::jsonb),
           'aprovada_em', h.aprovada_em,
           'cand', jsonb_build_object(
              'total', COALESCE(c.total, 0), 'desistiu', COALESCE(c.desistiu, 0),
              'etapas', COALESCE(c.etapas, '{}'::jsonb),
              'primeiro_em', c.primeiro_em, 'selecionado_em', c.selecionado_em, 'enviado_em', c.enviado_em)
         ) ORDER BY v.id DESC), '[]'::jsonb)
    INTO v_out
    FROM v
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_array(l.status_anterior, l.status_novo, l.changed_at) ORDER BY l.changed_at, l.id) AS log
        FROM public."SISTEMA_RECRUTAMENTO_STATUS_LOG" l WHERE l.solicitacao_id = v.id
    ) lg ON true
    LEFT JOIN LATERAL (
      SELECT min(hh.created_at) AS aprovada_em
        FROM public."RECRUTAMENTO_HISTORICO" hh
       WHERE hh.solicitacao_id = v.id
         AND hh.evento IN ('Operação aprovou', 'Aprovada pelo Operacional', 'Aprovada pelo Analista', 'Abertura de vaga confirmada')
    ) h ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS total,
             count(*) FILTER (WHERE cc.desistiu) AS desistiu,
             min(cc.created_at) AS primeiro_em,
             min(cc.selecionado_em) AS selecionado_em,
             min(cc.enviado_admissao_em) AS enviado_em,
             (SELECT jsonb_object_agg(e.etapa, e.n) FROM (
                SELECT upper(COALESCE(NULLIF(trim(c2.etapa_processo), ''), 'ENTRADA')) AS etapa, count(*) AS n
                  FROM public."WA_CURRICULOS" c2 WHERE c2.vaga_id = v.id GROUP BY 1) e) AS etapas
        FROM public."WA_CURRICULOS" cc WHERE cc.vaga_id = v.id
    ) c ON true
   WHERE v.no_periodo OR v.aberta;

  RETURN jsonb_build_object(
    'de', v_de, 'ate', v_ate, 'agora', now(),
    'log_desde', (SELECT min(changed_at) FROM public."SISTEMA_RECRUTAMENTO_STATUS_LOG"),
    'vagas', v_out);
END $function$;

CREATE OR REPLACE FUNCTION public.dir_vagas_detalhe(_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.dir_vagas_exige();
  RETURN jsonb_build_object(
    'vaga', (SELECT jsonb_build_object(
               'id', s.id, 'criada', s.created_at, 'status', s.status, 'status_em', s.status_changed_at,
               'cargo', s.cargo, 'cidade', s.cidade, 'uf', s.estado, 'contrato', s.contrato, 'setor', s.setor,
               'motivo', s.motivo_vaga, 'urgencia', s.grau_urgencia, 'qtd', COALESCE(s.quantidade_vagas, 1),
               'escala', s.escala, 'horario', s.horario, 'salario', s.salario, 'local', s.local_exato,
               'inicio_previsto', s.data_inicio_prevista, 'substituido', s.nome_substituido,
               'solicitante', s.solicitante_nome, 'analista', s.analista_nome,
               'responsavel', (SELECT rr.responsavel_nome FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" rr WHERE rr.vaga_id = s.id), 'responsavel_origem', (SELECT rr.origem FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" rr WHERE rr.vaga_id = s.id), 'aprovado_por', s.aprovado_por_nome,
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
END $function$;

CREATE OR REPLACE FUNCTION public.recrut_dashboard_dados()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_adm boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.has_screen_access(v_uid, 'recrutamento_dashboard', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Dashboard Recrutamento. Peça em Administração › Acesso por Usuário.'
      USING ERRCODE = '42501';
  END IF;
  v_adm := public.has_screen_access(v_uid, 'recrutamento_vaga_administrativa', 'visualizar'::public.app_acao)
        OR public.has_screen_access(v_uid, 'diretoria_recrutamento', 'visualizar'::public.app_acao);

  RETURN jsonb_build_object(
    'gerado_em', public.recrut_dash_ts(now()),
    'vagas_colunas', jsonb_build_array('id', 'criada', 'status', 'mudou', 'cargo', 'contrato', 'cidade', 'qtd',
                                       'motivo', 'urgencia', 'prevista', 'escala', 'horario', 'local', 'solicitante',
                                       'administrativa', 'contratado', 'contratado_inicio', 'substituido', 'legado',
                                       'aprovada_em', 'aberta_em', 'responsavel'),
    'vagas', coalesce((
      SELECT jsonb_agg(jsonb_build_array(
               r.id, public.recrut_dash_ts(r.created_at), r.status, public.recrut_dash_ts(r.status_changed_at),
               r.cargo, r.contrato, r.cidade, coalesce(r.quantidade_vagas, 1),
               r.motivo_vaga, r.grau_urgencia, left(r.data_inicio_prevista, 40), left(r.escala, 40), left(r.horario, 60),
               left(r.local_exato, 90), r.solicitante_nome, coalesce(r.administrativa, false),
               nullif(btrim(coalesce(nullif(btrim(r.contratado_nome), ''), r.funcionario_selecionado, '')), ''),
               left(r.contratado_data_inicio, 20), r.nome_substituido, r.legado_chave IS NOT NULL,
               public.recrut_dash_ts(m.aprovada_em), public.recrut_dash_ts(m.aberta_em),
               (SELECT rr.responsavel_nome FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" rr WHERE rr.vaga_id = r.id))
             ORDER BY r.id)
        FROM public."SISTEMA_RECRUTAMENTO" r
        LEFT JOIN LATERAL (
          SELECT min(h.created_at) FILTER (WHERE h.evento IN ('Operação aprovou', 'Aprovada pelo Analista',
                                                             'Aprovada pelo Operacional', 'Aprovada pela Diretoria')) AS aprovada_em,
                 min(h.created_at) FILTER (WHERE h.evento = 'Abertura de vaga confirmada') AS aberta_em
            FROM public."RECRUTAMENTO_HISTORICO" h
           WHERE h.solicitacao_id = r.id
        ) m ON true
       WHERE NOT coalesce(r.administrativa, false) OR v_adm), '[]'::jsonb),
    'candidatos_colunas', jsonb_build_array('id', 'vaga_id', 'criado', 'etapa', 'etapa_em', 'nome', 'tipo', 'desistiu', 'admitido_em'),
    'candidatos', coalesce((
      SELECT jsonb_agg(jsonb_build_array(
               c.id, c.vaga_id, public.recrut_dash_ts(c.created_at), c.etapa_processo,
               public.recrut_dash_ts(c.etapa_changed_at), c.nome, c.tipo_candidatura,
               coalesce(c.desistiu, false), public.recrut_dash_ts(coalesce(c.admitido_em, c.enviado_admissao_em))))
        FROM public."WA_CURRICULOS" c
       WHERE c.vaga_id IS NULL
          OR EXISTS (SELECT 1 FROM public."SISTEMA_RECRUTAMENTO" r
                      WHERE r.id = c.vaga_id AND (NOT coalesce(r.administrativa, false) OR v_adm))), '[]'::jsonb),
    'tempos', coalesce((
      SELECT jsonb_agg(jsonb_build_object('etapa', t.etapa, 'n', t.n, 'media', t.media, 'mediana', t.mediana) ORDER BY t.n DESC)
        FROM (SELECT l.status_anterior AS etapa, count(*) AS n,
                     round(avg(l.dias_no_anterior)::numeric, 1) AS media,
                     round((percentile_cont(0.5) WITHIN GROUP (ORDER BY l.dias_no_anterior))::numeric, 1) AS mediana
                FROM public."SISTEMA_RECRUTAMENTO_STATUS_LOG" l
               WHERE l.status_anterior IS NOT NULL AND l.dias_no_anterior IS NOT NULL
               GROUP BY l.status_anterior) t), '[]'::jsonb)
  );
END $function$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_rec_responsavel_pelo_historico ON public."RECRUTAMENTO_HISTORICO";
-- DROP FUNCTION IF EXISTS public.rec_responsavel_pelo_historico();
-- DROP FUNCTION IF EXISTS public.rec_responsavel_definir(bigint, uuid);
-- DROP FUNCTION IF EXISTS public.rec_responsaveis_possiveis();
-- DROP FUNCTION IF EXISTS public.rec_nome_usuario(uuid);
-- DROP TABLE IF EXISTS public."SISTEMA_RECRUTAMENTO_RESPONSAVEL";
-- (dir_rel_dados, dir_vagas_painel_dados, dir_vagas_detalhe e recrut_dashboard_dados:
--  reaplicar a versão anterior — sem o responsável)
