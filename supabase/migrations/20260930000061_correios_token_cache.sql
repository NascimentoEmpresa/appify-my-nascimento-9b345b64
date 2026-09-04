-- =====================================================================
-- Cache do token da API dos Correios
--
-- O *código de acesso* do CWS não expira ("validade indeterminada", conforme
-- a própria tela que o gera). O *token* derivado dele dura 24 horas, e a API
-- de token dos Correios aceita no máximo 3 requisições por segundo — com o
-- painel de Pedidos de Materiais aberto por várias pessoas, pedir um token a
-- cada consulta estouraria esse limite e devolveria HTTP 429.
--
-- Edge Function é efêmera: nada guardado em memória sobrevive entre duas
-- invocações. Por isso o cache precisa ser em tabela, e não no processo.
--
-- Uma linha só, de propósito (id = 1 com CHECK): não existe "vários tokens",
-- existe O token do cartão de postagem da empresa. Um id fixo torna o upsert
-- da Edge Function trivial e impede a tabela de virar um log que ninguém
-- limpa.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.correios_token (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  token         text NOT NULL,
  expira_em     timestamptz NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- RLS ligada e SEM NENHUMA POLICY, deliberadamente.
--
-- Isto não é esquecimento: é o objetivo. Com RLS ligada e zero policies,
-- ninguém autenticado lê ou escreve nada aqui — nem administrador, nem o
-- perfil que concede tudo. Só a service_role (que ignora RLS por definição)
-- alcança a tabela, e ela existe apenas dentro da Edge Function.
--
-- O conteúdo é uma credencial de sessão do contrato dos Correios da empresa.
-- Se vazasse para o browser, qualquer usuário do ERP poderia consultar e
-- postar no contrato da SN por 24 horas.
ALTER TABLE public.correios_token ENABLE ROW LEVEL SECURITY;

-- Nem anon nem authenticated recebem grant: o acesso é exclusivamente pela
-- service_role usada na Edge Function.
REVOKE ALL ON TABLE public.correios_token FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.correios_token IS
  'Cache do token da API dos Correios (24h). Escrita e leitura apenas pela Edge Function `correios`, via service_role. RLS sem policies é intencional.';

-- =====================================================================
-- ROLLBACK
--   DROP TABLE IF EXISTS public.correios_token;
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================

NOTIFY pgrst, 'reload schema';
