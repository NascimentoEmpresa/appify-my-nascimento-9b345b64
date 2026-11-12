-- =========================================================================
-- RECRUTAMENTO › SOLICITAR NOVA VAGA — ENDEREÇO EFETIVO DO LOCAL DE TRABALHO
-- (chamado #0849, Fernanda, 11/11/2026)
--
-- PEDIDO: campo obrigatório, logo depois do posto (vínculo com o catálogo
-- de Suprimentos), com o endereço físico onde o colaborador vai trabalhar —
-- "rua, número, bairro, cidade e UF". A Licitação ainda não informa isso,
-- então quem abre a vaga digita. Fica gravado na vaga para o Recrutamento e
-- a Admissão.
--
-- Coluna NOVA (endereco_trabalho), e não o local_exato: o local_exato tem
-- dois sentidos (posto no formulário do encarregado, local digitado no
-- modal — ver src/lib/recrutamento/postoDaVaga.ts) e é obrigatório na etapa
-- 2; misturar o endereço nele embaralharia os dois.
--
-- A obrigatoriedade é da tela (o modal não avança sem ele). O banco não
-- recusa vaga sem endereço porque o formulário do encarregado (Minhas
-- Solicitações) ainda não tem o campo, e vagas antigas não o têm.
--
-- A view VW_RECRUTAMENTO_CANDIDATOS ganha a coluna no fim (o que os cards de
-- candidato, SST e Admissão leem). Idempotente. ROLLBACK no fim.
-- =========================================================================

ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS endereco_trabalho text;
COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".endereco_trabalho IS
  '#0849: endereço efetivo do local de trabalho (rua, número, bairro, cidade e UF), informado ao abrir a vaga.';

-- View dos candidatos: mesma definição da mig 20261103002300 + a coluna nova no fim.
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
    c.sst_cancelamento_ciente_em, c.sst_cancelamento_ciente_por,
    -- 11/11/2026 (#0849): endereço efetivo do local de trabalho da vaga
    s.endereco_trabalho
   FROM ((public."WA_CURRICULOS" c
     JOIN public."SISTEMA_RECRUTAMENTO" s ON ((s.id = c.vaga_id)))
     LEFT JOIN public."RECRUTAMENTO_CPF_BLACKLIST" b ON ((b.cpf_digits = regexp_replace(COALESCE(c.cpf, c.cpf_cand, ''::text), '\D'::text, ''::text, 'g'::text))))
  WHERE (c.etapa_processo IS NOT NULL);

-- Histórico: o nome legível do campo nas edições.
DO $do$
DECLARE
  v_def text;
  velho constant text := $a$"contrato_id":"Contrato (cadastro)"$a$;
  novo  constant text := $a$"contrato_id":"Contrato (cadastro)", "endereco_trabalho":"Endereço efetivo do local de trabalho"$a$;
BEGIN
  v_def := pg_get_functiondef('public.rec_historico_automatico()'::regprocedure);
  IF position('endereco_trabalho' IN v_def) > 0 THEN RETURN; END IF;
  IF position(velho IN v_def) = 0 THEN
    RAISE NOTICE 'rec_historico_automatico sem o rótulo esperado; o campo aparece com o nome da coluna.';
    RETURN;
  END IF;
  EXECUTE replace(v_def, velho, novo);
END $do$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   Reaplicar a VW_RECRUTAMENTO_CANDIDATOS da mig 20261103002300 exige DROP VIEW antes
--   (CREATE OR REPLACE não tira coluna): DROP VIEW public."VW_RECRUTAMENTO_CANDIDATOS"; e recriar.
--   rec_historico_automatico: replace inverso do rótulo.
--   ALTER TABLE public."SISTEMA_RECRUTAMENTO" DROP COLUMN IF EXISTS endereco_trabalho;
