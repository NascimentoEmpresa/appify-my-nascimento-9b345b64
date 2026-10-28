-- [SEM-CHAMADO] (continuação do SIS-2026-0755) Controladoria: o tratamento de cada contrato nos relatórios passa a ser configurável.
--
-- Hoje a regra mora no código, pelo início do nome do contrato: "ESTOQUE …", "MOVIMENTAÇÃO FINANCEIRA …" e "INVESTIMENTOS …" não contam como despesa de
-- contrato (Faturamento da Empresa, Lucratividade de Contratos, Lucro dos Contratos do Fechamento), e "INVESTIMENTOS …" forma a coluna Investimentos do
-- Resumo Mensal com Sócios. Cada exceção nova virava chamado e deploy.
--
-- Esta tabela guarda só as EXCEÇÕES, uma linha por contrato:
--   normal            = conta como contrato comum, mesmo que o nome sugira outra coisa;
--   fora_das_despesas = o que se paga nele não é despesa de contrato (não entra em Despesas nem no Lucro);
--   investimento      = idem, e o valor aparece na coluna Investimentos do Fechamento.
-- Sem linha = continua valendo a regra pelo nome de hoje. Por isso esta migration não muda nenhum número: nada é pré-carregado.
-- "Voltar ao padrão" = apagar a linha. Acesso: menu fantasma 'controladoria-tratamento-contratos' (visualizar / alterar), e quem vê os
-- relatórios que usam a regra também lê (precisa dela para calcular).

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.controladoria_contrato_tratamento (
  contrato_id uuid PRIMARY KEY REFERENCES public.contratos(id) ON DELETE CASCADE,
  tratamento  text NOT NULL CHECK (tratamento IN ('normal', 'fora_das_despesas', 'investimento')),
  -- Sem FK para auth.users: a FK trava a tabela do Auth e o pgAdmin do cluster não tem REFERENCES nela.
  updated_by  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS controladoria_contrato_tratamento_set_updated ON public.controladoria_contrato_tratamento;
CREATE TRIGGER controladoria_contrato_tratamento_set_updated
  BEFORE UPDATE ON public.controladoria_contrato_tratamento
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.controladoria_contrato_tratamento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS controladoria_contrato_tratamento_select ON public.controladoria_contrato_tratamento;
CREATE POLICY controladoria_contrato_tratamento_select ON public.controladoria_contrato_tratamento
  FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'controladoria-tratamento-contratos', 'visualizar'::public.app_acao)
    OR public.can_access(auth.uid(), 'faturamento-empresa', 'visualizar'::public.app_acao)
    OR public.can_access(auth.uid(), 'lucratividade-contratos', 'visualizar'::public.app_acao)
    OR public.can_access(auth.uid(), 'fechamento-empresa', 'visualizar'::public.app_acao)
  );

DROP POLICY IF EXISTS controladoria_contrato_tratamento_insert ON public.controladoria_contrato_tratamento;
CREATE POLICY controladoria_contrato_tratamento_insert ON public.controladoria_contrato_tratamento
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'controladoria-tratamento-contratos', 'alterar'::public.app_acao));

DROP POLICY IF EXISTS controladoria_contrato_tratamento_update ON public.controladoria_contrato_tratamento;
CREATE POLICY controladoria_contrato_tratamento_update ON public.controladoria_contrato_tratamento
  FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'controladoria-tratamento-contratos', 'alterar'::public.app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'controladoria-tratamento-contratos', 'alterar'::public.app_acao));

DROP POLICY IF EXISTS controladoria_contrato_tratamento_delete ON public.controladoria_contrato_tratamento;
CREATE POLICY controladoria_contrato_tratamento_delete ON public.controladoria_contrato_tratamento
  FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'controladoria-tratamento-contratos', 'alterar'::public.app_acao));

-- No cluster tabela nova não herda privilégio: sem o GRANT o Postgres nega antes de avaliar a RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.controladoria_contrato_tratamento TO authenticated;

-- Menu fantasma (sem rota): só dá visibilidade própria à configuração no Gerenciamento de Acesso (/app/administracao?tab=modulos).
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'controladoria-tratamento-contratos', 'Controladoria — Tratamento dos contratos nos relatórios', NULL, 54
  FROM public.app_modulo m
 WHERE m.codigo = 'controladoria'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('controladoria-tratamento-contratos', 'visualizar'),
  ('controladoria-tratamento-contratos', 'alterar')
ON CONFLICT DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'controladoria-tratamento-contratos', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('alterar'::public.app_acao)) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   DROP TABLE IF EXISTS public.controladoria_contrato_tratamento;
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'controladoria-tratamento-contratos';
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'controladoria-tratamento-contratos';
--   DELETE FROM public.app_menu WHERE codigo = 'controladoria-tratamento-contratos';
--   NOTIFY pgrst, 'reload schema';
