-- SIS-2026-0702 (Iury): as classificações do novo Orçamento Administrativo / Sócios vêm do NOME DA CLASSIFICAÇÃO MALOTE
-- (planejamento_orcamentario_classificacao), não do catálogo Classificação Administrativo. Motivo: o Orçamento Administrativo atual será
-- descontinuado e, com ele, a ligação Administrativo → Malote que hoje alimenta o Orçamento Geral; o módulo novo não pode depender disso.
-- A chave da linha passa a ser classificacao_malote_id. O "utilizado" também deixa de passar pela ligação: é apurado direto pela
-- classificação do Malote.
--
-- Idempotente: se a coluna antiga já saiu, só garante a carga das classificações do Malote.

DO $mig$
BEGIN
  ALTER TABLE public.orcamento_adm_socios_linha
    ADD COLUMN IF NOT EXISTS classificacao_malote_id uuid REFERENCES public.planejamento_orcamentario_classificacao(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'orcamento_adm_socios_linha' AND column_name = 'classificacao_administrativa_id') THEN
    -- o que já foi configurado acompanha a ligação Administrativo → Malote
    UPDATE public.orcamento_adm_socios_linha l
       SET classificacao_malote_id = k.classificacao_malote_id
      FROM public.malote_administrativo_classificacao_link k
     WHERE k.classificacao_administrativa_id = l.classificacao_administrativa_id
       AND l.classificacao_malote_id IS NULL;

    -- sem ligação não há como saber a classificação do Malote: some a linha (era carga inicial; a nova carga abaixo repõe tudo)
    DELETE FROM public.orcamento_adm_socios_linha WHERE classificacao_malote_id IS NULL;

    -- duas administrativas ligadas à mesma do Malote: fica a primeira de cada aba
    DELETE FROM public.orcamento_adm_socios_linha a
     USING public.orcamento_adm_socios_linha b
     WHERE a.tipo = b.tipo AND a.classificacao_malote_id = b.classificacao_malote_id AND a.ctid > b.ctid;

    ALTER TABLE public.orcamento_adm_socios_linha DROP COLUMN classificacao_administrativa_id;
  END IF;
END
$mig$;

ALTER TABLE public.orcamento_adm_socios_linha ALTER COLUMN classificacao_malote_id SET NOT NULL;

ALTER TABLE public.orcamento_adm_socios_linha DROP CONSTRAINT IF EXISTS orcamento_adm_socios_linha_tipo_malote_key;
ALTER TABLE public.orcamento_adm_socios_linha
  ADD CONSTRAINT orcamento_adm_socios_linha_tipo_malote_key UNIQUE (tipo, classificacao_malote_id);

-- carga: todas as Classificações Malote ativas (Administrativo e Contrato)
INSERT INTO public.orcamento_adm_socios_linha (tipo, classificacao_malote_id)
SELECT t.tipo, c.id
  FROM public.planejamento_orcamentario_classificacao c
 CROSS JOIN (VALUES ('administrativo'), ('socios')) AS t(tipo)
 WHERE c.ativo
ON CONFLICT (tipo, classificacao_malote_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK (volta a chave para a classificação administrativa ligada; perde linhas sem ligação)
--   ALTER TABLE public.orcamento_adm_socios_linha ADD COLUMN classificacao_administrativa_id uuid
--     REFERENCES public.malote_classificacao_administrativo(id) ON DELETE CASCADE;
--   UPDATE public.orcamento_adm_socios_linha l SET classificacao_administrativa_id = k.classificacao_administrativa_id
--     FROM public.malote_administrativo_classificacao_link k WHERE k.classificacao_malote_id = l.classificacao_malote_id;
--   DELETE FROM public.orcamento_adm_socios_linha WHERE classificacao_administrativa_id IS NULL;
--   ALTER TABLE public.orcamento_adm_socios_linha DROP CONSTRAINT orcamento_adm_socios_linha_tipo_malote_key;
--   ALTER TABLE public.orcamento_adm_socios_linha DROP COLUMN classificacao_malote_id;
--   ALTER TABLE public.orcamento_adm_socios_linha ALTER COLUMN classificacao_administrativa_id SET NOT NULL;
--   ALTER TABLE public.orcamento_adm_socios_linha ADD UNIQUE (tipo, classificacao_administrativa_id);
-- =====================================================================
