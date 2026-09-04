-- SIS-2026-0255 (Iury): Importar fatura do Cartão de Crédito. Botão
-- "Importar Fatura" em CartaoCredito.tsx (mesmo espírito de "Importar" já
-- usado em Planilha de Custo) — usuário anexa o arquivo da fatura do mês,
-- confere/edita os lançamentos numa tabela, confirma. A 1ª vez que uma
-- compra parcelada aparece, o sistema PROJETA as parcelas seguintes pros
-- meses futuros (fatura "projetada"); ao importar de fato o mês futuro, o
-- sistema tenta casar as linhas novas com as projeções já existentes
-- (mesma parcela esperada + descrição parecida) — decisão confirmada com o
-- usuário: em caso de ambiguidade, falha pro lado seguro ("não encontrada",
-- resolve na tela).
--
-- 3 bancos com adaptador no v1 (únicos com amostra real de fatura):
-- Banrisul e Banco do Brasil (Excel), Bradesco (HTML — só isso ou PDF
-- disponível pelo banco, e HTML é MUITO mais confiável de parsear que
-- texto solto de PDF, sem precisar de lib nova). Sicredi ficou de fora —
-- aquele cartão sempre passa pelo Malote, confirmado com o usuário.
--
-- Acesso: mesma tela/mesma ação de malote_cartao_credito
-- ('financeiro-cartao-credito'), sem menu novo nem ação nova — decisão do
-- usuário (quem já edita cartão também importa fatura).

-- ── 1. Tabelas ───────────────────────────────────────────────────────────
CREATE TABLE public.malote_cartao_fatura (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cartao_id uuid NOT NULL REFERENCES public.malote_cartao_credito(id),
  competencia date NOT NULL, -- sempre dia 01, mesmo padrão de malote_despesa.competencia
  arquivo_original_path text, -- storage do último arquivo importado (bucket privado cartao-faturas)
  valor_total numeric NOT NULL DEFAULT 0, -- soma dos itens confirmados, cache
  status text NOT NULL DEFAULT 'projetada' CHECK (status IN ('projetada', 'importada')),
  -- 'projetada': só existe porque uma parcela de um mês anterior projetou a
  -- parcela seguinte pra cá — ninguém importou arquivo desta competência
  -- ainda. 'importada': já passou pela tela de conferência e foi confirmada.
  importado_em timestamptz,
  importado_por uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cartao_id, competencia)
);

CREATE TABLE public.malote_cartao_fatura_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fatura_id uuid NOT NULL REFERENCES public.malote_cartao_fatura(id) ON DELETE CASCADE,
  -- Identidade estável de uma compra parcelada através dos meses — gerada
  -- na 1ª parcela vista, reaproveitada nas projeções/confirmações
  -- seguintes da MESMA compra. Compra não parcelada: compra_id novo, sem
  -- precisar "seguir" pra lugar nenhum.
  compra_id uuid NOT NULL,
  descricao text NOT NULL,
  data_compra date,
  valor numeric NOT NULL,
  parcela_atual int, -- null = não parcelada
  parcela_total int, -- null = não parcelada
  origem text NOT NULL DEFAULT 'importado' CHECK (origem IN ('importado', 'projetado', 'manual')),
  status text NOT NULL DEFAULT 'confirmado' CHECK (status IN ('confirmado', 'pendente_confirmacao')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Uma compra só pode aparecer 1 vez em cada fatura — também é o que
  -- permite `ON CONFLICT (fatura_id, compra_id) DO NOTHING` na projeção
  -- (RPC abaixo) sem precisar de SELECT de existência antes.
  UNIQUE (fatura_id, compra_id)
);

CREATE INDEX idx_malote_cartao_fatura_item_compra ON public.malote_cartao_fatura_item(compra_id);
CREATE INDEX idx_malote_cartao_fatura_cartao ON public.malote_cartao_fatura(cartao_id);

