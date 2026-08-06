-- SIS-2026-0079: amplia planejamento_orcamentario_classificacao com Tipo
-- (Contrato/Administrativo), Setor responsável, a flag "Requer solicitação"
-- (Malote) e até 3 aprovadores com limite de alçada em % — convenção do
-- usuário: Aprovador 1 = gerente, 2 = diretor, 3 = CEO (não é validado em
-- código, é só a ordem esperada de uso).
--
-- "Requer solicitação": por enquanto só captura o dado. A trava de fluxo
-- real no módulo Malote (que ainda não existe nesta base) fica para um
-- chamado futuro, quando esse módulo for desenhado.
--
-- "Limite da alçada (%)": percentual sobre o valor do orçamento cadastrado
-- (planejamento_orcamentario.valor) quando tipo='administrativo'; quando
-- tipo='contrato', é sobre o valor orçado na planilha de custo da
-- licitação. Nenhuma dessas contas é calculada aqui — só o cadastro dos
-- percentuais; a lógica de cálculo/enforcement fica para quando o Malote
-- for implementado.
--
-- Todas as colunas novas são NULLable de propósito: a tabela já tem
-- classificações reais em produção (screenshot do chamado mostra dados) e
-- não há valor correto pra backfillar tipo/setor/aprovadores dessas linhas
-- existentes. O preenchimento vira obrigatório só no formulário
-- (frontend), tanto pra criar quanto pra editar uma classificação daqui
-- pra frente — ou seja, editar uma classificação antiga força completar
-- os campos novos.
--
-- Nome/user_id do aprovador ficam denormalizados lado a lado (padrão já
-- usado em alcada_aprovacao.responsavel_user_id/responsavel_nome) porque
-- este projeto não usa embedding do PostgREST contra auth.users.

ALTER TABLE public.planejamento_orcamentario_classificacao
  ADD COLUMN tipo text CHECK (tipo IN ('contrato', 'administrativo')),
  ADD COLUMN setor_responsavel text REFERENCES public.setor_catalogo(nome) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN requer_solicitacao boolean NOT NULL DEFAULT false,
  ADD COLUMN aprovador1_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN aprovador1_nome text,
  ADD COLUMN aprovador1_limite_pct numeric(5,2) CHECK (aprovador1_limite_pct IS NULL OR (aprovador1_limite_pct >= 0 AND aprovador1_limite_pct <= 100)),
  ADD COLUMN aprovador2_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN aprovador2_nome text,
  ADD COLUMN aprovador2_limite_pct numeric(5,2) CHECK (aprovador2_limite_pct IS NULL OR (aprovador2_limite_pct >= 0 AND aprovador2_limite_pct <= 100)),
  ADD COLUMN aprovador3_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN aprovador3_nome text,
  ADD COLUMN aprovador3_limite_pct numeric(5,2) CHECK (aprovador3_limite_pct IS NULL OR (aprovador3_limite_pct >= 0 AND aprovador3_limite_pct <= 100));

NOTIFY pgrst, 'reload schema';
