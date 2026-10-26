-- =========================================================================
-- RH › Rateio de Despesas: "new row violates row-level security policy" ao
-- salvar (rascunho ou conferido) com PDF anexado — 21/10/2026.
--
-- O QUE ACONTECE
-- A gravação em si é pela RPC rh_rateio_salvar (SECURITY DEFINER, sem RLS
-- no caminho). O que quebra é o passo anterior: subirAnexoRateio() faz o
-- upload no bucket `rh-rateio`, e o storage devolve a frase de RLS — a
-- storage-api traduz qualquer 42501 nela.
--
-- POR QUE SÓ NO CLUSTER
-- A mig 20261016000010 entrou na Supabase no dia da virada. As policies do
-- schema `storage` chegaram ao cluster pelo restore do schema, que é
-- ANTERIOR a ela; o passo de auth/storage (carregar-auth-storage.sh) é
-- --data-only e trouxe a LINHA do bucket, não as policies. E o livro de
-- migrations foi semeado dando a 20261016000010 por aplicada. Resultado:
-- bucket existe, RLS de storage.objects ligada, nenhuma policy de INSERT
-- para `rh-rateio` → nega tudo, inclusive para quem tem incluir/alterar.
--
-- Aqui só se recria o que a 20261016000010 já fazia (mesmos nomes, mesmas
-- regras). Idempotente: na Supabase antiga é um no-op.
-- =========================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('rh-rateio', 'rh-rateio', false, 20971520) -- 20 MB
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "rh rateio anexo select" ON storage.objects;
CREATE POLICY "rh rateio anexo select" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'rh-rateio' AND (select public.rh_rateio_pode('visualizar')));
DROP POLICY IF EXISTS "rh rateio anexo insert" ON storage.objects;
CREATE POLICY "rh rateio anexo insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'rh-rateio' AND ((select public.rh_rateio_pode('incluir')) OR (select public.rh_rateio_pode('alterar'))));
DROP POLICY IF EXISTS "rh rateio anexo delete" ON storage.objects;
CREATE POLICY "rh rateio anexo delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'rh-rateio' AND ((select public.rh_rateio_pode('excluir')) OR (select public.rh_rateio_pode('alterar'))));

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (volta ao estado quebrado do cluster — não usar sem motivo)
-- DROP POLICY IF EXISTS "rh rateio anexo select" ON storage.objects;
-- DROP POLICY IF EXISTS "rh rateio anexo insert" ON storage.objects;
-- DROP POLICY IF EXISTS "rh rateio anexo delete" ON storage.objects;
