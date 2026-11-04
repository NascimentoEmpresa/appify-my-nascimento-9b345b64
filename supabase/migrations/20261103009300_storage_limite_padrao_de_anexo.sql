-- =========================================================================
-- LIMITE DE TAMANHO EM TODO CAMPO DE ANEXO (03/11/2026, item 10)
--
-- Regra do Eduardo: 10 MB por padrão, 25 MB para documentos e currículos.
-- O frontend confere ANTES de enviar (src/lib/limiteAnexo.ts); esta
-- migration é a garantia no servidor — o Storage recusa (413) o que passar
-- de storage.buckets.file_size_limit, venha de onde vier.
--
-- Levantamento na produção em 03/11/2026 (57 buckets): 19 SEM LIMITE
-- nenhum, e 4 com limite acima de 25 MB (whatsapp-midia 100 MB,
-- denuncia-evidencias 50 MB, caepi 60 MB, migracao-zero 1 GB).
--
-- Critério:
--   - nunca AUMENTA um limite que já existe e é menor;
--   - sem limite ou acima de 25 MB -> 25 MB se o bucket guarda documento
--     (comprovante, contrato, currículo, planilha, fatura), 10 MB se guarda
--     imagem/foto/áudio/miscelânea;
--   - os três de VÍDEO de treinamento/TV ficam como estão (treinamentos
--     200 MB, trn-midia 500 MB, tv-midia 200 MB): há aulas de 67 MB e 243 MB
--     no ar, e 25 MB quebraria o envio de qualquer aula nova. Decisão
--     pendente com o Eduardo — ver docs/infra/limite-de-anexo.md.
--
-- Arquivos JÁ guardados acima do novo limite continuam onde estão (o limite
-- vale para envio novo): checklist-faturamento-anexos tem 5 acima de 25 MB
-- (maior 91 MB), juridico-docs 2 (maior 35 MB), migracao-zero 4 (48 MB).
-- =========================================================================

-- Documentos: 25 MB
UPDATE storage.buckets SET file_size_limit = 25 * 1024 * 1024
 WHERE id IN (
   'malote-anexos', 'curriculos', 'checklist-faturamento-anexos',
   'solicitacoes-ajuste-anexos', 'juridico-docs', 'pre-titulos-fiscal',
   'extrator-beneficios', 'fcr-uploads', 'cartao-faturas',
   'whatsapp-midia', 'denuncia-evidencias', 'caepi', 'migracao-zero'
 )
   AND (file_size_limit IS NULL OR file_size_limit > 25 * 1024 * 1024);

-- Imagem, foto, áudio, XML e o resto: 10 MB
UPDATE storage.buckets SET file_size_limit = 10 * 1024 * 1024
 WHERE id IN (
   'sup-comprovacoes', 'sup-crachas', 'avatars', 'cartao-logos',
   'colaboradores-fotos', 'bi-capas', 'sup-veiculo-foto', 'nfe-xml',
   'copiloto-audios', 'identidade-visual'
 )
   AND (file_size_limit IS NULL OR file_size_limit > 10 * 1024 * 1024);

-- Rede de segurança: bucket que exista e não esteja em lista nenhuma (criado
-- por migration futura sem file_size_limit) recebe o padrão de 10 MB, menos
-- os três de vídeo.
UPDATE storage.buckets SET file_size_limit = 10 * 1024 * 1024
 WHERE file_size_limit IS NULL
   AND id NOT IN ('treinamentos', 'trn-midia', 'tv-midia');

-- Conferência: nenhum bucket sem limite, e nenhum acima de 25 MB fora os de vídeo.
DO $$
DECLARE r text;
BEGIN
  SELECT string_agg(id, ', ') INTO r FROM storage.buckets
   WHERE file_size_limit IS NULL
      OR (file_size_limit > 25 * 1024 * 1024 AND id NOT IN ('treinamentos', 'trn-midia', 'tv-midia'));
  IF r IS NOT NULL THEN
    RAISE EXCEPTION 'buckets fora da regra de tamanho: %', r;
  END IF;
END $$;

-- ROLLBACK (limites anteriores, levantados em 03/11/2026)
-- UPDATE storage.buckets SET file_size_limit = NULL WHERE id IN ('malote-anexos','curriculos','checklist-faturamento-anexos','solicitacoes-ajuste-anexos','juridico-docs','pre-titulos-fiscal','extrator-beneficios','fcr-uploads','cartao-faturas','sup-comprovacoes','sup-crachas','avatars','cartao-logos','colaboradores-fotos','bi-capas','sup-veiculo-foto','nfe-xml','copiloto-audios','identidade-visual');
-- UPDATE storage.buckets SET file_size_limit = 104857600  WHERE id = 'whatsapp-midia';
-- UPDATE storage.buckets SET file_size_limit = 52428800   WHERE id = 'denuncia-evidencias';
-- UPDATE storage.buckets SET file_size_limit = 62914560   WHERE id = 'caepi';
-- UPDATE storage.buckets SET file_size_limit = 1073741824 WHERE id = 'migracao-zero';
