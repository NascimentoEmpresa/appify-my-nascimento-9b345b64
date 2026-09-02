-- =====================================================================
-- DEMISSÃO — SST e RH podem DEVOLVER a solicitação ao analista.
--
-- Pedido do Pablo em 02/09/2026: "insere ícone de reprovar a solicitação de
-- demissão, e retornar para o operacional ou analista, pois às vezes vem com
-- algum erro e a Melissa reprova."
--
-- A Melissa é do RH — a ÚLTIMA etapa do fluxo desde a 20260930000042
-- (analista → SST → RH). Ou seja: o erro só aparece no fim, quando a
-- solicitação já passou por dois setores, e até agora não havia o que fazer
-- com ela. As únicas saídas eram concluir um desligamento errado ou deixar o
-- card parado para sempre.
--
-- DESTINO: SEMPRE O ANALISTA, e não o Operacional.
--
-- O pedido diz "operacional ou analista", mas o Operacional perdeu a decisão
-- na demissão nesse mesmo dia (20260930000042) — a tela dele é somente
-- leitura, sem botão nenhum. Devolver para lá encalharia o card num lugar
-- onde ninguém pode mexer, que é pior do que não devolver. O analista é a
-- primeira porta do fluxo e a única etapa que pode reavaliar, então é para
-- ele que a devolução volta. O Operacional continua vendo tudo, inclusive a
-- devolução, porque a tela dele enxerga o fluxo inteiro.
--
-- POR QUE COLUNAS NOVAS em vez de reaproveitar `operacional_motivo`:
-- aquela coluna guarda o motivo de quando o ANALISTA reprova. Escrever a
-- devolução da Melissa lá faria a tela do analista mostrar, como se fosse
-- dele, um texto que ele não escreveu — e o histórico passaria a mentir
-- sobre quem recusou o quê.
-- =====================================================================

ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
  ADD COLUMN IF NOT EXISTS devolvido_por    text,
  ADD COLUMN IF NOT EXISTS devolvido_em     timestamptz,
  ADD COLUMN IF NOT EXISTS devolvido_motivo text,
  -- De qual etapa a devolução partiu ('sst' ou 'rh'). O analista precisa
  -- saber quem devolveu para saber o que conferir: erro apontado pelo SST é
  -- sobre o exame, erro apontado pelo RH é sobre o acerto.
  ADD COLUMN IF NOT EXISTS devolvido_de     text;

COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_DEMISSAO".devolvido_motivo IS
  'Por que o SST ou o RH mandou a solicitação de volta ao analista. Obrigatório na devolução — sem ele o analista não sabe o que corrigir.';

-- Só os dois status que existem depois do analista podem devolver, e o
-- destino é sempre a fila dele. O CHECK é barato e trava a combinação
-- impossível ("devolvido de um lugar que não decide").
ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
  DROP CONSTRAINT IF EXISTS sol_demissao_devolvido_de_valido;
ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
  ADD CONSTRAINT sol_demissao_devolvido_de_valido
  CHECK (devolvido_de IS NULL OR devolvido_de IN ('sst', 'rh'));

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
--   DROP CONSTRAINT IF EXISTS sol_demissao_devolvido_de_valido;
-- ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
--   DROP COLUMN IF EXISTS devolvido_por,
--   DROP COLUMN IF EXISTS devolvido_em,
--   DROP COLUMN IF EXISTS devolvido_motivo,
--   DROP COLUMN IF EXISTS devolvido_de;
-- NOTIFY pgrst, 'reload schema';
