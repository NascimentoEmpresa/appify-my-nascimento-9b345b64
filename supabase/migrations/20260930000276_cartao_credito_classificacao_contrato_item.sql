-- SIS-2026-0568 (Iury): permitir que cada item da fatura do Cartão de
-- Crédito receba Classificação + Contrato — hoje `v_cartao_fatura_
-- fluxo_caixa` já tem essas colunas, mas hard-codadas como NULL/'Cartão de
-- Crédito' (20260930000060). Quem faz esse rateio na prática é o
-- Suprimentos (fora do ERP hoje, numa ferramenta desktop própria); decisão
-- confirmada com o usuário: "Centro de custo" do pedido = Contrato
-- (public.contratos), não a tabela centros_custo da Controladoria, e um
-- item precisa poder ser DIVIDIDO entre várias linhas de
-- Classificação+Contrato (rateio), não só 1 valor fixo por item.
--
-- Acesso: quem já tem 'alterar' em financeiro-cartao-credito continua
-- podendo classificar qualquer item. Além disso, o Financeiro pode liberar
-- usuários específicos (ex. alguém do Suprimentos) POR CARTÃO — lista em
-- malote_cartao_credito.usuarios_classificar_ids, mesmo padrão já usado em
-- planejamento_orcamentario_classificacao.aprovador1_user_ids (array +
-- cache de nomes, sem tabela de junção). A tela nova que esses usuários
-- vão usar (front, chamado separado da tela cheia de Cartão de Crédito)
-- tem seu próprio código de menu — a liberação de QUEM pode abrir essa
-- tela é via Gerenciamento de Acesso normal; este array aqui só filtra
-- QUAIS cartões, dentro da tela, cada um pode editar.

-- ── 1. Autorização por cartão ──────────────────────────────────────────
ALTER TABLE public.malote_cartao_credito
  ADD COLUMN usuarios_classificar_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN usuarios_classificar_nomes text[] NOT NULL DEFAULT '{}';

-- ── 2. Rateio por item (1 item pode virar N linhas) ─────────────────────
CREATE TABLE public.malote_cartao_fatura_item_rateio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.malote_cartao_fatura_item(id) ON DELETE CASCADE,
  classificacao_id uuid NOT NULL REFERENCES public.planejamento_orcamentario_classificacao(id),
  contrato_id uuid REFERENCES public.contratos(id),
  percentual numeric,
  valor numeric NOT NULL CHECK (valor >= 0),
  ordem int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mcfir_item ON public.malote_cartao_fatura_item_rateio(item_id);

CREATE TRIGGER malote_cartao_fatura_item_rateio_set_updated BEFORE UPDATE ON public.malote_cartao_fatura_item_rateio
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. Autorização — quem pode ver/editar o rateio de um item ───────────
-- 'alterar' em financeiro-cartao-credito (Financeiro) OU estar na lista de
-- autorizados do cartão dono do item (Suprimentos etc., por cartão).
CREATE OR REPLACE FUNCTION public.cartao_fatura_pode_classificar(_item_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.can_access(_user_id, 'financeiro-cartao-credito', 'alterar'::public.app_acao)
    OR EXISTS (
      SELECT 1 FROM public.malote_cartao_fatura_item fi
      JOIN public.malote_cartao_fatura f ON f.id = fi.fatura_id
      JOIN public.malote_cartao_credito cc ON cc.id = f.cartao_id
      WHERE fi.id = _item_id AND _user_id = ANY(cc.usuarios_classificar_ids)
    );
$$;

REVOKE ALL ON FUNCTION public.cartao_fatura_pode_classificar FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cartao_fatura_pode_classificar TO authenticated;

-- Sem isto, um usuário autorizado só pelo array (sem 'visualizar' no módulo
-- inteiro de Cartão de Crédito) não conseguiria NEM LER o cartão/fatura/item
-- pra classificar — as policies de SELECT existentes nessas 3 tabelas
-- (20260930000005/20260930000060) exigem can_access(...,'visualizar').
-- Policies adicionais são permissivas (Postgres faz OR entre elas pro mesmo
-- comando), então isto só AMPLIA quem lê, sem tocar no comportamento atual
-- de quem já tinha acesso ao módulo.
CREATE POLICY malote_cartao_credito_select_autorizado ON public.malote_cartao_credito
  FOR SELECT TO authenticated
  USING (auth.uid() = ANY(usuarios_classificar_ids));

CREATE POLICY malote_cartao_fatura_select_autorizado ON public.malote_cartao_fatura
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.malote_cartao_credito cc
    WHERE cc.id = malote_cartao_fatura.cartao_id AND auth.uid() = ANY(cc.usuarios_classificar_ids)
  ));

CREATE POLICY malote_cartao_fatura_item_select_autorizado ON public.malote_cartao_fatura_item
  FOR SELECT TO authenticated
  USING (public.cartao_fatura_pode_classificar(id, auth.uid()));

