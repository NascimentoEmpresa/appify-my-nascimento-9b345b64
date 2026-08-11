-- VW_CONTRATOS_BASICO — lista de contratos para a pergunta "Selecionar
-- contrato" do Nascimento Formulários.
--
-- Por que uma view, e não a tabela: CONTRATOS tem RLS ligada e uma única
-- policy de SELECT (contratos_gate), só para {authenticated} e ainda assim
-- exigindo um de quatro menus (recrutamento_gestao, colaboradores,
-- encarregados_minhas_solicitacoes, advertencias). O formulário público roda
-- como anon quando não há sessão — leria zero linhas. E mesmo o formulário
-- interno seria respondido por gente de qualquer setor, que não tem nenhum
-- desses menus.
--
-- Mesmo desenho da VW_EMPREGADOS_BASICO (migration 20260724000002): view sem
-- security_invoker, portanto roda com privilégio do dono e enxerga a tabela
-- ignorando a RLS — expondo APENAS as colunas do SELECT abaixo. Fica de fora
-- tudo que não é preciso para escolher um contrato, em especial PAGAMENTOS
-- (valor), Endereço, CEP e Número Inscrição.
--
-- Só os ativos: quem responde um formulário não deve poder escolher contrato
-- encerrado. É o mesmo filtro que a tela de Colaboradores já aplica. Como o
-- corte está na view, e não na consulta da tela, nem anon nem authenticated
-- alcançam os encerrados por aqui.

-- DISTINCT ON pelo nome: hoje existem duas linhas ativas "LIMPEZA FURG", da
-- mesma empresa (ids 182 e 183) — indistinguíveis na tela. Como a resposta
-- gravada é o NOME do contrato, as duas produziriam exatamente a mesma
-- resposta; o que a duplicata causaria é linha repetida na lista e, na
-- seleção múltipla, marcar uma deixaria as duas marcadas (a comparação é por
-- nome). Deduplicar aqui resolve para as duas telas de uma vez.
CREATE OR REPLACE VIEW public."VW_CONTRATOS_BASICO" AS
SELECT DISTINCT ON (btrim(c."NOME CONTRATO"))
  c.id,
  btrim(c."NOME CONTRATO") AS nome_contrato,
  c."NOME EMPRESA"         AS nome_empresa
FROM public."CONTRATOS" c
WHERE upper(btrim(coalesce(c."ATIVO", ''))) = 'SIM'
  AND btrim(coalesce(c."NOME CONTRATO", '')) <> ''
ORDER BY btrim(c."NOME CONTRATO"), c.id;

COMMENT ON VIEW public."VW_CONTRATOS_BASICO" IS
  'Contratos ativos (nome e empresa) para a pergunta "Selecionar contrato" do Nascimento Formulários. Sem colunas financeiras.';

-- Só leitura, e explicitamente. As default privileges do schema public deste
-- projeto entregam INSERT/UPDATE/DELETE a anon em todo objeto novo — hoje
-- inertes aqui, porque o DISTINCT ON torna a view não-gravável. O REVOKE é
-- para o dia em que alguém tirar o DISTINCT: sem ele, a view voltaria a ser
-- auto-atualizável e viraria escrita de anon na CONTRATOS por tabela
-- interposta.
REVOKE ALL ON public."VW_CONTRATOS_BASICO" FROM anon, authenticated;
GRANT SELECT ON public."VW_CONTRATOS_BASICO" TO anon, authenticated;

-- Rollback: DROP VIEW public."VW_CONTRATOS_BASICO";

NOTIFY pgrst, 'reload schema';