CREATE TRIGGER malote_cartao_fatura_item_set_updated BEFORE UPDATE ON public.malote_cartao_fatura_item
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. RLS — mesma policy de malote_cartao_credito, mesma tela ─────────────
ALTER TABLE public.malote_cartao_fatura ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.malote_cartao_fatura_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY malote_cartao_fatura_select ON public.malote_cartao_fatura
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-cartao-credito', 'visualizar'::public.app_acao));

CREATE POLICY malote_cartao_fatura_all_alterar ON public.malote_cartao_fatura
  FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao));

CREATE POLICY malote_cartao_fatura_item_select ON public.malote_cartao_fatura_item
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-cartao-credito', 'visualizar'::public.app_acao));

CREATE POLICY malote_cartao_fatura_item_all_alterar ON public.malote_cartao_fatura_item
  FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao));

-- ── 3. Storage — bucket privado (extrato de fatura é dado financeiro
-- sensível, diferente do bucket público cartao-logos) ─────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('cartao-faturas', 'cartao-faturas', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY cartao_faturas_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'cartao-faturas' AND public.can_access(auth.uid(), 'financeiro-cartao-credito', 'visualizar'::public.app_acao));

CREATE POLICY cartao_faturas_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cartao-faturas' AND public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao));

-- ── 4. View pro Fluxo de Caixa — 1 linha por item CONFIRMADO ──────────────
-- Colunas alinhadas com FluxoCaixaMaloteLinha (parcela/banco já existem de
-- verdade aqui, diferente do Débito Automático).
CREATE VIEW public.v_cartao_fatura_fluxo_caixa AS
SELECT
  fi.id AS despesa_id,
  cc.nome_cartao || ' — ' || to_char(f.competencia, 'MM/YYYY') AS id_malote,
  fi.data_compra AS data_pagamento,
  f.competencia,
  cc.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  NULL::uuid AS contrato_id,
  NULL::text AS contrato_nome,
  NULL::uuid AS classificacao_id,
  'Cartão de Crédito'::text AS classificacao_nome,
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
WHERE fi.status = 'confirmado';

ALTER VIEW public.v_cartao_fatura_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_cartao_fatura_fluxo_caixa TO authenticated;