ALTER TABLE public.malote_cartao_fatura_item_rateio ENABLE ROW LEVEL SECURITY;

CREATE POLICY mcfir_select ON public.malote_cartao_fatura_item_rateio
  FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'financeiro-cartao-credito', 'visualizar'::public.app_acao)
    OR public.cartao_fatura_pode_classificar(item_id, auth.uid())
  );

CREATE POLICY mcfir_all_alterar ON public.malote_cartao_fatura_item_rateio
  FOR ALL TO authenticated
  USING (public.cartao_fatura_pode_classificar(item_id, auth.uid()))
  WITH CHECK (public.cartao_fatura_pode_classificar(item_id, auth.uid()));

-- ── 4. View do Fluxo de Caixa — Classificação/Contrato reais agora ─────
-- Item sem rateio: continua NULL/'Cartão de Crédito' (como hoje). Item com
-- 1 linha de rateio: mostra a Classificação/Contrato dessa linha. Item com
-- mais de 1 linha (dividido entre vários): mostra "Rateado (N)" em vez de
-- escolher 1 arbitrariamente ou duplicar a linha no Fluxo de Caixa.
CREATE OR REPLACE VIEW public.v_cartao_fatura_fluxo_caixa AS
SELECT
  fi.id AS despesa_id,
  cc.nome_cartao || ' — ' || to_char(f.competencia, 'MM/YYYY') AS id_malote,
  fi.data_compra AS data_pagamento,
  f.competencia,
  cc.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  (CASE WHEN r.qtd = 1 THEN r.contrato_unico ELSE NULL END) AS contrato_id,
  (CASE WHEN r.qtd = 1 THEN co.nome WHEN r.qtd > 1 THEN 'Rateado (' || r.qtd || ')' ELSE NULL END) AS contrato_nome,
  (CASE WHEN r.qtd = 1 THEN r.classificacao_unica ELSE NULL END) AS classificacao_id,
  (CASE WHEN r.qtd = 1 THEN cl.nome WHEN r.qtd > 1 THEN 'Rateado (' || r.qtd || ')' ELSE 'Cartão de Crédito' END) AS classificacao_nome,
  fi.descricao,
  cc.tipo_forma_pagamento AS forma_pagamento,
  cc.banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  fi.parcela_atual AS numero_parcela,
  fi.parcela_total AS numero_parcelas,
  fi.valor,
  'saida'::text AS tipo
FROM public.malote_cartao_fatura_item fi
JOIN public.malote_cartao_fatura f ON f.id = fi.fatura_id
JOIN public.malote_cartao_credito cc ON cc.id = f.cartao_id
LEFT JOIN public.empresas e ON e.id = cc.empresa_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = cc.banco_id
LEFT JOIN (
  SELECT item_id, count(*) AS qtd,
         (array_agg(contrato_id))[1] AS contrato_unico,
         (array_agg(classificacao_id))[1] AS classificacao_unica
  FROM public.malote_cartao_fatura_item_rateio
  GROUP BY item_id
) r ON r.item_id = fi.id
LEFT JOIN public.contratos co ON co.id = r.contrato_unico
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = r.classificacao_unica
WHERE fi.status = 'confirmado';

ALTER VIEW public.v_cartao_fatura_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_cartao_fatura_fluxo_caixa TO authenticated;

-- ── 5. Tela nova de classificação (fora da tela cheia de Cartão) ───────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'financeiro-cartao-credito-classificar', 'Financeiro — Classificar Lançamentos de Cartão',
       '/app/financeiro/gestao-financeira/cartao-credito/classificar', 35
FROM public.app_modulo m
WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('financeiro-cartao-credito-classificar', 'visualizar'),
  ('financeiro-cartao-credito-classificar', 'alterar')
ON CONFLICT DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'financeiro-cartao-credito-classificar', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('alterar'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'financeiro-cartao-credito-classificar';
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'financeiro-cartao-credito-classificar';
--   DELETE FROM public.app_menu WHERE codigo = 'financeiro-cartao-credito-classificar';
--   (recriar v_cartao_fatura_fluxo_caixa com o corpo de 20260930000060_cartao_fatura_import.sql)
--   DROP POLICY IF EXISTS malote_cartao_fatura_item_select_autorizado ON public.malote_cartao_fatura_item;
--   DROP POLICY IF EXISTS malote_cartao_fatura_select_autorizado ON public.malote_cartao_fatura;
--   DROP POLICY IF EXISTS malote_cartao_credito_select_autorizado ON public.malote_cartao_credito;
--   DROP FUNCTION IF EXISTS public.cartao_fatura_pode_classificar(uuid, uuid);
--   DROP TABLE IF EXISTS public.malote_cartao_fatura_item_rateio;
--   ALTER TABLE public.malote_cartao_credito DROP COLUMN IF EXISTS usuarios_classificar_ids;
--   ALTER TABLE public.malote_cartao_credito DROP COLUMN IF EXISTS usuarios_classificar_nomes;
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
