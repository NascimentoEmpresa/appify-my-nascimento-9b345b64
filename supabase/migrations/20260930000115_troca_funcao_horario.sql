-- =========================================================================
-- Mudança de Função: troca de HORÁRIO (carga horária), com ou sem troca de cargo
--
-- Pedido do Pablo em 15/09/2026: "muitas vezes as pessoas só alteram a
-- carga horária e não a função — a Carla está pedindo aumento de carga
-- horária e não consegue evoluir, porque a função é a mesma. Quando troca a
-- função, também precisa informar qual carga horária a pessoa passa a
-- fazer."
--
--   tipo           'funcao'  → troca de cargo (e informa o horário novo)
--                  'horario' → SÓ horário; cargo_novo = cargo_atual
--   horario_atual  o que o cadastro diz hoje (EMPREGADOS."Escala")
--   horario_novo   o que a pessoa passa a fazer (texto livre: "40h 5x2
--                  08:00–17:00", "30h", "12x36 noturno"...)
--
-- cargo_novo continua NOT NULL: na troca só de horário a tela grava o cargo
-- atual nele, e a validação "cargo novo igual ao atual" só vale pro tipo
-- 'funcao'. Fluxo de aprovação é o mesmo (analista → aprovação → SST → RH).
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================
ALTER TABLE public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
  ADD COLUMN IF NOT EXISTS tipo          text NOT NULL DEFAULT 'funcao',
  ADD COLUMN IF NOT EXISTS horario_atual text,
  ADD COLUMN IF NOT EXISTS horario_novo  text;

ALTER TABLE public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" DROP CONSTRAINT IF EXISTS stf_tipo_chk;
ALTER TABLE public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
  ADD CONSTRAINT stf_tipo_chk CHECK (tipo IN ('funcao', 'horario'));

COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_TROCA_FUNCAO".tipo IS
  'funcao = troca de cargo (horário informado junto); horario = só carga horária/escala, cargo_novo = cargo_atual.';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
--   DROP CONSTRAINT IF EXISTS stf_tipo_chk,
--   DROP COLUMN IF EXISTS tipo, DROP COLUMN IF EXISTS horario_atual, DROP COLUMN IF EXISTS horario_novo;
-- NOTIFY pgrst, 'reload schema';
