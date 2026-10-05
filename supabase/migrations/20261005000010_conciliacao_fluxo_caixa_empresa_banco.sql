-- Conciliação do Fluxo de Caixa: passa a ser por BANCO + EMPRESA(S).
--
-- Pedido do Financeiro: o banco é um cadastro único (ex.: "Banrisul"), mas
-- cada empresa do grupo tem a sua conta nele — e o extrato OFX é de UMA
-- conta. Conciliar só por banco trazia pro lado do Fluxo os lançamentos das
-- outras empresas daquele banco, que apareciam como "consta no Fluxo, não
-- caiu no extrato" e escondiam divergência de verdade.
--
-- A tela agora exige informar as empresas da conciliação (uma, várias ou
-- todas). O histórico guarda quais foram, pra dizer de qual conta cada
-- conciliação foi. `conta_extrato` é a conta lida do próprio OFX
-- (BANKID/ACCTID) — só informativa, serve pra conferir a escolha.
--
-- Linhas antigas (anteriores a esta migration) não sabiam empresa nem banco:
-- ficam como "todas as empresas".

ALTER TABLE public.financeiro_conciliacao_fluxo_caixa
  ADD COLUMN IF NOT EXISTS banco_id uuid REFERENCES public.malote_cartao_banco(id),
  ADD COLUMN IF NOT EXISTS todas_empresas boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS empresa_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS conta_extrato text;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public.financeiro_conciliacao_fluxo_caixa
--   DROP COLUMN IF EXISTS banco_id, DROP COLUMN IF EXISTS todas_empresas,
--   DROP COLUMN IF EXISTS empresa_ids, DROP COLUMN IF EXISTS conta_extrato;
