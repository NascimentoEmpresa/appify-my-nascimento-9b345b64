-- ============================================================================
-- SIS-2026-0658 — Conciliação da origem dos dados (Fluxo de Caixa e Relatório de Serviços)
-- ============================================================================
-- As duas bases do financeiro vêm de dois lugares: o que foi lançado no ERP ("Sistema") e o que subiu das
-- planilhas Excel antigas. Duas telas só de leitura mostram o total = Sistema + Excel, com o detalhe linha a linha.
--
--  Fluxo de Caixa: a origem já existe em cada linha (origem = 'importacao_historica' é a planilha); só falta o
--   resumo da planilha carregada (quantas linhas estão em uso, quantas foram ocultadas por já existirem no ERP,
--   quantas foram excluídas e por quem) -> função conciliacao_fluxo_planilha_resumo().
--  Relatório de Serviços (nf_emissao): NÃO havia marca de origem. Nova coluna `origem` ('sistema' | 'excel_antigo').
--   Backfill: created_by nulo = linha criada pelo script de carga da planilha (SIS-2026-0540; o front já
--   documenta "created_by null = importada da planilha legada"). Hoje 1.575 NFs (1.561 em 28/09 + 14 em 30/09).
--
-- EXECUTAR EM BLOCOS, UM DE CADA VEZ (marcados "BLOCO n"): o ALTER TABLE compete com sessões do painel do
-- Supabase (deadlock 40P01). Cada bloco é idempotente.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.conciliacao_fluxo_planilha_resumo();
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo IN ('financeiro-conciliacao-origem-fluxo','financeiro-conciliacao-origem-rs');
--   DELETE FROM public.app_menu WHERE codigo IN ('financeiro-conciliacao-origem-fluxo','financeiro-conciliacao-origem-rs');
--   ALTER TABLE public.nf_emissao DROP COLUMN IF EXISTS origem;

-- ── BLOCO 1 ── coluna (default constante: não reescreve a tabela)
SET lock_timeout = '8s';
ALTER TABLE public.nf_emissao
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'sistema';

-- ── BLOCO 2 ── restrição e backfill. Os gatilhos da tabela ficam desligados SÓ durante o UPDATE: a trava
-- nf_emissao_guard_enviada recusa qualquer alteração em NF concluída/cancelada, e `origem` é um carimbo de
-- proveniência, não uma alteração da nota (também por isso updated_at não deve mudar). Tudo na mesma execução:
-- se der erro, o banco desfaz inclusive o DISABLE.
SET lock_timeout = '8s';
ALTER TABLE public.nf_emissao DROP CONSTRAINT IF EXISTS nf_emissao_origem_check;
ALTER TABLE public.nf_emissao
  ADD CONSTRAINT nf_emissao_origem_check CHECK (origem IN ('sistema', 'excel_antigo'));

ALTER TABLE public.nf_emissao DISABLE TRIGGER USER;
UPDATE public.nf_emissao SET origem = 'excel_antigo' WHERE created_by IS NULL AND origem <> 'excel_antigo';
ALTER TABLE public.nf_emissao ENABLE TRIGGER USER;

COMMENT ON COLUMN public.nf_emissao.origem IS
  'SIS-2026-0658: sistema = criada no ERP; excel_antigo = carregada da planilha legada (SIS-2026-0540).';

-- ── BLOCO 3 ── resumo da planilha do Fluxo (respeita a RLS de quem chama)
CREATE OR REPLACE FUNCTION public.conciliacao_fluxo_planilha_resumo()
RETURNS TABLE (situacao text, qtd bigint, entradas numeric, saidas numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    CASE
      WHEN f.deleted_at IS NOT NULL AND f.deleted_by IS NOT NULL THEN 'excluida_por_usuario'
      WHEN f.deleted_at IS NOT NULL THEN 'excluida_na_carga'
      WHEN f.conferencia = 'ja_existe_no_erp' THEN 'ja_existe_no_erp'
      ELSE 'em_uso'
    END AS situacao,
    count(*) AS qtd,
    COALESCE(sum(f.valor) FILTER (WHERE f.tipo = 'entrada'), 0) AS entradas,
    COALESCE(sum(f.valor) FILTER (WHERE f.tipo = 'saida'), 0) AS saidas
  FROM public.fluxo_caixa_importado f
  GROUP BY 1;
$$;
GRANT EXECUTE ON FUNCTION public.conciliacao_fluxo_planilha_resumo() TO authenticated;

-- ── BLOCO 4 ── menus (a liberação por usuário é feita em /app/administracao?tab=modulos)
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'financeiro-conciliacao-origem-fluxo', 'Financeiro — Conciliação da Origem do Fluxo de Caixa',
       '/app/financeiro/gestao-financeira/conciliacao-origem-fluxo-caixa', 36
  FROM public.app_modulo m WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'financeiro-conciliacao-origem-rs', 'Financeiro — Conciliação da Origem do Relatório de Serviços',
       '/app/financeiro/relatorio-servicos/conciliacao-origem', 27
  FROM public.app_modulo m WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, c.codigo, 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES ('financeiro-conciliacao-origem-fluxo'), ('financeiro-conciliacao-origem-rs')) AS c(codigo)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';
