-- SIS-2026-0224: Submódulo Cartão de Crédito (Financeiro > Gestão
-- Financeira), abaixo de Fluxo de Caixa — pedido do Iury pra conferência
-- de faturas.
--
-- "Nome no Malote (Tipo)" do cadastro do cartão é literalmente um valor de
-- malote_tipo_forma_pagamento — confirmado lendo CriarDespesa.tsx: o
-- Select de "Forma de pagamento" da despesa usa esse catálogo, não
-- malote_forma_pagamento (que é um catálogo auxiliar solto, não tocado
-- aqui). Ligar o cartão a esse mesmo valor é o que permite casar
-- malote_despesa.forma_pagamento com o cartão certo, sem heurística de
-- string.

CREATE TABLE public.malote_cartao_credito (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_cartao text NOT NULL,
  tipo_forma_pagamento text NOT NULL REFERENCES public.malote_tipo_forma_pagamento(nome) ON UPDATE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  banco text NOT NULL,
  bandeira text NOT NULL CHECK (bandeira IN ('Visa', 'Mastercard', 'Elo', 'American Express', 'Diners Club')),
  dia_fechamento smallint NOT NULL CHECK (dia_fechamento BETWEEN 1 AND 31),
  dia_vencimento smallint NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
  limite numeric(14, 2) NOT NULL CHECK (limite >= 0),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

-- Regra 4 do Anexo 1: não permitir dois cartões ATIVOS com a mesma
-- combinação Empresa + Nome no Malote (Tipo). Parcial em "ativo" pra
-- permitir reativar/recriar depois de inativar um cartão antigo.
CREATE UNIQUE INDEX malote_cartao_credito_empresa_tipo_ativo_key
  ON public.malote_cartao_credito (empresa_id, tipo_forma_pagamento)
  WHERE ativo;

ALTER TABLE public.malote_cartao_credito ENABLE ROW LEVEL SECURITY;

CREATE POLICY malote_cartao_credito_select ON public.malote_cartao_credito
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-cartao-credito', 'visualizar'::public.app_acao));

CREATE POLICY malote_cartao_credito_insert ON public.malote_cartao_credito
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'financeiro-cartao-credito', 'incluir'::public.app_acao));

CREATE POLICY malote_cartao_credito_update ON public.malote_cartao_credito
  FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao));

CREATE POLICY malote_cartao_credito_delete ON public.malote_cartao_credito
  FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-cartao-credito', 'excluir'::public.app_acao));

-- ── app_menu + perfil_acesso_permissao (mesmo padrão de 20260907000002) ──
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'financeiro-cartao-credito', 'Financeiro — Cartão de Crédito', '/app/financeiro/gestao-financeira/cartao-credito', 34
FROM public.app_modulo m
WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'financeiro-cartao-credito', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('incluir'::public.app_acao),
    ('alterar'::public.app_acao),
    ('excluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'financeiro-cartao-credito';
--   DELETE FROM public.app_menu WHERE codigo = 'financeiro-cartao-credito';
--   DROP TABLE IF EXISTS public.malote_cartao_credito;
-- =====================================================================
