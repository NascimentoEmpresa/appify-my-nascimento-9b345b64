-- =========================================================================
-- SIS-2026-0667 (parte 2) — WhatsApp automático por etapa com as mensagens
-- da biblioteca (14/10/2026)
--
-- Pedido do Pablo: "preciso que as mensagens sejam enviadas automaticamente
-- conforme o candidato for passando a etapa", configurável na tela.
--
-- POR QUE O AUTOMÁTICO NÃO FUNCIONAVA: nos últimos 30 dias o
-- RECRUTAMENTO_MENSAGENS_LOG tem 105 'erro' e nenhum 'enviado' — "(#132001)
-- Template name does not exist": os templates recrutamento_* nunca foram
-- criados na Meta. E mesmo o que saísse não aparecia na Caixa de Entrada: a
-- função gravava WA_MENSAGEM com origem 'recrutamento', que o CHECK recusa.
--
-- O QUE MUDA:
--   • Cada etapa do kanban aponta para UMA OU MAIS mensagens da biblioteca
--     (WA_TEMPLATE — as mesmas da "/" e do botão "Enviar para aprovação"),
--     em RECRUTAMENTO_MENSAGEM_ETAPA. Antes era um template solto por etapa
--     (RECRUTAMENTO_MENSAGENS), sem como aprovar pela tela — que fica sem uso.
--   • Etapa extra CONTRATADO = o "Contratar (enviar à Admissão)" do card.
--   • Valores fixos de variáveis (ex.: o link do formulário), em
--     RECRUTAMENTO_MENSAGEM_VALOR. O resto vem do candidato/vaga, e o banco
--     do salário é perguntado na hora de contratar (Edge recrutamento-mensagem).
--   • As duas mensagens antigas que estavam ligadas (Entrevista e Entrevista
--     com Gestor) entram na biblioteca para não se perderem.
--
-- Mapa inicial (proposta aprovada): Entrada → Convite · Triagem → Perguntas ·
-- Entrevista → Entrevista · Entrevista c/ Gestor → Entrevista c/ Gestor ·
-- Aprovado → Aprovado · Documentação → Checklist + Senior + Link do formulário
-- · Contratado → Contratado + Treinamentos.
--
-- A META PRECISA APROVAR CADA MENSAGEM (leva de horas a alguns dias). Até lá,
-- só chega a quem escreveu nas últimas 24h.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1) As duas mensagens antigas viram mensagens da biblioteca ──────────
INSERT INTO public."WA_TEMPLATE" (codigo, titulo, texto, variaveis, template_nome, categoria, ordem) VALUES
('rec_entrevista', 'Recrutamento — Entrevista',
$t$Olá {{1}}! Você foi selecionado(a) para a etapa de entrevista da vaga de {{2}}. Em breve entramos em contato para agendar.$t$,
 ARRAY['Primeiro nome', 'Cargo'], 'rec_entrevista', 'UTILITY', 210),
('rec_entrevista_gestor', 'Recrutamento — Entrevista com o gestor',
$t$Olá {{1}}! Você avançou para a segunda entrevista da vaga de {{2}}, agora com o gestor da área. Em breve entramos em contato para agendar.$t$,
 ARRAY['Primeiro nome', 'Cargo'], 'rec_entrevista_gestor', 'UTILITY', 211)
ON CONFLICT (codigo) DO NOTHING;

