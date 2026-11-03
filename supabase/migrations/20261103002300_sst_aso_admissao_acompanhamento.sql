-- =========================================================================
-- SST › ASO Admissão — ACOMPANHAMENTO DO AGENDAMENTO (03/11/2026)
--
-- Pedido do Pablo: o SST acompanha os exames admissionais numa planilha à
-- parte; a tela /app/sst/aso (src/pages/sst/AsoCandidatos.tsx) passa a ter o
-- que a planilha tinha, sem sistema paralelo — tudo em WA_CURRICULOS, que é
-- onde o SST já grava visto e agendamento:
--
--   1. Exame cancelado → "Ciente": sst_cancelamento_ciente_em/por. O
--      cancelamento em si não é coluna: é o candidato ir para 'Reprovado'
--      (desistência, reprovação, admissão cancelada) com exame já pedido ou
--      agendado — régua em src/lib/sst/asoAdmissao.ts.
--   2. sst_solicitado_clinica_em — data em que o exame foi pedido à clínica.
--   3. sst_tentativa1_em / sst_tentativa2_em — 1ª e 2ª tentativas de agendar.
--   4. sst_obs_solicitante — observações do solicitante. Coluna NOVA: a
--      sst_obs já vai no texto que o Recrutamento manda ao candidato
--      (textoAgendamentoAso) e não pode virar anotação interna.
--   5. ASO realizado/recebido: sst_aso_realizado_em/por. Marcado, o
--      candidato sai dos pendentes de acompanhamento.
--
-- Sem RLS nova: a tela grava direto em WA_CURRICULOS como já faz no visto e
-- no agendamento (policy wa_curriculos_gate).
--
-- VW_RECRUTAMENTO_CANDIDATOS ganha as colunas no FIM (CREATE OR REPLACE VIEW
-- só aceita coluna nova no fim). Corpo igual ao da mig 20261028002050.
--
-- Carga inicial (para o filtro "Pendentes" não nascer com o histórico todo,
-- já que "Agendado" agora é pendente até o ASO):
--   - ASO realizado para quem já foi admitido ou tem exame de mais de 7 dias;
--   - Ciente para cancelamento anterior a 27/10/2026.
--   Ambos com "por" = 'Sistema (antes do acompanhamento)', para distinguir.
-- =========================================================================

ALTER TABLE public."WA_CURRICULOS"
  ADD COLUMN IF NOT EXISTS sst_solicitado_clinica_em date,
  ADD COLUMN IF NOT EXISTS sst_tentativa1_em date,
  ADD COLUMN IF NOT EXISTS sst_tentativa2_em date,
  ADD COLUMN IF NOT EXISTS sst_obs_solicitante text,
  ADD COLUMN IF NOT EXISTS sst_aso_realizado_em timestamptz,
  ADD COLUMN IF NOT EXISTS sst_aso_realizado_por text,
  ADD COLUMN IF NOT EXISTS sst_cancelamento_ciente_em timestamptz,
  ADD COLUMN IF NOT EXISTS sst_cancelamento_ciente_por text;

COMMENT ON COLUMN public."WA_CURRICULOS".sst_solicitado_clinica_em IS 'SST: data em que o exame admissional foi pedido à clínica (mig 20261103002300).';
COMMENT ON COLUMN public."WA_CURRICULOS".sst_tentativa1_em IS 'SST: 1ª tentativa de agendamento do exame admissional (mig 20261103002300).';
COMMENT ON COLUMN public."WA_CURRICULOS".sst_tentativa2_em IS 'SST: 2ª tentativa de agendamento do exame admissional (mig 20261103002300).';
COMMENT ON COLUMN public."WA_CURRICULOS".sst_obs_solicitante IS 'SST: observações do solicitante sobre o agendamento — interna, não vai ao candidato (mig 20261103002300).';
COMMENT ON COLUMN public."WA_CURRICULOS".sst_aso_realizado_em IS 'SST: ASO admissional realizado/recebido — sai dos pendentes (mig 20261103002300).';
COMMENT ON COLUMN public."WA_CURRICULOS".sst_cancelamento_ciente_em IS 'SST: quando o SST confirmou que viu o cancelamento do exame (mig 20261103002300).';

-- Carga inicial — ver cabeçalho.
UPDATE public."WA_CURRICULOS"
   SET sst_aso_realizado_em = now(), sst_aso_realizado_por = 'Sistema (antes do acompanhamento)'
 WHERE sst_aso_realizado_em IS NULL
   AND sst_ok IS TRUE
   AND etapa_processo IS DISTINCT FROM 'Reprovado'
   AND (admitido_em IS NOT NULL OR sst_data_exame < current_date - 7);

