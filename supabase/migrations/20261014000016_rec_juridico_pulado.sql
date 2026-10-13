-- =========================================================================
-- RECRUTAMENTO: "JURÍDICO: OK" FALSO → "JURÍDICO PULADO" (14/10/2026)
--
-- SINTOMA (Pablo, Jurídico › Verificação de Candidatos › Todos): "aqui tá
-- JURÍDICO: OK mas o jurídico nunca deu OK na maioria desses — tem que estar
-- o status jurídico pulado, algo assim".
--
-- CAUSA: no kanban da Gestão Recrutamento, tirar o candidato da coluna
-- JURÍDICO carimbava juridico_ok = true com o nome de quem MOVEU — que era o
-- Recrutamento, não o Jurídico. Os 21 "Jurídico: OK" sem nível foram todos
-- da Mileny (Recrutamento, sem acesso ao Jurídico), de 15 a 25/09: ela
-- mesma enviou ao Jurídico e "liberou pelo Jurídico". E o "Pular Jurídico →"
-- (TRIAGEM → ENTREVISTA) não deixava marca nenhuma.
--
-- AGORA
--   · WA_CURRICULOS.juridico_pulado: o candidato seguiu sem o parecer do
--     Jurídico (pulado na Triagem, ou retirado da coluna pelo Recrutamento);
--   · só o parecer do Jurídico (Verificação de Candidatos) grava juridico_ok;
--   · carga: o OK sem nível dado por quem não é do Jurídico vira "pulado"
--     (juridico_ok volta a NULL, o carimbo fica para o histórico), e quem
--     está da Entrevista em diante sem nenhum registro do Jurídico, também.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

ALTER TABLE public."WA_CURRICULOS" ADD COLUMN IF NOT EXISTS juridico_pulado boolean NOT NULL DEFAULT false;

-- Quem é do Jurídico: tem "alterar" na Verificação de Candidatos (menu candidatos).
-- juridico_por guarda e-mail ou nome — casa pelos dois.
UPDATE public."WA_CURRICULOS" c
   SET juridico_pulado = true, juridico_ok = NULL
 WHERE c.juridico_ok = true AND c.juridico_nivel IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.profiles p
      WHERE (lower(p.email) = lower(btrim(c.juridico_por)) OR upper(btrim(p.display_name)) = upper(btrim(c.juridico_por)))
        AND public.has_screen_access(p.id, 'candidatos', 'alterar'::public.app_acao));

-- Da Entrevista em diante sem nenhum registro do Jurídico: pulado na Triagem.
UPDATE public."WA_CURRICULOS"
   SET juridico_pulado = true
 WHERE juridico_em IS NULL AND juridico_ok IS NULL AND NOT juridico_pulado
   AND etapa_processo IN ('ENTREVISTA', 'ENTREVISTA GESTOR', 'APROVADO', 'DOCUMENTAÇÃO', 'SST + COMPRAS', 'ADMISSÃO');

-- A view da Verificação e do Recrutamento traz a coluna nova (no fim — CREATE OR
-- REPLACE VIEW só aceita acrescentar coluna no final).
CREATE OR REPLACE VIEW public."VW_RECRUTAMENTO_CANDIDATOS" WITH (security_invoker = true) AS
SELECT c.id AS candidato_id,
    c.vaga_id,
    c.nome,
    c.telefone,
    c.email,
    COALESCE(c.cpf, c.cpf_cand) AS cpf,
    c.origem,
    c.storage_path,
    c.mensagem,
    c.etapa_processo,
    c.etapa_changed_at,
    c.selecionado_por,
    c.selecionado_em,
    c.juridico_ok,
    c.juridico_obs,
    c.juridico_por,
    c.juridico_em,
    c.sst_ok,
    c.sst_obs,
    c.sst_por,
    c.sst_em,
    c.sst_data_exame,
    c.sst_hora_exame,
    c.sst_local_exame,
    c.sst_agendado_por,
    c.sst_agendado_em,
    c.compras_necessidades,
    c.compras_por,
    c.compras_em,
    c.compras_obs,
    c.compras_data_chegada,
    c.epis_informados,
    c.epis_informados_em,
    c.enviado_admissao_por,
    c.enviado_admissao_em,
    c.admitido_por,
    c.admitido_em,
    c.empregado_id,
    c.motivo_reprovacao,
    c.experiencia_1,
    c.experiencia_2,
    c.experiencia_3,
    c.favorito,
    c.tipo_candidatura,
    c.created_at AS candidatura_em,
    s.cargo,
    s.contrato,
    s.cidade,
    s.status AS vaga_status,
    s.motivo_vaga,
    s.nome_substituido,
    s.escala,
    s.horario,
    s.salario,
    s.beneficios,
    s.insalubridade_recebe,
    s.insalubridade_quanto,
    s.local_exato,
    s.data_inicio_prevista,
    s.quantidade_vagas,
    s.req_obrigatorios,
    s.req_desejaveis,
    s.exp_minima,
    s.exp_minima_qual,
    s.grau_urgencia,
    s.solicitante_nome,
    b.cpf_digits IS NOT NULL AS possui_restricao,
    b.motivo AS restricao_motivo,
    c.compras_ok,
    c.desistiu,
    c.desistencia_motivo,
    c.desistencia_etapa,
    c.desistencia_em,
    c.desistencia_por,
    s.contrato_id,
    s.posto_id,
    s.funcao_id,
    c.juridico_nivel,
    c.juridico_pulado
   FROM "WA_CURRICULOS" c
     JOIN "SISTEMA_RECRUTAMENTO" s ON s.id = c.vaga_id
     LEFT JOIN "RECRUTAMENTO_CPF_BLACKLIST" b ON b.cpf_digits = regexp_replace(COALESCE(c.cpf, c.cpf_cand, ''::text), '\D'::text, ''::text, 'g'::text)
  WHERE c.etapa_processo IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- UPDATE public."WA_CURRICULOS" SET juridico_ok = true WHERE juridico_pulado AND juridico_em IS NOT NULL;
-- ALTER TABLE public."WA_CURRICULOS" DROP COLUMN IF EXISTS juridico_pulado;
