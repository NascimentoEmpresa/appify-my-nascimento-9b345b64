-- =========================================================================
-- RECRUTAMENTO — "Concluído" e "Contratado" viram um status só: CONTRATADO
-- (26/10/2026)
--
-- PEDIDO (Pablo, com print do filtro Status da Gestão Recrutamento:
-- "Contratado 82" e "Concluído 732"): "tem contratado e concluído que é A
-- MESMA COISA, funde esse status e deixa só CONTRATADO".
--
-- De onde vinha o "Concluído": nenhum código atual grava esse status. São
-- as vagas do sistema antigo (bot do Discord, importadas em 23/09/2026 com
-- "Concluído"; o gerador em migracao-sistema-antigo/ passa a usar
-- "Contratado") e sobras do fluxo de julho ("Concluído - …", "Concluída").
-- Todo relatório, TV e tela já contava os dois juntos como contratação
-- (status IN ('Concluído','Contratado') / startsWith("Concluído")), então os
-- números não mudam — só some a linha duplicada do filtro.
--
-- SEM GATILHOS (session_replication_role = replica, só nesta transação):
-- com eles, cada uma das ~730 vagas antigas geraria aviso no sino, uma linha
-- "Concluído → Contratado" no histórico e um status_changed_at de HOJE — que
-- é a data de conclusão usada nos prazos e no "contratadas no período".
--
-- O status antigo de cada vaga fica em "REC_STATUS_CONCLUIDO_BKP" (para o
-- ROLLBACK). O histórico (RECRUTAMENTO_HISTORICO) não é reescrito: a tela
-- mostra "Concluído" antigo como "Contratado" (rotuloStatusVaga).
-- =========================================================================

SET LOCAL session_replication_role = replica;

CREATE TABLE IF NOT EXISTS public."REC_STATUS_CONCLUIDO_BKP" (
  vaga_id     bigint PRIMARY KEY,
  status_antigo text NOT NULL,
  migrado_em  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."REC_STATUS_CONCLUIDO_BKP" ENABLE ROW LEVEL SECURITY;  -- sem policy: só o banco lê

INSERT INTO public."REC_STATUS_CONCLUIDO_BKP" (vaga_id, status_antigo)
SELECT s.id, s.status
  FROM public."SISTEMA_RECRUTAMENTO" s
 WHERE s.status = 'Concluída' OR s.status LIKE 'Concluído%'
ON CONFLICT (vaga_id) DO NOTHING;

UPDATE public."SISTEMA_RECRUTAMENTO"
   SET status = 'Contratado'
 WHERE status = 'Concluída' OR status LIKE 'Concluído%';

SET LOCAL session_replication_role = origin;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- SET LOCAL session_replication_role = replica;
-- UPDATE public."SISTEMA_RECRUTAMENTO" s SET status = b.status_antigo
--   FROM public."REC_STATUS_CONCLUIDO_BKP" b WHERE b.vaga_id = s.id AND s.status = 'Contratado';
