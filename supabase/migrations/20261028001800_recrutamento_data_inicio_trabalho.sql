-- =========================================================================
-- Recrutamento › kanban › SST + COMPRAS — DATA EM QUE O COLABORADOR COMEÇA
-- A TRABALHAR (28/10/2026)
--
-- CHAMADO: "solicito incluir essa aba, para que o compras tenha ideia do
-- início no posto para liberar com mais agilidade o uniforme".
-- O que fazer (Pablo): ao enviar para Compras e SST, o Recrutamento informa
-- a DATA QUE O COLABORADOR VAI COMEÇAR A TRABALHAR, e ela aparece para o
-- Compras e para o SST.
--
-- Antes só existia a "data de início prevista" da VAGA
-- (SISTEMA_RECRUTAMENTO.data_inicio_prevista), que é do pedido do encarregado
-- e envelhece; a data real do candidato não ficava em lugar nenhum.
--
--   1. WA_CURRICULOS.data_inicio_trabalho (date) — gravada pelo Recrutamento
--      no envio para SST + Compras (obrigatória na tela).
--   2. VW_RECRUTAMENTO_CANDIDATOS ganha a coluna no FIM (CREATE OR REPLACE
--      VIEW só aceita coluna nova no fim) — é a view que as telas do SST
--      (ASO — Candidatos) e do Compras (EPIs — Admissões) leem. Corpo igual
--      ao da mig 20261015000011.
--   O pedido de materiais leva a data na observação do RH (feito no front,
--   pela rec_enxoval_gerar_pedido que já existe).
-- =========================================================================

ALTER TABLE public."WA_CURRICULOS" ADD COLUMN IF NOT EXISTS data_inicio_trabalho date;
COMMENT ON COLUMN public."WA_CURRICULOS".data_inicio_trabalho IS
  'Data em que o colaborador começa a trabalhar no posto — informada pelo Recrutamento ao enviar para SST + Compras (mig 20261028001800).';

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
    c.data_inicio_trabalho
   FROM ((public."WA_CURRICULOS" c
     JOIN public."SISTEMA_RECRUTAMENTO" s ON ((s.id = c.vaga_id)))
     LEFT JOIN public."RECRUTAMENTO_CPF_BLACKLIST" b ON ((b.cpf_digits = regexp_replace(COALESCE(c.cpf, c.cpf_cand, ''::text), '\D'::text, ''::text, 'g'::text))))
  WHERE (c.etapa_processo IS NOT NULL);

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- (recriar a view com o corpo da mig 20261015000011 — DROP VIEW + CREATE,
--  porque CREATE OR REPLACE não tira coluna)
-- ALTER TABLE public."WA_CURRICULOS" DROP COLUMN IF EXISTS data_inicio_trabalho;
