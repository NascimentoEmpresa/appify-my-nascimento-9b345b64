-- ============================================================================
-- SIS-2026-0793 — Fechamento da Empresa: coluna Receitas Extras (entradas dos administrativos)
-- ============================================================================
-- O Fechamento ganha as colunas "Receitas Extras" e "Resultado após Outras Receitas". Receitas Extras soma as ENTRADAS do Fluxo de Caixa dos
-- contratos "ADMINISTRATIVO - …" das empresas e as sem contrato. O chamado diz "todas as entradas" sem dizer quais valores contribuem, então o
-- padrão é: contam todas, menos as classificações que não são custo (transferência, aplicação, resgate, empréstimo, financiamento, recebimento
-- de nota, distribuição) e as marcadas "Não é custo" na Lucratividade. Esta tabela guarda o AJUSTE manual da Controladoria, só do Fechamento:
--
--   fechamento_receita_extra_classificacao   classificação → conta (true: sempre conta) / não conta (false: nunca conta).
--                                            Sem linha, vale o padrão acima.
--
-- Acesso: o mesmo menu fantasma 'fechamento-empresa-despesa-adm' (alterar) da migration do ajuste do Total Desp. Adm (20261103005200), que também
-- cria a regra de leitura por 'fechamento-empresa'. Sem esta migration o Fechamento funciona como antes, sem os ajustes.
--
-- Migration leve (1 tabela pequena): pode rodar inteira de uma vez.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.fechamento_receita_extra_classificacao;
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.fechamento_receita_extra_classificacao (
  classificacao_id uuid PRIMARY KEY REFERENCES public.planejamento_orcamentario_classificacao(id) ON DELETE CASCADE,
  conta boolean NOT NULL,
  updated_by uuid DEFAULT auth.uid(), -- sem FK para auth.users: a FK trava a tabela do Auth ao aplicar com o ERP em uso
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fechamento_receita_extra_classificacao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fechamento_receita_extra_select ON public.fechamento_receita_extra_classificacao;
CREATE POLICY fechamento_receita_extra_select ON public.fechamento_receita_extra_classificacao
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'fechamento-empresa', 'visualizar'::public.app_acao));

DROP POLICY IF EXISTS fechamento_receita_extra_insert ON public.fechamento_receita_extra_classificacao;
CREATE POLICY fechamento_receita_extra_insert ON public.fechamento_receita_extra_classificacao
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'fechamento-empresa-despesa-adm', 'alterar'::public.app_acao));

DROP POLICY IF EXISTS fechamento_receita_extra_update ON public.fechamento_receita_extra_classificacao;
CREATE POLICY fechamento_receita_extra_update ON public.fechamento_receita_extra_classificacao
  FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'fechamento-empresa-despesa-adm', 'alterar'::public.app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'fechamento-empresa-despesa-adm', 'alterar'::public.app_acao));

DROP POLICY IF EXISTS fechamento_receita_extra_delete ON public.fechamento_receita_extra_classificacao;
CREATE POLICY fechamento_receita_extra_delete ON public.fechamento_receita_extra_classificacao
  FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'fechamento-empresa-despesa-adm', 'alterar'::public.app_acao));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fechamento_receita_extra_classificacao TO authenticated;

NOTIFY pgrst, 'reload schema';
