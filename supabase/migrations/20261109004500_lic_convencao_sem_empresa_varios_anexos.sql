-- =========================================================================
-- Convenções Coletivas — CCT sem empresa, vários anexos, editar/excluir
-- (09/11/2026)
--
-- PEDIDO (equipe de Licitação):
--   1. Sai o campo "Empresa" do cadastro da CCT, e a obrigatoriedade junto:
--      a CCT é cadastrada UMA vez e vale para todas as empresas a que se
--      aplica. Quem liga a CCT a contrato/posto continua sendo a Planilha de
--      Custo (LIC_POSTO_CONVENCAO) — ninguém lê a convenção por empresa
--      (conferido: Planilha de Custo, Abertura de Vagas, resolvedor
--      lic_referencia_do_posto_interno e RLS não usam empresa_id).
--      A coluna empresa_id FICA (nullable desde a 20261103002250): cadastro
--      antigo guarda a empresa que tinha; só deixa de ser exigida.
--   2. Desconto do colaborador do VA em porcentagem: era só a tela (campo
--      espremido ao lado do seletor) — o jsonb `beneficios` já guardava.
--   3/4. Editar e excluir: as ações `alterar` e `excluir` do menu
--      `licitacoes_convencoes` já existiam (mig 20261027000930); as policies
--      de escrita são refeitas aqui com (SELECT ...) para o guardião (M1) e
--      deixam de passar pelo atalho da Planilha de Custo, que só vale para
--      `visualizar`.
--   5. Vários anexos por convenção (o SEEAC publica mais de uma CCT): tabela
--      LIC_CONVENCAO_ANEXO, um arquivo por linha, com descrição da
--      abrangência. Anexo novo NÃO substitui o anterior.
--      `cct_arquivo_path/nome/tamanho` da convenção seguem como o espelho do
--      PRIMEIRO anexo — é o que a vaga (quadro de benefícios, "ver CCT"), os
--      KPIs e a pendência "não anexada" leem; a tela mantém o espelho ao
--      salvar. Os anexos que já existiam entram como o primeiro anexo de cada
--      convenção (backfill abaixo).
--
-- Idempotente.
-- =========================================================================

-- ── 1) CCT sem empresa ───────────────────────────────────────────────────
ALTER TABLE public."LIC_CONVENCAO_COLETIVA" DROP CONSTRAINT IF EXISTS lic_convencao_cct_tem_empresa;

-- ── 2) Escrita na convenção: incluir / alterar / excluir do menu ─────────
DROP POLICY IF EXISTS lic_convencao_insert ON public."LIC_CONVENCAO_COLETIVA";
CREATE POLICY lic_convencao_insert ON public."LIC_CONVENCAO_COLETIVA" FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_screen_access((SELECT auth.uid()), 'licitacoes_convencoes', 'incluir'::public.app_acao)));
DROP POLICY IF EXISTS lic_convencao_update ON public."LIC_CONVENCAO_COLETIVA";
CREATE POLICY lic_convencao_update ON public."LIC_CONVENCAO_COLETIVA" FOR UPDATE TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'licitacoes_convencoes', 'alterar'::public.app_acao)))
  WITH CHECK ((SELECT public.has_screen_access((SELECT auth.uid()), 'licitacoes_convencoes', 'alterar'::public.app_acao)));
DROP POLICY IF EXISTS lic_convencao_delete ON public."LIC_CONVENCAO_COLETIVA";
CREATE POLICY lic_convencao_delete ON public."LIC_CONVENCAO_COLETIVA" FOR DELETE TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'licitacoes_convencoes', 'excluir'::public.app_acao)));

-- ── 3) Anexos ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."LIC_CONVENCAO_ANEXO" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  convencao_id  uuid NOT NULL REFERENCES public."LIC_CONVENCAO_COLETIVA"(id) ON DELETE CASCADE,
  -- Caminho no bucket convencoes-coletivas (o mesmo dos anexos antigos).
  path          text NOT NULL,
  nome          text,
  tamanho       bigint,
  -- Abrangência / identificação ("CCT SEEAC — Limpeza Capital", "Aditivo 2026"…).
  descricao     text,
  criado_por    uuid DEFAULT auth.uid(),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lic_convencao_anexo_unico UNIQUE (convencao_id, path)
);
CREATE INDEX IF NOT EXISTS idx_lic_convencao_anexo_convencao ON public."LIC_CONVENCAO_ANEXO"(convencao_id);

