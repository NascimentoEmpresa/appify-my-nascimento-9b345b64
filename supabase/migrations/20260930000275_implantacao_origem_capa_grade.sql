-- ============================================================================
-- SIS-2026-0559: Implantacao de Contratos — origem dos dados na Capa e na Grade
-- ============================================================================
--
-- O chamado pede que os itens do checklist que JA tem informacao na Capa de
-- Edital e na Grade de Licitacoes venham preenchidos, no topo da tela, so pra
-- o usuario confirmar. Sao 11 itens (row_index 31, 49, 51..56, 58, 61, 62).
--
-- POR QUE UM RPC E NAO UM EMBED DO POSTGREST
-- As tres tabelas da cadeia sao gateadas por MENUS DIFERENTES:
--
--   implantacao_contrato -> can_access(uid, 'implantacao', ...)  (20260718100006)
--   capa_edital          -> can_access(uid, 'editais',     ...)  (20260718100006)
--   grade                -> can_access(uid, 'pipeline',    ...)  (20260718100006)
--
-- Quem tem 'implantacao' mas nao tem 'editais'/'pipeline' recebe o embed como
-- NULL — sem erro, sem aviso. A tela mostraria os 11 campos vazios e ninguem
-- descobriria o motivo (RLS negada devolve vazio, nao devolve erro). Por isso a
-- leitura vai por SECURITY DEFINER, gateada SO por 'implantacao', devolvendo
-- APENAS os 11 campos que a tela mostra — nada de CNPJ, garantia, ou valores de
-- outros processos da mesma capa.
--
-- O can_access() dentro do WHERE e o que impede o SECURITY DEFINER de virar
-- vazamento: sem permissao no menu 'implantacao', a funcao retorna zero linhas.
--
-- ALEM DISSO: checklist_respostas ainda estava no padrao DESCONTINUADO
-- `empresa_id IN (SELECT empresa_id FROM user_empresa ...)` (20260622000001),
-- enquanto a tela le contratos de TODAS as empresas do grupo desde a
-- SIS-2026-0309. Ou seja: dava pra selecionar um contrato de outra empresa,
-- clicar em Confirmar, e a gravacao ser recusada em silencio. Como o botao
-- Confirmar depende dessa escrita, o conserto entra aqui junto.
-- ============================================================================

-- ── 1. Origem dos campos (Capa de Edital + Grade de Licitacoes) ─────────────

