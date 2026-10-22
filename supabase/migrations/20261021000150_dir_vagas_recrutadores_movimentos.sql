-- =========================================================================
-- RELATÓRIOS › VAGAS — DASHBOARD - RECRUTADORES (21/10/2026)
--
-- Pedido do Pablo: "um dashboard por recrutador, para ver quem está
-- trabalhando mais, com todas as informações e histórico".
--
-- De onde vem cada número:
--   · A VAGA de cada recrutador é a do responsável pela vaga
--     (SISTEMA_RECRUTAMENTO_RESPONSAVEL, migs 20261013000003 / 20261014000003
--     / 20261020000050) — já vem no dir_vagas_painel. Nenhuma regra nova.
--   · O TRABALHO (movimentações) vem do RECRUTAMENTO_HISTORICO: cada evento
--     com papel 'Recrutamento' é atribuído a QUEM o fez — o mesmo critério
--     que alimenta o responsável automático (trg_rec_responsavel_pelo_historico).
--     O front grava usuario_nome = user_metadata.nome, que pode não bater com o
--     nome do responsável (profiles.display_name, rec_nome_usuario); por isso
--     o nome sai do profile achado pelo e-mail, e só na falta dele do texto
--     gravado. Assim "Giovana" do histórico e "Giovana" da etiqueta são a
--     mesma linha no ranking.
--
-- Esta RPC devolve só as movimentações, agregadas por vaga × pessoa × dia ×
-- tipo (com os ids dos candidatos, para o front contar candidatos distintos).
-- Período, meses e contrato iguais aos do dir_vagas_painel, aplicados na DATA
-- DO MOVIMENTO. As contas ficam em src/lib/relatorios/recrutadoresPainel.ts
-- (com teste), que cruza com as vagas do painel (busca, desfecho, sistema
-- antigo… valem para os dois).
--
-- Tipos (exclusivos, na ordem em que são testados):
--   desistencia  "Candidato desistiu (em …)"
--   admissao     "Recrutamento finalizado — enviado para Admissão", "Candidato admitido…"
--   reprovacao   candidato movido para Reprovado
--   selecao      "Candidato selecionado", "Candidato inserido manualmente…"
--   movimento    qualquer outra troca de etapa do candidato (kanban)
--   candidato    outro registro do candidato (documento, roteiro, edição)
--   vaga         evento da vaga em si (troca de status, edição)
--
-- Acesso: o mesmo do painel (dir_vagas_exige → has_screen_access).
-- Idempotente.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.dir_vagas_recrutadores_mov(
  _de date DEFAULT NULL::date, _ate date DEFAULT NULL::date, _contrato uuid DEFAULT NULL::uuid, _meses integer[] DEFAULT NULL::integer[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ate date := COALESCE(_ate, current_date);
  v_de  date := COALESCE(_de, (date_trunc('month', COALESCE(_ate, current_date)) - interval '11 months')::date);
  v_nn  text := public.dir_rel_contrato_nn(_contrato);
BEGIN
  PERFORM public.dir_vagas_exige();
  RETURN jsonb_build_object(
    'de', v_de, 'ate', v_ate,
    'colunas', jsonb_build_array('vaga', 'usuario', 'dia', 'tipo', 'n', 'candidatos'),
    'linhas', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(x.vaga, x.usuario, x.dia, x.tipo, x.n, x.candidatos) ORDER BY x.dia, x.vaga)
        FROM (
          SELECT e.vaga, e.usuario, e.dia, e.tipo, count(*) AS n,
                 COALESCE(jsonb_agg(DISTINCT e.candidato_id) FILTER (WHERE e.candidato_id IS NOT NULL), '[]'::jsonb) AS candidatos
            FROM (
              SELECT h.solicitacao_id AS vaga, h.candidato_id,
                     (h.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
                     COALESCE(nullif(btrim(p.display_name), ''), p.email, nullif(btrim(h.usuario_nome), ''), h.usuario_email) AS usuario,
                     CASE
                       WHEN h.evento ILIKE 'Candidato desistiu%' THEN 'desistencia'
                       WHEN h.evento ILIKE 'Recrutamento finalizado%' OR h.evento ILIKE 'Candidato admitido%' THEN 'admissao'
                       WHEN h.candidato_id IS NOT NULL AND upper(btrim(h.para_status)) = 'REPROVADO' THEN 'reprovacao'
                       WHEN h.evento ILIKE 'Candidato selecionado%' OR h.evento ILIKE 'Candidato inserido%' THEN 'selecao'
                       WHEN h.candidato_id IS NOT NULL AND h.para_status IS NOT NULL THEN 'movimento'
                       WHEN h.candidato_id IS NOT NULL THEN 'candidato'
                       ELSE 'vaga'
                     END AS tipo
                FROM public."RECRUTAMENTO_HISTORICO" h
                JOIN public."SISTEMA_RECRUTAMENTO" s ON s.id = h.solicitacao_id
                -- LATERAL com LIMIT 1: e-mail repetido em profiles não duplica o movimento.
                LEFT JOIN LATERAL (
                  SELECT pp.display_name, pp.email FROM public.profiles pp
                   WHERE nullif(btrim(h.usuario_email), '') IS NOT NULL AND lower(pp.email) = lower(btrim(h.usuario_email))
                   ORDER BY pp.id LIMIT 1
                ) p ON true
               WHERE h.papel = 'Recrutamento'
                 AND (h.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_de AND v_ate
                 AND public.dir_rel_no_mes((h.created_at AT TIME ZONE 'America/Sao_Paulo')::date, _meses)
                 AND public.dir_rel_no_contrato(s.contrato_id, s.contrato, _contrato, v_nn)
            ) e
           WHERE e.usuario IS NOT NULL AND e.usuario <> 'Sistema'
           GROUP BY 1, 2, 3, 4
        ) x), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.dir_vagas_recrutadores_mov(date, date, uuid, integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dir_vagas_recrutadores_mov(date, date, uuid, integer[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.dir_vagas_recrutadores_mov(date, date, uuid, integer[]);
-- NOTIFY pgrst, 'reload schema';
