-- =========================================================================
-- RELATÓRIOS › VAGAS — DASHBOARD (07/10/2026)
--
-- PEDIDO (Pablo): "dentro de Relatórios, Vagas dashboard, um novo onde tenha
-- até dashboards POR VAGA solicitada, quanto tempo ficou em cada vaga etc,
-- deixa bem completo".
--
-- O QUE TEM
--   · Menu 'diretoria_rel_vagas' no módulo Relatórios (/app/relatorios/vagas).
--     Quem já vê o relatório Gestão Recrutamento ou o Relatório Geral também
--     vê o painel — não precisa liberar de novo (dir_vagas_exige).
--   · dir_vagas_painel(_de, _ate, _contrato, _meses): UMA linha por vaga —
--     as solicitadas no período + TODAS as que ainda estão em aberto (para o
--     "parado agora"), com o log de status (SISTEMA_RECRUTAMENTO_STATUS_LOG,
--     desde 19/08/2026), os marcos (aprovação, 1º candidato, selecionado,
--     enviado à admissão) e os candidatos por etapa. As contas (tempo por
--     etapa, funil, rankings, aging) ficam em src/lib/relatorios/vagasPainel.ts
--     (com teste).
--   · dir_vagas_detalhe(_id): a vaga, a trilha completa (RECRUTAMENTO_HISTORICO)
--     e os candidatos — sem CPF/telefone.
--
-- Vagas do sistema antigo (Discord, legado_chave) não têm log por etapa: só
-- entram no tempo total (criação → fechamento, status_changed_at).
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- ── 1) Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'diretoria_rel_vagas', 'Vagas — Dashboard', '/app/relatorios/vagas', 12, true
  FROM public.app_modulo m WHERE m.codigo = 'relatorios'
ON CONFLICT (modulo_id, codigo) DO UPDATE SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

-- ── 2) Acesso: o menu novo, o Gestão Recrutamento ou o Relatório Geral ──
CREATE OR REPLACE FUNCTION public.dir_vagas_exige()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT (public.has_screen_access(auth.uid(), 'diretoria_rel_vagas', 'visualizar'::public.app_acao)
          OR public.has_screen_access(auth.uid(), 'diretoria_rel_recrutamento', 'visualizar'::public.app_acao)
          OR public.has_screen_access(auth.uid(), 'diretoria_relatorio_geral', 'visualizar'::public.app_acao)) THEN
    RAISE EXCEPTION 'Sem acesso a este relatório' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.dir_vagas_exige() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dir_vagas_exige() TO authenticated;

-- ── 3) Painel ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.dir_vagas_painel(date, date, uuid, int[]);
CREATE FUNCTION public.dir_vagas_painel(
  _de date DEFAULT NULL, _ate date DEFAULT NULL, _contrato uuid DEFAULT NULL, _meses int[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ate date := COALESCE(_ate, current_date);
  v_de  date := COALESCE(_de, (date_trunc('month', COALESCE(_ate, current_date)) - interval '11 months')::date);
  v_nn  text := public.dir_rel_contrato_nn(_contrato);
  v_out jsonb;
BEGIN
  PERFORM public.dir_vagas_exige();

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
           'solicitante', v.solicitante_nome, 'analista', v.analista_nome, 'aprovado_por', v.aprovado_por_nome,
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
      -- aprovação: vale para o legado (sem log); o novo sai do log.
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
END $$;
REVOKE ALL ON FUNCTION public.dir_vagas_painel(date, date, uuid, int[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dir_vagas_painel(date, date, uuid, int[]) TO authenticated;

-- ── 4) Detalhe de uma vaga ───────────────────────────────────────────────
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
                   'usuario_email', NULL, 'detalhe', h.detalhe, 'candidato_nome', h.candidato_nome) ORDER BY h.created_at, h.id)
                     FROM public."RECRUTAMENTO_HISTORICO" h WHERE h.solicitacao_id = _id), '[]'::jsonb),
    'candidatos', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'id', c.id, 'nome', COALESCE(c.nome_informado, c.nome), 'criado', c.created_at,
                   'etapa', upper(COALESCE(NULLIF(trim(c.etapa_processo), ''), 'ENTRADA')), 'etapa_em', c.etapa_changed_at,
                   'origem', COALESCE(c.tipo_candidatura, c.origem), 'selecionado_em', c.selecionado_em,
                   'enviado_em', c.enviado_admissao_em, 'desistiu', COALESCE(c.desistiu, false),
                   'desistencia_motivo', c.desistencia_motivo, 'motivo_reprovacao', c.motivo_reprovacao) ORDER BY c.created_at)
                     FROM public."WA_CURRICULOS" c WHERE c.vaga_id = _id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.dir_vagas_detalhe(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dir_vagas_detalhe(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.dir_vagas_detalhe(bigint);
-- DROP FUNCTION IF EXISTS public.dir_vagas_painel(date, date, uuid, int[]);
-- DROP FUNCTION IF EXISTS public.dir_vagas_exige();
-- DELETE FROM public.app_menu WHERE codigo = 'diretoria_rel_vagas';
