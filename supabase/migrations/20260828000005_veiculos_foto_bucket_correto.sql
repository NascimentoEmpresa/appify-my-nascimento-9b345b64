-- =====================================================================
-- AGENDAMENTO DE VEÍCULOS — a foto está no bucket do Patrimônio
--
-- A 20260828000004 apostou que a foto do veículo iria para um bucket novo
-- (`sup-veiculo-foto`). Não foi: o módulo de Patrimônio já grava em
-- `sup-patrimonio`, sob o prefixo `fotos/`. Adaptar-se a onde o arquivo
-- realmente está é mais barato do que mover arquivo e reescrever o outro
-- módulo — então o bucket novo, que nasceu vazio, é removido aqui.
--
-- O PROBLEMA E A SOLUÇÃO CIRÚRGICA
--
--   `sup-patrimonio` é privado porque guarda as NOTAS FISCAIS de manutenção,
--   e a policy de leitura exige can_access('sup_patrimonio'|'sup_manutencao').
--   O colaborador que só agenda carro não tem isso.
--
--   Liberar o bucket inteiro exporia as notas junto. Mas os dois tipos de
--   arquivo moram em prefixos diferentes, e isso resolve:
--
--     foto  → fotos/<patrimonio_id>/<uuid>.ext
--     nota  → <patrimonio_id>/<uuid>.ext      (useSupPatrimonio.ts:208)
--
--   Então a policy nova concede leitura APENAS de `fotos/%`, e apenas a quem
--   tem a tela de agendamento. Nota fiscal continua exatamente tão privada
--   quanto era — nenhuma policy existente foi alterada, só somou-se uma.
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS sup_patrim_storage_select_foto ON storage.objects;
-- =====================================================================

-- ── 1. Leitura só das fotos, só para quem agenda ─────────────────────
-- Policies de SELECT em storage.objects são somadas (OR): esta não afrouxa
-- nem substitui a `sup_patrim_storage_select` do Patrimônio, que segue
-- valendo para quem tem aquele módulo.
DROP POLICY IF EXISTS sup_patrim_storage_select_foto ON storage.objects;
CREATE POLICY sup_patrim_storage_select_foto ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'sup-patrimonio'
    AND name LIKE 'fotos/%'
    AND public.tem_acesso_menu('central_servicos_veiculos')
  );

-- ── 2. Desarma o bucket que a aposta errada criou ────────────────────
-- As policies de escrita saem, então nada mais consegue gravar nele. O
-- bucket em si NÃO é apagado aqui: o Supabase barra DELETE direto em
-- storage.buckets (storage.protect_delete), só a Storage API remove. Ele
-- nasceu vazio e fica inerte — sem policy de escrita, ninguém usa por
-- engano. Remover a casca vazia é um clique no painel de Storage.
DROP POLICY IF EXISTS sup_veic_foto_insert ON storage.objects;
DROP POLICY IF EXISTS sup_veic_foto_update ON storage.objects;
DROP POLICY IF EXISTS sup_veic_foto_delete ON storage.objects;

-- Deixa de ser público, para não passar a impressão de que ainda serve.
UPDATE storage.buckets SET public = false WHERE id = 'sup-veiculo-foto';

-- ── 3. Conferência ───────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_policy WHERE polname = 'sup_patrim_storage_select_foto') AS policy_foto_deve_ser_1,
  (SELECT count(*) FROM pg_policy WHERE polname LIKE 'sup_veic_foto%')              AS policies_orfas_deve_ser_0;

NOTIFY pgrst, 'reload schema';
