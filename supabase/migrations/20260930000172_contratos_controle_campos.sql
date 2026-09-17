-- SIS-2026-0325: campos novos em `contratos` pro módulo "Controle de
-- Contratos" (redesign da tela Contratos em /app/licitacoes/contratos).
--
-- Hoje `contratos` só tem cadastro básico (empresa/nome/cliente/vigência/
-- status) — o resto do controle (cidade, nº edital, quantidade de
-- funcionários, valores, garantia) vive numa planilha externa
-- ("CONTROLE ANUAL DE CONTRATOS"). Este chamado move esse controle pro
-- ERP; valor executado/custo indireto/lucro NÃO são colunas novas — saem
-- calculados ao vivo a partir de `planilha_custo` (que já guarda isso por
-- posto/vigência), reaproveitando `somarCamposEmLinhas`
-- (src/hooks/usePlanilhaCusto.ts).
--
-- Campos aqui alimentam o formulário "Novo Contrato" (mockup do Iury),
-- que passa a ser o único jeito de criar um contrato — substitui o
-- dialog atual de ContratosERP.tsx, a criação automática em
-- useCapaPromover e a importação em massa a partir de distintos da
-- Planilha de Custo (ver plano do chamado).
--
-- Idempotente.

ALTER TABLE public.contratos
  ADD COLUMN IF NOT EXISTS cidade text,
  ADD COLUMN IF NOT EXISTS numero_edital text,
  -- A planilha original tem 4 datas distintas e confusas (data_inicio já
  -- existe); mantidas separadas aqui pra não perder informação que já é
  -- rastreada hoje, mesmo sem ficar claro o motivo de cada uma existir.
  ADD COLUMN IF NOT EXISTS data_fim_vigencia date,
  ADD COLUMN IF NOT EXISTS vigencia_inicial date,
  ADD COLUMN IF NOT EXISTS vigencia_final date,
  -- "Executado" simples vem calculado da Planilha de Custo (soma de
  -- qt_postos vigente) — só a estipulada e a "real"/auditada em campo,
  -- que não têm outra fonte.
  ADD COLUMN IF NOT EXISTS quant_func_estipulado int,
  ADD COLUMN IF NOT EXISTS quant_func_exec_real int,
  ADD COLUMN IF NOT EXISTS valor_mensal_contratado numeric,
  ADD COLUMN IF NOT EXISTS valor_mensal_ano_anterior numeric,
  ADD COLUMN IF NOT EXISTS valor_garantia_contratual numeric,
  -- Custo anual de insumos: campo manual (decisão do usuário — sem
  -- fórmula automática identificada nos mockups/planilha de referência).
  ADD COLUMN IF NOT EXISTS custo_anual_insumos numeric,
  -- Texto livre, não enum: os valores reais na planilha são frases
  -- variadas sem padrão fixo ("OK -EMITIDO", "AGUARDANDO EMPENHO",
  -- "UFFS QUE ENVIA A AUTORIZAÇÃO (POR CAMPUS)"...).
  ADD COLUMN IF NOT EXISTS status_solicitacao text;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   ALTER TABLE public.contratos
--     DROP COLUMN IF EXISTS cidade,
--     DROP COLUMN IF EXISTS numero_edital,
--     DROP COLUMN IF EXISTS data_fim_vigencia,
--     DROP COLUMN IF EXISTS vigencia_inicial,
--     DROP COLUMN IF EXISTS vigencia_final,
--     DROP COLUMN IF EXISTS quant_func_estipulado,
--     DROP COLUMN IF EXISTS quant_func_exec_real,
--     DROP COLUMN IF EXISTS valor_mensal_contratado,
--     DROP COLUMN IF EXISTS valor_mensal_ano_anterior,
--     DROP COLUMN IF EXISTS valor_garantia_contratual,
--     DROP COLUMN IF EXISTS custo_anual_insumos,
--     DROP COLUMN IF EXISTS status_solicitacao;
-- =====================================================================