-- O anexo que cada CCT já tinha vira o primeiro da lista (criado_em antigo
-- para continuar primeiro, e portanto o espelho em cct_arquivo_path).
INSERT INTO public."LIC_CONVENCAO_ANEXO"(convencao_id, path, nome, tamanho, criado_por, criado_em)
SELECT c.id, c.cct_arquivo_path, c.cct_arquivo_nome, c.cct_arquivo_tamanho, c.updated_by, c.created_at
  FROM public."LIC_CONVENCAO_COLETIVA" c
 WHERE c.tipo = 'cct' AND coalesce(btrim(c.cct_arquivo_path), '') <> ''
ON CONFLICT (convencao_id, path) DO NOTHING;

ALTER TABLE public."LIC_CONVENCAO_ANEXO" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."LIC_CONVENCAO_ANEXO" TO authenticated;

-- Ver: quem vê a convenção (o módulo ou a Planilha de Custo).
DROP POLICY IF EXISTS lic_convencao_anexo_select ON public."LIC_CONVENCAO_ANEXO";
CREATE POLICY lic_convencao_anexo_select ON public."LIC_CONVENCAO_ANEXO" FOR SELECT TO authenticated
  USING ((SELECT public.lic_convencao_pode('visualizar')));
-- Incluir anexo: no cadastro novo (incluir) ou na edição (alterar).
DROP POLICY IF EXISTS lic_convencao_anexo_insert ON public."LIC_CONVENCAO_ANEXO";
CREATE POLICY lic_convencao_anexo_insert ON public."LIC_CONVENCAO_ANEXO" FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_screen_access((SELECT auth.uid()), 'licitacoes_convencoes', 'incluir'::public.app_acao))
           OR (SELECT public.has_screen_access((SELECT auth.uid()), 'licitacoes_convencoes', 'alterar'::public.app_acao)));
-- Trocar a descrição: edição.
DROP POLICY IF EXISTS lic_convencao_anexo_update ON public."LIC_CONVENCAO_ANEXO";
CREATE POLICY lic_convencao_anexo_update ON public."LIC_CONVENCAO_ANEXO" FOR UPDATE TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'licitacoes_convencoes', 'alterar'::public.app_acao)))
  WITH CHECK ((SELECT public.has_screen_access((SELECT auth.uid()), 'licitacoes_convencoes', 'alterar'::public.app_acao)));
-- Tirar um anexo: edição. (Excluir a convenção leva os anexos pelo CASCADE.)
DROP POLICY IF EXISTS lic_convencao_anexo_delete ON public."LIC_CONVENCAO_ANEXO";
CREATE POLICY lic_convencao_anexo_delete ON public."LIC_CONVENCAO_ANEXO" FOR DELETE TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'licitacoes_convencoes', 'alterar'::public.app_acao))
      OR (SELECT public.has_screen_access((SELECT auth.uid()), 'licitacoes_convencoes', 'excluir'::public.app_acao)));

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (a empresa só volta a ser exigida se toda CCT tiver uma)
-- DROP TABLE IF EXISTS public."LIC_CONVENCAO_ANEXO";
-- DROP POLICY IF EXISTS lic_convencao_insert ON public."LIC_CONVENCAO_COLETIVA";
-- CREATE POLICY lic_convencao_insert ON public."LIC_CONVENCAO_COLETIVA" FOR INSERT TO authenticated
--   WITH CHECK (public.lic_convencao_pode('incluir'));
-- DROP POLICY IF EXISTS lic_convencao_update ON public."LIC_CONVENCAO_COLETIVA";
-- CREATE POLICY lic_convencao_update ON public."LIC_CONVENCAO_COLETIVA" FOR UPDATE TO authenticated
--   USING (public.lic_convencao_pode('alterar')) WITH CHECK (public.lic_convencao_pode('alterar'));
-- DROP POLICY IF EXISTS lic_convencao_delete ON public."LIC_CONVENCAO_COLETIVA";
-- CREATE POLICY lic_convencao_delete ON public."LIC_CONVENCAO_COLETIVA" FOR DELETE TO authenticated
--   USING (public.lic_convencao_pode('excluir'));
-- ALTER TABLE public."LIC_CONVENCAO_COLETIVA"
--   ADD CONSTRAINT lic_convencao_cct_tem_empresa CHECK (tipo <> 'cct' OR empresa_id IS NOT NULL);
-- NOTIFY pgrst, 'reload schema';
