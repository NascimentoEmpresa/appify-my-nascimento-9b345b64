-- =========================================================================
-- Jurídico › Processos: tipo de processo (Trabalhista × Outros) e partes
-- Autor / Réu — a empresa pode ser autora
--
-- SIS-2026-0488 (Gustavo Garcia Ronsani, 22/09/2026): "permitindo o
-- cadastro de processos judiciais em que a empresa também figure como
-- autora da ação ... Tipo de processo: Processo Trabalhista / Outros ...
-- Autor: pessoa física, pessoa jurídica ou uma das empresas do grupo. Réu:
-- idem".
--
--   • tipo_processo: 'trabalhista' (tudo o que já existe — o cadastro fica
--     como está) | 'outros' (cível, cobrança, execução, contratual…).
--   • natureza_acao: texto livre com sugestões na tela (só em 'outros').
--   • autor_tipo / reu_tipo: 'pf' | 'pj' | 'grupo'; *_nome e *_documento
--     (CPF/CNPJ). Empresa do grupo grava o CÓDIGO de `empresas` (HAGG, SN…)
--     — o mesmo que "reclamada" já usa, então o "Por empresa" do dashboard
--     continua casando.
--   • Em 'outros' a tela grava também reclamante = autor e reclamada = réu:
--     lista, filtros, busca, agenda e exportação seguem funcionando sem
--     saber do tipo novo. As colunas repetem em toda linha de motivo, como
--     os outros campos do processo (o Salvar apaga e recria as linhas).
--   • jur_empresas_grupo(): a lista das empresas do grupo pra quem tem
--     Processos — a leitura direta de `empresas` é recortada por empresa do
--     usuário (user_pode_atuar_empresa) e o Jurídico precisa ver todas.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."JUR_PROCESSOS" ADD COLUMN IF NOT EXISTS tipo_processo   text NOT NULL DEFAULT 'trabalhista';
ALTER TABLE public."JUR_PROCESSOS" ADD COLUMN IF NOT EXISTS natureza_acao   text;
ALTER TABLE public."JUR_PROCESSOS" ADD COLUMN IF NOT EXISTS autor_tipo      text;
ALTER TABLE public."JUR_PROCESSOS" ADD COLUMN IF NOT EXISTS autor_nome      text;
ALTER TABLE public."JUR_PROCESSOS" ADD COLUMN IF NOT EXISTS autor_documento text;
ALTER TABLE public."JUR_PROCESSOS" ADD COLUMN IF NOT EXISTS reu_tipo        text;
ALTER TABLE public."JUR_PROCESSOS" ADD COLUMN IF NOT EXISTS reu_nome        text;
ALTER TABLE public."JUR_PROCESSOS" ADD COLUMN IF NOT EXISTS reu_documento   text;

ALTER TABLE public."JUR_PROCESSOS" DROP CONSTRAINT IF EXISTS jur_processos_tipo_processo_check;
ALTER TABLE public."JUR_PROCESSOS" ADD CONSTRAINT jur_processos_tipo_processo_check
  CHECK (tipo_processo IN ('trabalhista', 'outros'));
ALTER TABLE public."JUR_PROCESSOS" DROP CONSTRAINT IF EXISTS jur_processos_partes_tipo_check;
ALTER TABLE public."JUR_PROCESSOS" ADD CONSTRAINT jur_processos_partes_tipo_check
  CHECK ((autor_tipo IS NULL OR autor_tipo IN ('pf', 'pj', 'grupo')) AND (reu_tipo IS NULL OR reu_tipo IN ('pf', 'pj', 'grupo')));

COMMENT ON COLUMN public."JUR_PROCESSOS".tipo_processo IS 'trabalhista (reclamante × reclamada) | outros (autor × réu; a empresa pode ser autora). SIS-2026-0488.';
COMMENT ON COLUMN public."JUR_PROCESSOS".autor_tipo IS 'pf | pj | grupo (empresa do grupo: *_nome = código de empresas, ex. HAGG).';

CREATE INDEX IF NOT EXISTS idx_jur_processos_tipo ON public."JUR_PROCESSOS"(tipo_processo);

CREATE OR REPLACE FUNCTION public.jur_empresas_grupo()
RETURNS TABLE (codigo text, razao_social text, cnpj text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT has_screen_access(auth.uid(), 'processos', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Sem acesso aos processos.';
  END IF;
  RETURN QUERY
    SELECT e.codigo::text, e.razao_social::text, e.cnpj::text
      FROM public.empresas e WHERE e.ativa ORDER BY e.codigo;
END $fn$;
REVOKE ALL ON FUNCTION public.jur_empresas_grupo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jur_empresas_grupo() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.jur_empresas_grupo();
-- DROP INDEX IF EXISTS public.idx_jur_processos_tipo;
-- ALTER TABLE public."JUR_PROCESSOS" DROP CONSTRAINT IF EXISTS jur_processos_partes_tipo_check,
--   DROP CONSTRAINT IF EXISTS jur_processos_tipo_processo_check,
--   DROP COLUMN IF EXISTS reu_documento, DROP COLUMN IF EXISTS reu_nome, DROP COLUMN IF EXISTS reu_tipo,
--   DROP COLUMN IF EXISTS autor_documento, DROP COLUMN IF EXISTS autor_nome, DROP COLUMN IF EXISTS autor_tipo,
--   DROP COLUMN IF EXISTS natureza_acao, DROP COLUMN IF EXISTS tipo_processo;
