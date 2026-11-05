-- =====================================================================
-- BONIFICAÇÃO COLETIVA — pesos por desenvolvedor salvos (não mais simulação).
--
-- Pedido do Pablo (05/11/2026): "ao alterar a porcentagem não tá salvando,
-- tem que ter um botão de salvar e manter fixo." O bloco "Desempenho por
-- desenvolvedor — com peso no valor" passa a gravar os pesos e o modo
-- (porcentagem/nota) NO MÊS (competência), em BONIFICACAO_DEV_PERIODO —
-- o mesmo lugar da verba e dos pesos dos critérios.
--
-- POR MÊS, COM HERANÇA: o mês sem pesos próprios usa os do último mês
-- anterior que tenha pesos salvos (como a configuração já faz — ver
-- resolverPeriodo / pesosSalvosDoMes no front). Assim o que o Pablo salva
-- hoje vale para os meses seguintes até alguém mudar, e mudar um mês não
-- reescreve o passado (nem um período já fechado).
--
-- Gate: nenhum novo. Gravar em BONIFICACAO_DEV_PERIODO já exige
-- 'sistemas_bonificacao_regras' alterar ou aprovar (policies da
-- 20261105004700, por has_screen_access/can_access via
-- bonificacao_dev_acesso), e o gatilho bonificacao_dev_periodo_guard
-- compara a linha INTEIRA (NEW IS DISTINCT FROM OLD) — período fechado
-- trava estas colunas também, sem mudar o gatilho.
--
-- pesos_devs: { "<auth uid do dev>": <% 0–100>, ... } — chave = responsavel_id.
-- =====================================================================

ALTER TABLE public."BONIFICACAO_DEV_PERIODO"
  ADD COLUMN IF NOT EXISTS pesos_devs jsonb,
  ADD COLUMN IF NOT EXISTS modo_divisao text;

ALTER TABLE public."BONIFICACAO_DEV_PERIODO" DROP CONSTRAINT IF EXISTS bonificacao_dev_periodo_modo_chk;
ALTER TABLE public."BONIFICACAO_DEV_PERIODO"
  ADD CONSTRAINT bonificacao_dev_periodo_modo_chk CHECK (modo_divisao IS NULL OR modo_divisao IN ('peso', 'nota'));

ALTER TABLE public."BONIFICACAO_DEV_PERIODO" DROP CONSTRAINT IF EXISTS bonificacao_dev_periodo_pesos_devs_chk;
ALTER TABLE public."BONIFICACAO_DEV_PERIODO"
  ADD CONSTRAINT bonificacao_dev_periodo_pesos_devs_chk CHECK (pesos_devs IS NULL OR jsonb_typeof(pesos_devs) = 'object');

COMMENT ON COLUMN public."BONIFICACAO_DEV_PERIODO".pesos_devs IS
  'Peso no valor por dev ({responsavel_id: %}), salvo pelo botão do bloco "com peso no valor". NULL = herda do último mês salvo (ou padrão).';
COMMENT ON COLUMN public."BONIFICACAO_DEV_PERIODO".modo_divisao IS
  'Como o liberado é dividido: peso (porcentagem, padrão) ou nota (peso × nota).';

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- ALTER TABLE public."BONIFICACAO_DEV_PERIODO" DROP CONSTRAINT IF EXISTS bonificacao_dev_periodo_pesos_devs_chk;
-- ALTER TABLE public."BONIFICACAO_DEV_PERIODO" DROP CONSTRAINT IF EXISTS bonificacao_dev_periodo_modo_chk;
-- ALTER TABLE public."BONIFICACAO_DEV_PERIODO" DROP COLUMN IF EXISTS modo_divisao, DROP COLUMN IF EXISTS pesos_devs;
-- NOTIFY pgrst, 'reload schema';