UPDATE public."WA_CURRICULOS"
   SET sst_cancelamento_ciente_em = now(), sst_cancelamento_ciente_por = 'Sistema (antes do acompanhamento)'
 WHERE sst_cancelamento_ciente_em IS NULL
   AND etapa_processo = 'Reprovado'
   AND sst_ok IS DISTINCT FROM false
   AND (sst_agendado_em IS NOT NULL OR sst_data_exame IS NOT NULL)
   AND coalesce(etapa_changed_at, '-infinity'::timestamptz) < timestamptz '2026-10-27 00:00:00-03';

CREATE OR REPLACE VIEW public."VW_RECRUTAMENTO_CANDIDATOS" WITH (security_invoker = true) AS
 SELECT c.id AS candidato_id,
    c.vaga_id, c.nome, c.telefone, c.email,
    COALESCE(c.cpf, c.cpf_cand) AS cpf,
    c.origem, c.storage_path, c.mensagem, c.etapa_processo, c.etapa_changed_at,
    c.selecionado_por, c.selecionado_em,
    c.juridico_ok, c.juridico_obs, c.juridico_por, c.juridico_em,
    c.sst_ok, c.sst_obs, c.sst_por, c.sst_em, c.sst_data_exame, c.sst_hora_exame, c.sst_local_exame,
    c.sst_agendado_por, c.sst_agendado_em,
    c.compras_necessidades, c.compras_por, c.compras_em, c.compras_obs, c.compras_data_chegada,
    c.epis_informados, c.epis_informados_em,
    c.enviado_admissao_por, c.enviado_admissao_em, c.admitido_por, c.admitido_em,
    c.empregado_id, c.motivo_reprovacao,
    c.experiencia_1, c.experiencia_2, c.experiencia_3,
    c.favorito, c.tipo_candidatura,
    c.created_at AS candidatura_em,
    s.cargo, s.contrato, s.cidade, s.status AS vaga_status, s.motivo_vaga, s.nome_substituido,
    s.escala, s.horario, s.salario, s.beneficios, s.insalubridade_recebe, s.insalubridade_quanto,
    s.local_exato, s.data_inicio_prevista, s.quantidade_vagas,
    s.req_obrigatorios, s.req_desejaveis, s.exp_minima, s.exp_minima_qual, s.grau_urgencia,
    s.solicitante_nome,
    (b.cpf_digits IS NOT NULL) AS possui_restricao,
    b.motivo AS restricao_motivo,
    c.compras_ok,
    c.desistiu, c.desistencia_motivo, c.desistencia_etapa, c.desistencia_em, c.desistencia_por,
    s.contrato_id, s.posto_id, s.funcao_id,
    c.juridico_nivel, c.juridico_pulado,
    c.cracha_foto_path,
    c.sst_visto_em, c.sst_visto_por, c.compras_visto_em, c.compras_visto_por,
    c.urgente_sst, c.urgente_compras, c.urgente_em, c.urgente_por, c.urgente_motivo,
    c.sst_maps_url,
    -- 15/10/2026
    c.compras_obs_rh, c.compras_dispensado, c.compras_dispensa_motivo,
    -- 28/10/2026
    c.data_inicio_trabalho,
    -- 03/11/2026
    c.sst_solicitado_clinica_em, c.sst_tentativa1_em, c.sst_tentativa2_em, c.sst_obs_solicitante,
    c.sst_aso_realizado_em, c.sst_aso_realizado_por,
    c.sst_cancelamento_ciente_em, c.sst_cancelamento_ciente_por
   FROM ((public."WA_CURRICULOS" c
     JOIN public."SISTEMA_RECRUTAMENTO" s ON ((s.id = c.vaga_id)))
     LEFT JOIN public."RECRUTAMENTO_CPF_BLACKLIST" b ON ((b.cpf_digits = regexp_replace(COALESCE(c.cpf, c.cpf_cand, ''::text), '\D'::text, ''::text, 'g'::text))))
  WHERE (c.etapa_processo IS NOT NULL);

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- (recriar a view com o corpo da mig 20261028002050 — DROP VIEW + CREATE,
--  porque CREATE OR REPLACE não tira coluna)
-- ALTER TABLE public."WA_CURRICULOS"
--   DROP COLUMN IF EXISTS sst_solicitado_clinica_em, DROP COLUMN IF EXISTS sst_tentativa1_em,
--   DROP COLUMN IF EXISTS sst_tentativa2_em, DROP COLUMN IF EXISTS sst_obs_solicitante,
--   DROP COLUMN IF EXISTS sst_aso_realizado_em, DROP COLUMN IF EXISTS sst_aso_realizado_por,
--   DROP COLUMN IF EXISTS sst_cancelamento_ciente_em, DROP COLUMN IF EXISTS sst_cancelamento_ciente_por;
