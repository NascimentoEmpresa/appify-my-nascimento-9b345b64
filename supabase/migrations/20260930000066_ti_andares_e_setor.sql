-- =====================================================================
-- T.I — o escritório ganha ANDARES e a sala ganha SETOR.
--
-- ANDARES
--   Cada `TI_PLANTA` já era um ambiente independente. Faltava dizer QUE ANDAR
--   ela é, para a cena poder empilhá-las: térreo em y=0, 1º andar na altura do
--   pé-direito do térreo, e assim por diante. Com isso a tela consegue mostrar
--   um andar por vez (para editar) ou os dois de uma vez (para ver o prédio).
--
--   `nivel` é um inteiro e não um texto ("térreo", "1º andar") porque a cena
--   precisa SOMAR: a altura de um andar é a soma dos pés-direitos dos que
--   estão abaixo dele. Nome do andar continua sendo o `nome` da planta.
--
--   0 = térreo, 1 = primeiro andar, -1 = subsolo. As plantas que já existem
--   ficam no 0, que é onde elas estão hoje.
--
-- SETOR NA SALA
--   Uma área de piso ("sala", "copa", "recepção") passa a poder dizer de que
--   setor ela é. Não é enfeite: é o que permite pintar o mapa por setor,
--   filtrar "onde fica o Financeiro" e, mais adiante, conferir se o
--   equipamento está na sala do setor do responsável dele.
--
--   Texto livre, e não FK para uma tabela de setores: o setor aqui é o mesmo
--   string que vem de EMPREGADOS."Setor_ERP" — que é a fonte única de setor
--   deste ERP e não tem tabela própria de catálogo. Inventar uma aqui criaria
--   um segundo cadastro de setor para manter em sincronia com o Senior.
--
-- Idempotente. As duas colunas são aditivas: planta e sala antigas continuam
-- funcionando sem nenhum preenchimento.
-- =====================================================================

ALTER TABLE public."TI_PLANTA"
  ADD COLUMN IF NOT EXISTS nivel integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public."TI_PLANTA".nivel IS
  'Andar: 0 = térreo, 1 = primeiro andar, -1 = subsolo. A cena empilha as plantas por este número.';

ALTER TABLE public."TI_PLANTA_ELEMENTO"
  ADD COLUMN IF NOT EXISTS setor text;

COMMENT ON COLUMN public."TI_PLANTA_ELEMENTO".setor IS
  'Setor dono da área (mesmo vocabulário de EMPREGADOS."Setor_ERP"). Só faz sentido em elementos de piso (sala, copa, recepção).';

-- Duas plantas não podem disputar o mesmo andar: a cena empilharia uma dentro
-- da outra e ninguém entenderia o desenho. Índice parcial porque planta
-- inativa (arquivada) pode conviver com a nova no mesmo nível.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ti_planta_nivel_ativa
  ON public."TI_PLANTA"(nivel) WHERE ativo;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT nome, nivel, largura_cm, altura_cm, pe_direito_cm, ativo
  FROM public."TI_PLANTA" ORDER BY nivel;

-- =====================================================================
-- ROLLBACK
--   DROP INDEX IF EXISTS public.uq_ti_planta_nivel_ativa;
--   ALTER TABLE public."TI_PLANTA_ELEMENTO" DROP COLUMN IF EXISTS setor;
--   ALTER TABLE public."TI_PLANTA" DROP COLUMN IF EXISTS nivel;
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