CREATE OR REPLACE FUNCTION public.implantacao_origem_contrato(p_contrato_id uuid)
RETURNS TABLE (
  data_inicio  text,     -- row_index 31 — Data de inicio do contrato
  abertura     text,     -- row_index 49 — Data de abertura
  edital       text,     -- row_index 51 — EDITAL
  horario      text,     -- row_index 52 — Horario
  cidade       text,     -- row_index 53 — Cidade
  objeto       text,     -- row_index 54 — Objeto
  empresa      text,     -- row_index 55 — Empresa
  responsavel  text,     -- row_index 56 — Responsavel
  uf           text,     -- row_index 58 — UF
  valor_global text,     -- row_index 61 — Valor global
  qtd_postos   integer   -- row_index 62 — N pessoas (Quantidade de postos)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Todo campo de texto passa por nullif(btrim(...), ''): essas colunas sao
  -- preenchidas a mao e string VAZIA e tao comum quanto NULL. Sem isso o
  -- coalesce pararia no '' da primeira fonte e nunca chegaria na segunda.
  -- O btrim resolve de quebra o padding de grade.uf, que e CHARACTER (nao text)
  -- e portanto volta com espacos ate o tamanho declarado.
  SELECT
    -- data_inicio da Capa; o promover copia pro contrato, entao ele serve de queda
    coalesce(c.data_inicio::text, ic.data_inicio::text),
    -- abertura e TEXTO LIVRE com hora ("2026-01-28 08H30"), nao date
    coalesce(nullif(btrim(c.abertura), ''), nullif(btrim(ic.abertura), ''), g.data::text),
    nullif(btrim(g.edital), ''),
    nullif(btrim(g.horario), ''),
    -- a planilha manda puxar da Grade; a Capa so entra se a Grade estiver vazia
    coalesce(nullif(btrim(g.cidade), ''), nullif(btrim(c.cidade), '')),
    nullif(btrim(c.objeto), ''),
    coalesce(nullif(btrim(e.razao_social), ''), nullif(btrim(e.nome_fantasia), '')),
    nullif(btrim(c.responsavel), ''),
    -- uf e nulo nos dois lados em varios contratos; a tela trata como "sem dado"
    coalesce(nullif(btrim(c.uf), ''), nullif(btrim(g.uf), '')),
    -- a Capa nao tem valor_global, so valor_estimado (estimado do edital);
    -- quem tem valor_global e a Grade — por isso a queda
    coalesce(nullif(btrim(c.valor_estimado), ''), nullif(btrim(g.valor_global), '')),
    -- 0 postos e capa nao preenchida, nao contrato com zero posto: vira NULL pra
    -- a tela mostrar "sem dado" em vez de oferecer "0" pra confirmar
    nullif(coalesce(c.qtd_postos, g.qtd_pessoas), 0)
  FROM public.implantacao_contrato ic
  LEFT JOIN public.capa_edital c ON c.id = ic.capa_id
  LEFT JOIN public.grade       g ON g.id = c.grade_id
  LEFT JOIN public.empresas    e ON e.id = c.empresa_id
  WHERE ic.id = p_contrato_id
    AND (select public.can_access(auth.uid(), 'implantacao'::text, 'visualizar'::app_acao));
$$;

REVOKE ALL     ON FUNCTION public.implantacao_origem_contrato(uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.implantacao_origem_contrato(uuid) TO authenticated;

COMMENT ON FUNCTION public.implantacao_origem_contrato(uuid) IS
  'SIS-2026-0559: os 11 campos do checklist de implantacao que vem prontos da Capa de Edital e da Grade de Licitacoes. SECURITY DEFINER porque capa_edital/grade sao gateadas por outros menus (editais/pipeline) — sem isso o usuario com acesso so a implantacao veria tudo vazio, em silencio.';

-- ── 2. checklist_respostas: user_empresa -> can_access ──────────────────────
-- Policy nunca usa CREATE OR REPLACE (Postgres nao suporta): DROP + CREATE.
-- can_access() envelopado em (select ...) pelo mesmo motivo das 265/267/268 —
-- sem isso e avaliado por linha.

DROP POLICY IF EXISTS "checklist_respostas_select" ON public.checklist_respostas;
CREATE POLICY "checklist_respostas_select" ON public.checklist_respostas
  FOR SELECT TO authenticated
  USING ((select public.can_access(auth.uid(), 'implantacao'::text, 'visualizar'::app_acao)));

DROP POLICY IF EXISTS "checklist_respostas_insert" ON public.checklist_respostas;
CREATE POLICY "checklist_respostas_insert" ON public.checklist_respostas
  FOR INSERT TO authenticated
  WITH CHECK ((select public.can_access(auth.uid(), 'implantacao'::text, 'incluir'::app_acao)));

DROP POLICY IF EXISTS "checklist_respostas_update" ON public.checklist_respostas;
CREATE POLICY "checklist_respostas_update" ON public.checklist_respostas
  FOR UPDATE TO authenticated
  USING ((select public.can_access(auth.uid(), 'implantacao'::text, 'alterar'::app_acao)));

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- DROP FUNCTION IF EXISTS public.implantacao_origem_contrato(uuid);
--
-- DROP POLICY IF EXISTS "checklist_respostas_select" ON public.checklist_respostas;
-- CREATE POLICY "checklist_respostas_select" ON public.checklist_respostas
--   FOR SELECT TO authenticated
--   USING (empresa_id IN (
--     SELECT empresa_id FROM public.user_empresa WHERE user_id = auth.uid()
--   ));
--
-- DROP POLICY IF EXISTS "checklist_respostas_insert" ON public.checklist_respostas;
-- CREATE POLICY "checklist_respostas_insert" ON public.checklist_respostas
--   FOR INSERT TO authenticated
--   WITH CHECK (empresa_id IN (
--     SELECT empresa_id FROM public.user_empresa WHERE user_id = auth.uid()
--   ));
--
-- DROP POLICY IF EXISTS "checklist_respostas_update" ON public.checklist_respostas;
-- CREATE POLICY "checklist_respostas_update" ON public.checklist_respostas
--   FOR UPDATE TO authenticated
--   USING (empresa_id IN (
--     SELECT empresa_id FROM public.user_empresa WHERE user_id = auth.uid()
--   ));
--
-- NOTIFY pgrst, 'reload schema';
-- ============================================================================
