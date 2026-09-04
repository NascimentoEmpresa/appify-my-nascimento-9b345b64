-- SIS-2026-0304 (achado testando com o usuário): o trigger
-- checklist_fat_marcacao_set_updated usava a função genérica
-- public.set_updated_at(), que faz `NEW.updated_at = now()` — mas
-- "CHECKLIST_FATURAMENTO_MARCACAO" usa a coluna em português
-- `atualizado_em`, não `updated_at`. Resultado: a 1ª marcação de status
-- (INSERT) funcionava, mas qualquer mudança seguinte (UPDATE via
-- ON CONFLICT DO UPDATE) quebrava com `record "new" has no field
-- "updated_at"` — sintoma relatado como "não consigo mudar depois que
-- vira 'a conferir'".
--
-- O client já seta atualizado_em manualmente em cada upsert
-- (useAtualizarMarcacao, useChecklistFaturamento.ts) — o trigger era
-- redundante além de quebrado. Só remove, sem substituir.
DROP TRIGGER IF EXISTS checklist_fat_marcacao_set_updated ON public."CHECKLIST_FATURAMENTO_MARCACAO";

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   CREATE TRIGGER checklist_fat_marcacao_set_updated BEFORE UPDATE ON public."CHECKLIST_FATURAMENTO_MARCACAO"
--     FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--   -- (não recomendado reverter — reintroduz o bug; só documentado por padrão)
-- =====================================================================
