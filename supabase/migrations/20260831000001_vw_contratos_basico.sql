-- VW_CONTRATOS_BASICO — lista de contratos para a pergunta "Selecionar
-- contrato" do Nascimento Formulários.
--
-- A fonte é public.contratos (minúscula) — o cadastro de contratos do ERP,
-- com nome e cliente. NÃO é a "CONTRATOS" maiúscula, que é outra tabela
-- (cadastro no formato da Senior, por filial); as duas coexistem no schema e
-- o nome parecido engana.
--
-- Por que uma view, e não a tabela direto: contratos tem RLS e a policy de
-- SELECT é só para {authenticated} E ainda recorta por empresa
-- (empresa_id IN (select empresa_id from user_empresa where user_id =
-- auth.uid())). O formulário público roda como anon — leria zero linhas. E
-- mesmo logado, quem responde pode não ter a empresa daquele contrato em
-- user_empresa, então a lista viria furada.
--
-- Mesmo desenho da VW_EMPREGADOS_BASICO (migration 20260724000002): view sem
-- security_invoker, portanto roda com privilégio do dono e enxerga a tabela
-- ignorando a RLS — expondo APENAS as colunas do SELECT abaixo. Fica de fora
-- tudo que é fiscal/financeiro (issqn_pct, ir_pct, conta_pagamento,
-- email_envio_nf e afins).
--
-- Só os ativos: quem responde não deve poder escolher contrato encerrado.
-- Hoje são 51 de 62.
--
-- DROP antes do CREATE porque a versão anterior desta view lia a "CONTRATOS"
-- maiúscula e tinha outros tipos de coluna (id bigint, não uuid) — CREATE OR
-- REPLACE não consegue trocar tipo nem nome de coluna.

DROP VIEW IF EXISTS public."VW_CONTRATOS_BASICO";

-- DISTINCT ON pelo nome: hoje não há nomes repetidos em contratos, mas a
-- resposta gravada é o NOME do contrato e a tela compara por nome — se um dia
-- surgir repetido, na seleção múltipla marcar um marcaria os dois. De quebra,
-- o DISTINCT torna a view não-gravável, o que fecha a porta de escrita por
-- tabela interposta.
CREATE VIEW public."VW_CONTRATOS_BASICO" AS
SELECT DISTINCT ON (btrim(c.nome))
  c.id,
  btrim(c.nome)    AS nome,
  btrim(c.cliente) AS cliente
FROM public.contratos c
WHERE lower(btrim(coalesce(c.status, ''))) = 'ativo'
  AND btrim(coalesce(c.nome, '')) <> ''
ORDER BY btrim(c.nome), c.id;

COMMENT ON VIEW public."VW_CONTRATOS_BASICO" IS
  'Contratos ativos (nome e cliente) de public.contratos, para a pergunta "Selecionar contrato" do Nascimento Formulários. Sem colunas fiscais/financeiras.';

-- Só leitura, e explicitamente. As default privileges do schema public deste
-- projeto entregam INSERT/UPDATE/DELETE a anon em todo objeto novo.
REVOKE ALL ON public."VW_CONTRATOS_BASICO" FROM anon, authenticated;
GRANT SELECT ON public."VW_CONTRATOS_BASICO" TO anon, authenticated;

-- Rollback: DROP VIEW public."VW_CONTRATOS_BASICO";

NOTIFY pgrst, 'reload schema';
