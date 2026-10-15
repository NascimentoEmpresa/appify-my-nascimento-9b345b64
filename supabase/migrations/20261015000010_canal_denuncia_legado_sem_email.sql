-- =========================================================================
-- CANAL DE DENÚNCIA — denúncias migradas sem e-mail (15/10/2026)
--
-- Chamado SIS-2026-0625 ("Importar as denúncias antigas para o sistema"):
-- os 13 processos da planilha do Comitê de Ética (Contato Seguro, PIA, PA,
-- Fala.BR) entram em CANAL_DENUNCIA. A regra canal_denuncia_anonimo_chk
-- exigia e-mail de toda denúncia não anônima — feita para o canal web, onde
-- quem se identifica deixa e-mail para acompanhar o caso. Os casos antigos
-- têm o denunciante identificado na planilha, mas sem e-mail; marcá-los como
-- anônimos esconderia o nome na ficha ("Relato anônimo").
--
-- Agora: e-mail continua obrigatório para não anônima do canal web
-- (origem = 'canal_web'); nas demais origens pode faltar.
--
-- Os DADOS das denúncias não estão neste arquivo (conteúdo sigiloso — não vai
-- para o git): foram gravados direto no banco em 15/10/2026, protocolos
-- CE-2026-001 a CE-2026-013, com os documentos das pastas no bucket
-- denuncia-evidencias.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

ALTER TABLE public."CANAL_DENUNCIA" DROP CONSTRAINT IF EXISTS canal_denuncia_anonimo_chk;
ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_anonimo_chk CHECK (
  (anonimo AND email IS NULL)
  OR (NOT anonimo AND (email IS NOT NULL OR coalesce(origem, 'canal_web') <> 'canal_web'))
);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public."CANAL_DENUNCIA" DROP CONSTRAINT IF EXISTS canal_denuncia_anonimo_chk;
-- ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_anonimo_chk CHECK (((anonimo AND (email IS NULL)) OR ((NOT anonimo) AND (email IS NOT NULL))));
