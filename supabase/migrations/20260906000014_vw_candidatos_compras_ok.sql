-- =========================================================================
-- VW_RECRUTAMENTO_CANDIDATOS — expor compras_ok e a desistencia
--
-- A tela de Suprimentos (EPIs — Admissoes) precisa saber se o Compras ja
-- aprovou, e as telas de setor precisam distinguir quem desistiu de quem foi
-- reprovado. Colunas criadas em 20260906000012/13, fora da view — que lista
-- coluna a coluna.
--
-- ⚠ ARMADILHA: a primeira versao desta migration fez
--     CREATE OR REPLACE VIEW v AS SELECT v.*, ... FROM v JOIN ...
--   achando que "v.*" seria resolvido contra a versao ANTIGA. Nao e: o
--   Postgres aceita a criacao e a view passa a referenciar a si mesma —
--   "infinite recursion detected in rules". Como as telas do SST e do
--   Juridico leem daqui, elas quebraram na hora. Nunca reescrever uma view
--   a partir dela mesma; e preciso repetir a lista inteira, como abaixo.
--
-- Idempotente.
-- ROLLBACK: recriar sem as 6 colunas finais.
-- =========================================================================

CREATE OR REPLACE VIEW public."VW_RECRUTAMENTO_CANDIDATOS" AS
  SELECT
    c.id AS candidato_id, c.vaga_id, c.nome, c.telefone, c.email,
    COALESCE(c.cpf, c.cpf_cand) AS cpf, c.origem, c.storage_path, c.mensagem,
    c.etapa_processo, c.etapa_changed_at, c.selecionado_por, c.selecionado_em,
    c.juridico_ok, c.juridico_obs, c.juridico_por, c.juridico_em,
    c.sst_ok, c.sst_obs, c.sst_por, c.sst_em,
    c.sst_data_exame, c.sst_hora_exame, c.sst_local_exame, c.sst_agendado_por, c.sst_agendado_em,
    c.compras_necessidades, c.compras_por, c.compras_em, c.compras_obs, c.compras_data_chegada,
    c.epis_informados, c.epis_informados_em,
    c.enviado_admissao_por, c.enviado_admissao_em,
    c.admitido_por, c.admitido_em, c.empregado_id, c.motivo_reprovacao,
    c.experiencia_1, c.experiencia_2, c.experiencia_3, c.favorito, c.tipo_candidatura,
    c.created_at AS candidatura_em,
    s.cargo, s.contrato, s.cidade, s.status AS vaga_status,
    s.motivo_vaga, s.nome_substituido, s.escala, s.horario, s.salario,
    s.beneficios, s.insalubridade_recebe, s.insalubridade_quanto, s.local_exato,
    s.data_inicio_prevista, s.quantidade_vagas, s.req_obrigatorios, s.req_desejaveis,
    s.exp_minima, s.exp_minima_qual, s.grau_urgencia, s.solicitante_nome,
    (b.cpf_digits IS NOT NULL) AS possui_restricao, b.motivo AS restricao_motivo,
    -- Novas (vao no fim: CREATE OR REPLACE nao aceita coluna no meio).
    c.compras_ok,
    c.desistiu, c.desistencia_motivo, c.desistencia_etapa, c.desistencia_em, c.desistencia_por
  FROM public."WA_CURRICULOS" c
  JOIN public."SISTEMA_RECRUTAMENTO" s ON s.id = c.vaga_id
  LEFT JOIN public."RECRUTAMENTO_CPF_BLACKLIST" b
    ON b.cpf_digits = regexp_replace(COALESCE(c.cpf, c.cpf_cand, ''), '\D', '', 'g')
  WHERE c.etapa_processo IS NOT NULL;

ALTER VIEW public."VW_RECRUTAMENTO_CANDIDATOS" SET (security_invoker = true);
GRANT SELECT ON public."VW_RECRUTAMENTO_CANDIDATOS" TO authenticated;

NOTIFY pgrst, 'reload schema';
