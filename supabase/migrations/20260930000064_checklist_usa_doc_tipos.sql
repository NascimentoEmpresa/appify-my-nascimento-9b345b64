-- SIS-2026-0304 (achado revisando com o usuário depois de implementar): o
-- ERP já tem um catálogo de tipos de documento + configuração por
-- contrato — `doc_tipos` (por empresa, 51 tipos × 6 empresas, batendo
-- quase 1:1 com o catálogo que migrei do legado) e `contrato_docs_config`
-- (vínculo Contrato × Tipo, com periodicidade/recorrência — mais rico que
-- o "ordem" que eu tinha, e sem NENHUM dado real ainda, 0 linhas).
-- Construí um catálogo paralelo (CHECKLIST_FATURAMENTO_DOC +
-- CHECKLIST_FATURAMENTO_CONTRATO_DOC) sem saber que esse já existia —
-- decisão confirmada com o usuário: consolidar no catálogo existente em
-- vez de manter dois catálogos de documento parecidos no sistema.
--
-- CHECKLIST_FATURAMENTO_MARCACAO/_ANEXO já tinham dado REAL do usuário
-- testando a tela (21 marcações + 1 anexo) — remapeados pro doc_tipos
-- certo (mesmo nome, empresa do contrato da linha) antes de trocar a FK,
-- não é reseed do zero.

-- ── 1. Doc que faltava no catálogo (achado comparando os 52 do legado
-- com os 51 já existentes em doc_tipos) — cria pras 6 empresas ───────────
INSERT INTO public.doc_tipos (empresa_id, nome, descricao)
SELECT e.id, 'DECLARAÇÃO DE RECOLHIMENTO PREVIDENCIARIO RPA', NULL
FROM public.empresas e
WHERE NOT EXISTS (
  SELECT 1 FROM public.doc_tipos dt WHERE dt.empresa_id = e.id AND dt.nome = 'DECLARAÇÃO DE RECOLHIMENTO PREVIDENCIARIO RPA'
);

-- ── 2. Solta a FK antiga ANTES de remapear — senão o UPDATE do passo 3
-- (que grava um doc_tipos.id na coluna) viola a FK velha, que ainda
-- exige um CHECKLIST_FATURAMENTO_DOC.id até esse ponto. ─────────────────
ALTER TABLE public."CHECKLIST_FATURAMENTO_MARCACAO" DROP CONSTRAINT "CHECKLIST_FATURAMENTO_MARCACAO_doc_id_fkey";
ALTER TABLE public."CHECKLIST_FATURAMENTO_ANEXO" DROP CONSTRAINT "CHECKLIST_FATURAMENTO_ANEXO_doc_id_fkey";

-- ── 3. Remapeia o dado real (21 marcações + 1 anexo) do doc_id antigo
-- pro doc_tipos equivalente (mesmo nome, na empresa do contrato da
-- linha) — ANTES de derrubar a tabela antiga, pra não perder o vínculo ──
UPDATE public."CHECKLIST_FATURAMENTO_MARCACAO" m
SET doc_id = dt.id
FROM public."CHECKLIST_FATURAMENTO_DOC" old_doc, public.contratos c, public.doc_tipos dt
WHERE old_doc.id = m.doc_id
  AND c.id = m.contrato_id
  AND dt.empresa_id = c.empresa_id
  AND dt.nome = old_doc.nome;

UPDATE public."CHECKLIST_FATURAMENTO_ANEXO" a
SET doc_id = dt.id
FROM public."CHECKLIST_FATURAMENTO_DOC" old_doc, public.contratos c, public.doc_tipos dt
WHERE old_doc.id = a.doc_id
  AND c.id = a.contrato_id
  AND dt.empresa_id = c.empresa_id
  AND dt.nome = old_doc.nome;

-- ── 4. Cria a nova FK, agora que os valores já batem com doc_tipos ──────
ALTER TABLE public."CHECKLIST_FATURAMENTO_MARCACAO"
  ADD CONSTRAINT "CHECKLIST_FATURAMENTO_MARCACAO_doc_id_fkey" FOREIGN KEY (doc_id) REFERENCES public.doc_tipos(id);

ALTER TABLE public."CHECKLIST_FATURAMENTO_ANEXO"
  ADD CONSTRAINT "CHECKLIST_FATURAMENTO_ANEXO_doc_id_fkey" FOREIGN KEY (doc_id) REFERENCES public.doc_tipos(id);

-- ── 4. Derruba o catálogo/vínculo paralelo (substituídos) ───────────────
DROP TABLE public."CHECKLIST_FATURAMENTO_CONTRATO_DOC";
DROP TABLE public."CHECKLIST_FATURAMENTO_DOC";

-- ── 5. RLS aditiva em doc_tipos/contrato_docs_config pro Checklist ──────
-- As duas tabelas usam o padrão antigo `empresa_id IN (SELECT ... FROM
-- user_empresa WHERE user_id = auth.uid())` (documentado no README como o
-- que NÃO fazer — zera a tabela pra quem não tem linha em user_empresa,
-- mesmo padrão do bug real já visto no Suprimentos com o CASSIO). Não
-- mexe nessa policy existente (fora do escopo deste chamado, usada por
-- Licitações/Documentos) — só ADICIONA uma policy baseada em
-- has_screen_access pro Checklist, pra usuário com acesso à tela nunca
-- ficar de fora só por não ter vínculo em user_empresa.
CREATE POLICY checklist_fat_doc_tipos_select ON public.doc_tipos
  FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'visualizar'));

CREATE POLICY checklist_fat_contrato_docs_select ON public.contrato_docs_config
  FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'visualizar'));

CREATE POLICY checklist_fat_contrato_docs_alterar ON public.contrato_docs_config
  FOR ALL TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'alterar'))
  WITH CHECK (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'alterar'));

-- ── 6. Re-seed do vínculo Contrato × Documento em contrato_docs_config
-- (os 818 + 24 que migrei antes pra CHECKLIST_FATURAMENTO_CONTRATO_DOC,
-- agora direto na tabela certa — periodicidade 'mensal' por padrão, é
-- exatamente o que o Checklist cobra todo mês) ──────────────────────────
-- (gerado por script — ver INSERTs abaixo)

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   -- não recomendado: recriar CHECKLIST_FATURAMENTO_DOC/_CONTRATO_DOC do
--   -- zero perderia o histórico consolidado — se precisar reverter,
--   -- restaurar de um backup de antes desta migration.
-- =====================================================================
