-- Pedido urgente do Ruan (validação de notas): opção "Não reter" no INSS por item, para as
-- notas fiscais de MATERIAL do SEMAE, que não têm retenção de INSS.
--
-- inss_categoria é text com CHECK nas duas tabelas que a usam; o CHECK é recriado com o novo valor
-- 'nao_reter'. A alíquota (0%) vive no código (calculos.ts), como as demais categorias.
-- Os nomes dos CHECKs antigos não foram dados (vieram inline no ADD COLUMN), então são achados no catálogo.

-- Rodar fora de pico: o ADD CONSTRAINT valida os itens existentes com a tabela travada. lock_timeout faz a
-- migration desistir em 5 s em vez de travar as gravações de NF; se estourar, é só rodar de novo.
SET lock_timeout = '5s';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tabela, c.conname
      FROM pg_constraint c
     WHERE c.contype = 'c'
       AND c.conrelid IN ('public.nf_emissao_item'::regclass, 'public.nf_emissao_modelo_item'::regclass)
       AND pg_get_constraintdef(c.oid) ILIKE '%inss_categoria%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tabela, r.conname);
  END LOOP;
END $$;

ALTER TABLE public.nf_emissao_item
  ADD CONSTRAINT nf_emissao_item_inss_categoria_check
  CHECK (inss_categoria IN ('normais', 'insalubridade_20', 'periculosidade_30', 'insalubridade_40', 'nao_reter'));

ALTER TABLE public.nf_emissao_modelo_item
  ADD CONSTRAINT nf_emissao_modelo_item_inss_categoria_check
  CHECK (inss_categoria IN ('normais', 'insalubridade_20', 'periculosidade_30', 'insalubridade_40', 'nao_reter'));

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (só se nenhum item usar 'nao_reter'; senão migrar esses itens antes)
--   ALTER TABLE public.nf_emissao_item DROP CONSTRAINT IF EXISTS nf_emissao_item_inss_categoria_check;
--   ALTER TABLE public.nf_emissao_item ADD CONSTRAINT nf_emissao_item_inss_categoria_check
--     CHECK (inss_categoria IN ('normais','insalubridade_20','periculosidade_30','insalubridade_40'));
--   ALTER TABLE public.nf_emissao_modelo_item DROP CONSTRAINT IF EXISTS nf_emissao_modelo_item_inss_categoria_check;
--   ALTER TABLE public.nf_emissao_modelo_item ADD CONSTRAINT nf_emissao_modelo_item_inss_categoria_check
--     CHECK (inss_categoria IN ('normais','insalubridade_20','periculosidade_30','insalubridade_40'));
--   NOTIFY pgrst, 'reload schema';