-- ── 5. RPC — confirmar importação (persiste os itens revisados + projeta
-- as parcelas futuras), tudo numa transação só ────────────────────────────
-- _itens: array de objetos revisados pelo usuário na tela de conferência —
--   {id (uuid|null, null = item novo), compra_id (uuid), descricao,
--    data_compra (date|null), valor, parcela_atual (int|null),
--    parcela_total (int|null), origem ('importado'|'manual')}
-- _itens_excluir_ids: ids de item que o usuário removeu na revisão (ex.
--   projeção que ele decidiu que não existe mais) — deletados de verdade.
CREATE OR REPLACE FUNCTION public.cartao_fatura_confirmar_importacao(
  _cartao_id uuid, _competencia date, _arquivo_path text,
  _itens jsonb, _itens_excluir_ids uuid[] DEFAULT '{}'::uuid[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_fatura_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_compra_id uuid;
  v_descricao text;
  v_data_compra date;
  v_valor numeric;
  v_parcela_atual int;
  v_parcela_total int;
  v_origem text;
  v_p int;
  v_competencia_futura date;
  v_fatura_futura_id uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para importar fatura.';
  END IF;

  INSERT INTO public.malote_cartao_fatura (cartao_id, competencia, arquivo_original_path, status, importado_em, importado_por)
  VALUES (_cartao_id, _competencia, _arquivo_path, 'importada', now(), auth.uid())
  ON CONFLICT (cartao_id, competencia) DO UPDATE SET
    arquivo_original_path = EXCLUDED.arquivo_original_path,
    status = 'importada',
    importado_em = now(),
    importado_por = auth.uid()
  RETURNING id INTO v_fatura_id;

  IF array_length(_itens_excluir_ids, 1) > 0 THEN
    DELETE FROM public.malote_cartao_fatura_item
    WHERE fatura_id = v_fatura_id AND id = ANY(_itens_excluir_ids);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    v_item_id       := NULLIF(v_item->>'id', '')::uuid;
    v_compra_id     := (v_item->>'compra_id')::uuid;
    v_descricao     := v_item->>'descricao';
    v_data_compra   := NULLIF(v_item->>'data_compra', '')::date;
    v_valor         := (v_item->>'valor')::numeric;
    v_parcela_atual := NULLIF(v_item->>'parcela_atual', '')::int;
    v_parcela_total := NULLIF(v_item->>'parcela_total', '')::int;
    v_origem        := COALESCE(v_item->>'origem', 'importado');

    INSERT INTO public.malote_cartao_fatura_item (
      id, fatura_id, compra_id, descricao, data_compra, valor,
      parcela_atual, parcela_total, origem, status
    ) VALUES (
      COALESCE(v_item_id, gen_random_uuid()), v_fatura_id, v_compra_id, v_descricao, v_data_compra, v_valor,
      v_parcela_atual, v_parcela_total, v_origem, 'confirmado'
    )
    ON CONFLICT (id) DO UPDATE SET
      descricao = EXCLUDED.descricao,
      data_compra = EXCLUDED.data_compra,
      valor = EXCLUDED.valor,
      parcela_atual = EXCLUDED.parcela_atual,
      parcela_total = EXCLUDED.parcela_total,
      origem = EXCLUDED.origem,
      status = 'confirmado';

    -- Projeta as parcelas seguintes (mês a mês), só quando ainda não
    -- chegou na última — ON CONFLICT (fatura_id, compra_id) DO NOTHING
    -- garante que não duplica se a projeção já existir (de uma importação
    -- anterior desta mesma compra).
    IF v_parcela_atual IS NOT NULL AND v_parcela_total IS NOT NULL AND v_parcela_atual < v_parcela_total THEN
      FOR v_p IN (v_parcela_atual + 1)..v_parcela_total LOOP
        v_competencia_futura := (_competencia + make_interval(months => v_p - v_parcela_atual))::date;

        INSERT INTO public.malote_cartao_fatura (cartao_id, competencia)
        VALUES (_cartao_id, v_competencia_futura)
        ON CONFLICT (cartao_id, competencia) DO NOTHING;

        SELECT id INTO v_fatura_futura_id FROM public.malote_cartao_fatura
          WHERE cartao_id = _cartao_id AND competencia = v_competencia_futura;

        INSERT INTO public.malote_cartao_fatura_item (
          fatura_id, compra_id, descricao, data_compra, valor,
          parcela_atual, parcela_total, origem, status
        ) VALUES (
          v_fatura_futura_id, v_compra_id, v_descricao, v_data_compra, v_valor,
          v_p, v_parcela_total, 'projetado', 'pendente_confirmacao'
        )
        ON CONFLICT (fatura_id, compra_id) DO NOTHING;
      END LOOP;
    END IF;
  END LOOP;

  UPDATE public.malote_cartao_fatura SET valor_total = (
    SELECT COALESCE(sum(valor), 0) FROM public.malote_cartao_fatura_item
    WHERE fatura_id = v_fatura_id AND status = 'confirmado'
  ) WHERE id = v_fatura_id;

  RETURN v_fatura_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cartao_fatura_confirmar_importacao FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cartao_fatura_confirmar_importacao TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.cartao_fatura_confirmar_importacao(uuid, date, text, jsonb, uuid[]);
--   DROP VIEW IF EXISTS public.v_cartao_fatura_fluxo_caixa;
--   DROP POLICY IF EXISTS cartao_faturas_insert ON storage.objects;
--   DROP POLICY IF EXISTS cartao_faturas_select ON storage.objects;
--   DELETE FROM storage.objects WHERE bucket_id = 'cartao-faturas';
--   DELETE FROM storage.buckets WHERE id = 'cartao-faturas';
--   DROP TABLE IF EXISTS public.malote_cartao_fatura_item;
--   DROP TABLE IF EXISTS public.malote_cartao_fatura;
-- =====================================================================