-- ── 2) Etapa → mensagens ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."RECRUTAMENTO_MENSAGEM_ETAPA" (
  etapa          text NOT NULL,
  codigo         text NOT NULL REFERENCES public."WA_TEMPLATE"(codigo) ON UPDATE CASCADE ON DELETE CASCADE,
  ordem          integer NOT NULL DEFAULT 0,
  ativo          boolean NOT NULL DEFAULT true,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  PRIMARY KEY (etapa, codigo),
  CONSTRAINT rec_msg_etapa_valida CHECK (etapa IN (
    'ENTRADA', 'TRIAGEM', 'JURÍDICO', 'ENTREVISTA', 'ENTREVISTA GESTOR', 'APROVADO',
    'DOCUMENTAÇÃO', 'SST + COMPRAS', 'ADMISSÃO', 'CONTRATADO'))
);
ALTER TABLE public."RECRUTAMENTO_MENSAGEM_ETAPA" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rec_msg_etapa_select ON public."RECRUTAMENTO_MENSAGEM_ETAPA";
CREATE POLICY rec_msg_etapa_select ON public."RECRUTAMENTO_MENSAGEM_ETAPA" FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::public.app_acao));
DROP POLICY IF EXISTS rec_msg_etapa_write ON public."RECRUTAMENTO_MENSAGEM_ETAPA";
CREATE POLICY rec_msg_etapa_write ON public."RECRUTAMENTO_MENSAGEM_ETAPA" FOR ALL TO authenticated
  USING (public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar'::public.app_acao))
  WITH CHECK (public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar'::public.app_acao));

-- ── 3) Valores fixos de variável (ex.: Link do formulário) ──────────────
CREATE TABLE IF NOT EXISTS public."RECRUTAMENTO_MENSAGEM_VALOR" (
  variavel       text PRIMARY KEY,
  valor          text,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);
ALTER TABLE public."RECRUTAMENTO_MENSAGEM_VALOR" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rec_msg_valor_select ON public."RECRUTAMENTO_MENSAGEM_VALOR";
CREATE POLICY rec_msg_valor_select ON public."RECRUTAMENTO_MENSAGEM_VALOR" FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::public.app_acao));
DROP POLICY IF EXISTS rec_msg_valor_write ON public."RECRUTAMENTO_MENSAGEM_VALOR";
CREATE POLICY rec_msg_valor_write ON public."RECRUTAMENTO_MENSAGEM_VALOR" FOR ALL TO authenticated
  USING (public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar'::public.app_acao))
  WITH CHECK (public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar'::public.app_acao));

-- O link do formulário fica vazio de propósito: o do chamado termina em
-- /edit (o link de EDIÇÃO do Google Forms, que o candidato não preenche).
-- Até alguém cadastrar o link de resposta na tela, essa mensagem não sai.
INSERT INTO public."RECRUTAMENTO_MENSAGEM_VALOR" (variavel, valor) VALUES ('Link do formulário', NULL)
ON CONFLICT (variavel) DO NOTHING;

-- ── 4) Mapa inicial ──────────────────────────────────────────────────────
INSERT INTO public."RECRUTAMENTO_MENSAGEM_ETAPA" (etapa, codigo, ordem) VALUES
  ('ENTRADA',           'rec_convite',           1),
  ('TRIAGEM',           'rec_perguntas',         1),
  ('ENTREVISTA',        'rec_entrevista',        1),
  ('ENTREVISTA GESTOR', 'rec_entrevista_gestor', 1),
  ('APROVADO',          'rec_aprovado',          1),
  ('DOCUMENTAÇÃO',      'rec_checklist_dados',   1),
  ('DOCUMENTAÇÃO',      'rec_senior',            2),
  ('DOCUMENTAÇÃO',      'rec_link_formulario',   3),
  ('CONTRATADO',        'rec_contratado',        1),
  ('CONTRATADO',        'rec_treinamento',       2)
ON CONFLICT (etapa, codigo) DO NOTHING;

-- O log passa a dizer QUAL mensagem da biblioteca saiu (uma etapa pode ter várias).
ALTER TABLE public."RECRUTAMENTO_MENSAGENS_LOG" ADD COLUMN IF NOT EXISTS codigo text;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TABLE IF EXISTS public."RECRUTAMENTO_MENSAGEM_ETAPA", public."RECRUTAMENTO_MENSAGEM_VALOR";
-- ALTER TABLE public."RECRUTAMENTO_MENSAGENS_LOG" DROP COLUMN IF EXISTS codigo;
-- DELETE FROM public."WA_TEMPLATE" WHERE codigo IN ('rec_entrevista', 'rec_entrevista_gestor');
-- Reimplantar a Edge recrutamento-mensagem da versão anterior (lê RECRUTAMENTO_MENSAGENS).
-- NOTIFY pgrst, 'reload schema';
