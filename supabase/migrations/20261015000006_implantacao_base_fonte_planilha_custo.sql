-- ============================================================================
-- SIS-2026-0599 — a Base Mestre passa a contar posto como a Licitação conta
--
-- O QUE ESTAVA ERRADO (visto em produção em 15/10/2026, com a tela no ar)
-- A tela mostrava "Postos Confirmados: 177" para o contrato POLÍCIA CIVIL RS
-- LIMPEZA - 066/2026, e /app/licitacoes/planilha-custo mostra 48 postos para o
-- mesmo contrato. Os dois números existem e os dois estão certos — só que são
-- coisas diferentes: `planilha_custo.qt_postos` conta GENTE, e o que a tela de
-- Licitações chama de "posto" é a LINHA da planilha ("48 postos · 177 pessoas",
-- PlanilhaCusto.tsx:904). A Base Mestre estava somando gente na coluna de
-- posto.
--
-- E tinha mais três divergências contra a regra da tela de Licitações
-- (computeVigenciaStatus em PlanilhaCusto.tsx:75 e resolverLinhasVigentes em
-- usePlanilhaCusto.ts:186), todas nascidas da dedup que a mig ...0002 fez de
-- improviso:
--   1. ela preferia a linha ORÇADO; a Licitação lê EXECUTADO;
--   2. ela pegava a vigência mais recente mesmo FUTURA — na tela, vigência com
--      data à frente é "ENTRA 01/12", não vigente (a planilha já tem datas
--      futuras de verdade);
--   3. `valor_mensal` vinha de `contratos.valor_mensal_contratado` (digitado no
--      cabeçalho do contrato: R$ 879.461,82) e não da planilha (R$ 848.424,56).
--      Os dois continuam existindo, agora lado a lado e identificados.
--
-- A REGRA, UMA VEZ SÓ: `planilha_custo_vigente(contrato, orexec)` é a tradução
-- literal do que o React faz — descarta encerrada e sem vigência, acha por
-- posto a vigência mais recente que já começou, devolve as linhas daquela data.
-- Quem precisar do mesmo número em outro lugar chama ela, não recopia a regra.
--
-- E A LISTA SÓ MOSTRAVA UM CONTRATO: ela lia a tabela IMPLANTACAO_BASE, que só
-- tem linha para contrato já carregado — um, o do chamado. Agora a lista sai de
-- `contratos` + `planilha_custo` (as duas fontes de Licitações) e mostra os 67
-- contratos ativos, com os números certos, cadastrados ou não. É uma consulta
-- agregada só, sobre 1.868 linhas — não é o "ao vivo caro" que foi descartado
-- em 15/10: o que continua guardado e só mudando no botão "Atualizar da base" é
-- o detalhe (postos, locais, enxoval), que é onde mora o custo.
--
-- Idempotente. NÃO se auto-aplica: rodar no SQL Editor do projeto remoto.
-- ============================================================================

SET lock_timeout = '5s';

-- ── 1) Colunas novas no cabeçalho ───────────────────────────────────────────
-- `qt_postos` passa a contar POSTO (linha da planilha) e `qt_colaboradores`,
-- gente. As três colunas novas guardam o lado ORÇADO e o valor que está
-- escrito no contrato, para a divergência ficar à vista em vez de virar
-- discussão ("a planilha diz 848 mil, o contrato diz 879 mil").
ALTER TABLE public."IMPLANTACAO_BASE"
  ADD COLUMN IF NOT EXISTS qt_postos_orcados        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qt_colaboradores_orcados integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_mensal_contrato    numeric(14,2);

COMMENT ON COLUMN public."IMPLANTACAO_BASE".qt_postos IS
  'Postos = LINHAS vigentes EXECUTADO da planilha_custo, do mesmo jeito que '
  '/app/licitacoes/planilha-custo conta ("48 postos, 177 pessoas"). NAO e '
  'soma de planilha_custo.qt_postos — essa coluna la conta gente.';
COMMENT ON COLUMN public."IMPLANTACAO_BASE".valor_mensal IS
  'Custo mensal pela Planilha de Custo (soma de total_por_empregado x gente, '
  'linhas vigentes EXECUTADO). Compare com valor_mensal_contrato.';
COMMENT ON COLUMN public."IMPLANTACAO_BASE".valor_mensal_contrato IS
  'contratos.valor_mensal_contratado — o valor digitado no cabecalho do '
  'contrato. Divergiu da planilha em 15/10/2026 (879.461,82 x 848.424,56).';

-- ── 2) A regra de vigência da Licitação, em SQL ─────────────────────────────
-- Tradução literal de computeVigenciaStatus/resolverLinhasVigentes. Diferença
-- deliberada: o React agrupa por (texto do contrato + posto) e aqui agrupa por
-- (contrato_id, posto) — dois contratos homônimos se misturariam lá e não aqui.
CREATE OR REPLACE FUNCTION public.planilha_custo_vigente(
  p_contrato_id uuid,
  p_orexec      text DEFAULT 'EXECUTADO'
)
RETURNS SETOF public.planilha_custo
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH pool AS (
    SELECT pc.*
      FROM public.planilha_custo pc
     WHERE pc.contrato_id = p_contrato_id
       AND pc.data_vigencia IS NOT NULL
       AND NOT COALESCE(pc.encerrado, false)
  ), vigente AS (
    -- "mais recente que JA comecou": data a frente e "ENTRA dd/mm", nao vigente
    SELECT p.posto, max(p.data_vigencia) AS data_vigencia
      FROM pool p
     WHERE p.data_vigencia <= current_date
     GROUP BY p.posto
  )
  SELECT p.*
    FROM pool p
    JOIN vigente v ON v.posto = p.posto AND v.data_vigencia = p.data_vigencia
   WHERE p.orexec = p_orexec;
$$;

COMMENT ON FUNCTION public.planilha_custo_vigente(uuid, text) IS
  'Linhas vigentes de um contrato na Planilha de Custo, pela mesma regra da '
  'tela /app/licitacoes/planilha-custo. count(*) = postos; sum(qt_postos) = '
  'pessoas; sum(total_por_empregado * qt_postos) = custo mensal.';

REVOKE ALL ON FUNCTION public.planilha_custo_vigente(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planilha_custo_vigente(uuid, text) TO authenticated;

-- ── 3) Semear com a fonte certa ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.implantacao_base_semear(p_contrato_id uuid)
RETURNS TABLE (base_id uuid, postos integer, locais integer, itens integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base    uuid;
  v_emp     uuid;
  v_postos  integer := 0;
  v_locais  integer := 0;
  v_itens   integer := 0;
BEGIN
  IF NOT public.implantacao_base_pode_escrever() THEN
    RAISE EXCEPTION 'Sem acesso para atualizar a Base Mestre de Início de Contrato';
  END IF;

  SELECT c.empresa_id INTO v_emp FROM public.contratos c WHERE c.id = p_contrato_id;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Contrato % não encontrado', p_contrato_id;
  END IF;

  INSERT INTO public."IMPLANTACAO_BASE" AS b (empresa_id, contrato_id, implantacao_id, cnpj_contratante,
                                              valor_mensal_contrato, sincronizado_em)
  SELECT c.empresa_id, c.id,
         (SELECT ic.id FROM public.implantacao_contrato ic WHERE ic.contrato_id = c.id LIMIT 1),
         c.cnpj_cliente, c.valor_mensal_contratado, now()
    FROM public.contratos c WHERE c.id = p_contrato_id
  ON CONFLICT (contrato_id) DO UPDATE
    SET cnpj_contratante      = EXCLUDED.cnpj_contratante,
        valor_mensal_contrato = EXCLUDED.valor_mensal_contrato,
        implantacao_id        = COALESCE(b.implantacao_id, EXCLUDED.implantacao_id),
        sincronizado_em       = now()
  RETURNING b.id INTO v_base;

  -- Postos: uma linha por POSTO vigente EXECUTADO. qt_postos = 1 porque a
  -- linha É o posto; quantas PESSOAS nele é qt_funcionarios. O "Nº DE POSTOS"
  -- físico (170 no mockup) só existe na planilha do Yuri — entra na importação,
  -- que grava origem 'planilha' e não é tocada aqui.
  DELETE FROM public."IMPLANTACAO_BASE_POSTO" t WHERE t.base_id = v_base AND t.origem = 'base';
  INSERT INTO public."IMPLANTACAO_BASE_POSTO"
    (base_id, empresa_id, ordem, tipo_servico, tipo_posto, qt_postos, qt_funcionarios,
     salario_base, total_remuneracao, valor_posto, sindicato, insalubridade,
     vt_dia, vt_desconto, va_dia, planilha_custo_id, origem)
  SELECT v_base, v_emp, row_number() OVER (ORDER BY pc.posto),
         pc.posto, pc.servico, 1, COALESCE(pc.qt_postos, 0),
         pc.salario,
         COALESCE(pc.salario,0) + COALESCE(pc.insalubridade,0) + COALESCE(pc.periculosidade,0)
           + COALESCE(pc.lideranca,0) + COALESCE(pc.adicional_noturno_reduzido,0)
           + COALESCE(pc.adicional_noturno,0) + COALESCE(pc.adicional_extra,0) + COALESCE(pc.dsr,0),
         pc.total_por_empregado,
         pc.sindicato, pc.insalubridade,
         NULLIF(pc.transporte, 0), NULLIF(pc.transporte_desconto, 0),
         CASE WHEN COALESCE(pc.aux_alimentacao,0) > 0
              THEN replace(to_char(pc.aux_alimentacao, 'FM999999990.00'), '.', ',') END,
         pc.id, 'base'
    FROM public.planilha_custo_vigente(p_contrato_id, 'EXECUTADO') pc
   WHERE NOT EXISTS (SELECT 1 FROM public."IMPLANTACAO_BASE_POSTO" x
                      WHERE x.base_id = v_base AND x.origem <> 'base'
                        AND upper(x.tipo_servico) = upper(pc.posto));
  GET DIAGNOSTICS v_postos = ROW_COUNT;

  DELETE FROM public."IMPLANTACAO_BASE_LOCAL" t WHERE t.base_id = v_base AND t.origem = 'base';
  INSERT INTO public."IMPLANTACAO_BASE_LOCAL"
    (base_id, empresa_id, ordem, local_nome, cidade, endereco, qt_postos, qt_funcionarios, sup_posto_id, origem)
  SELECT v_base, v_emp, row_number() OVER (ORDER BY sp.nome), sp.nome,
         loc.municipio,
         NULLIF(trim(concat_ws(', ', loc.logradouro, loc.numero, loc.bairro)), ''),
         0, COALESCE(loc.qt_pessoas_orcadas, 0), sp.id, 'base'
    FROM public.sup_posto sp
    LEFT JOIN LATERAL (
      SELECT l.* FROM public.planilha_posto_localizacao l
       JOIN public.planilha_custo pc ON pc.id = l.planilha_custo_id AND pc.contrato_id = p_contrato_id
      WHERE upper(l.nome) = upper(sp.nome) LIMIT 1
    ) loc ON true
   WHERE sp.contrato_id = p_contrato_id AND sp.ativo
     AND NOT EXISTS (SELECT 1 FROM public."IMPLANTACAO_BASE_LOCAL" x
                      WHERE x.base_id = v_base AND x.origem <> 'base'
                        AND upper(x.local_nome) = upper(sp.nome));
  GET DIAGNOSTICS v_locais = ROW_COUNT;

  DELETE FROM public."IMPLANTACAO_BASE_ITEM" t WHERE t.base_id = v_base AND t.origem = 'base';
  INSERT INTO public."IMPLANTACAO_BASE_ITEM"
    (base_id, empresa_id, ordem, cargo, sup_funcao_id, item_id, descricao, tipo, quantidade, origem)
  SELECT v_base, v_emp, row_number() OVER (ORDER BY f.nome, i.nome),
         f.nome, f.id, i.id, i.nome, i.tipo, COALESCE(fi.quantidade, 0), 'base'
    FROM public.sup_funcao f
    JOIN public.sup_posto  sp ON sp.id = f.posto_id AND sp.contrato_id = p_contrato_id
    JOIN public.sup_funcao_item fi ON fi.funcao_id = f.id AND fi.ativo
    JOIN public.sup_item   i  ON i.id = fi.item_id AND i.ativo
   WHERE f.ativo
     AND NOT EXISTS (SELECT 1 FROM public."IMPLANTACAO_BASE_ITEM" x
                      WHERE x.base_id = v_base AND x.origem <> 'base'
                        AND x.item_id = i.id AND upper(x.cargo) = upper(f.nome));
  GET DIAGNOSTICS v_itens = ROW_COUNT;

  -- Cabeçalho: postos = linhas; colaboradores = gente; valor = planilha.
  UPDATE public."IMPLANTACAO_BASE" b
     SET qt_postos        = COALESCE((SELECT sum(p.qt_postos)       FROM public."IMPLANTACAO_BASE_POSTO" p WHERE p.base_id = v_base), 0),
         qt_colaboradores = COALESCE((SELECT sum(p.qt_funcionarios) FROM public."IMPLANTACAO_BASE_POSTO" p WHERE p.base_id = v_base), 0),
         valor_mensal     = COALESCE((SELECT sum(COALESCE(p.valor_posto,0) * p.qt_funcionarios)
                                        FROM public."IMPLANTACAO_BASE_POSTO" p WHERE p.base_id = v_base), 0),
         qt_postos_orcados        = COALESCE((SELECT count(*) FROM public.planilha_custo_vigente(p_contrato_id, 'ORÇADO')), 0),
         qt_colaboradores_orcados = COALESCE((SELECT sum(COALESCE(v.qt_postos,0)) FROM public.planilha_custo_vigente(p_contrato_id, 'ORÇADO') v), 0),
         sincronizado_em  = now()
   WHERE b.id = v_base;

  RETURN QUERY SELECT v_base, v_postos, v_locais, v_itens;
END;
$$;

-- ── 4) A lista da tela: todos os contratos, direto das fontes ───────────────
-- Uma consulta agregada sobre planilha_custo (1.868 linhas no banco inteiro) +
-- contratos. Mostra contrato ativo mesmo sem base cadastrada, com os números
-- que a Licitação mostra — é por isso que a lista não nasce mais com um só.
CREATE OR REPLACE FUNCTION public.implantacao_base_contratos_painel()
RETURNS TABLE (
  contrato_id uuid, contrato_nome text, cliente text, data_inicio date, status_contrato text,
  base_id uuid, situacao text, sincronizado_em timestamptz, cadastrada boolean,
  qt_postos integer, qt_colaboradores integer, valor_mensal numeric,
  qt_postos_orcados integer, qt_colaboradores_orcados integer, valor_mensal_orcado numeric,
  valor_mensal_contrato numeric, quant_func_estipulado integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH pool AS (
    SELECT pc.contrato_id, pc.posto, pc.orexec, pc.data_vigencia,
           COALESCE(pc.qt_postos, 0)           AS pessoas,
           COALESCE(pc.total_por_empregado, 0) AS unitario
      FROM public.planilha_custo pc
     WHERE pc.contrato_id IS NOT NULL
       AND pc.data_vigencia IS NOT NULL
       AND NOT COALESCE(pc.encerrado, false)
  ), vigente AS (
    SELECT p.contrato_id, p.posto, max(p.data_vigencia) AS data_vigencia
      FROM pool p
     WHERE p.data_vigencia <= current_date
     GROUP BY p.contrato_id, p.posto
  ), linhas AS (
    SELECT p.* FROM pool p JOIN vigente v USING (contrato_id, posto, data_vigencia)
  ), agg AS (
    SELECT l.contrato_id,
           count(*) FILTER (WHERE l.orexec = 'EXECUTADO')::int                                AS postos,
           COALESCE(sum(l.pessoas) FILTER (WHERE l.orexec = 'EXECUTADO'), 0)::int             AS pessoas,
           COALESCE(sum(l.unitario * l.pessoas) FILTER (WHERE l.orexec = 'EXECUTADO'), 0)     AS mensal,
           count(*) FILTER (WHERE l.orexec = 'ORÇADO')::int                                   AS postos_orc,
           COALESCE(sum(l.pessoas) FILTER (WHERE l.orexec = 'ORÇADO'), 0)::int                AS pessoas_orc,
           COALESCE(sum(l.unitario * l.pessoas) FILTER (WHERE l.orexec = 'ORÇADO'), 0)        AS mensal_orc
      FROM linhas l
     GROUP BY l.contrato_id
  )
  SELECT c.id, c.nome, c.cliente, c.data_inicio, c.status,
         b.id, COALESCE(b.situacao, 'rascunho'), b.sincronizado_em, b.id IS NOT NULL,
         COALESCE(a.postos, 0), COALESCE(a.pessoas, 0), COALESCE(a.mensal, 0),
         COALESCE(a.postos_orc, 0), COALESCE(a.pessoas_orc, 0), COALESCE(a.mensal_orc, 0),
         c.valor_mensal_contratado, c.quant_func_estipulado
    FROM public.contratos c
    LEFT JOIN agg a ON a.contrato_id = c.id
    LEFT JOIN public."IMPLANTACAO_BASE" b ON b.contrato_id = c.id
   WHERE public.implantacao_base_pode_ver()
     AND (c.status <> 'encerrado' OR b.id IS NOT NULL)
   ORDER BY c.nome;
$$;

COMMENT ON FUNCTION public.implantacao_base_contratos_painel() IS
  'Lista da Base Mestre (SIS-2026-0599): um contrato por linha, cadastrado ou '
  'nao, com postos/pessoas/custo lidos da Planilha de Custo pela regra de '
  '/app/licitacoes/planilha-custo.';

REVOKE ALL ON FUNCTION public.implantacao_base_contratos_painel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.implantacao_base_contratos_painel() TO authenticated;

-- ── 5) Resumo: mostra os dois valores e o lado orçado ───────────────────────
-- DROP antes: muda a lista de colunas do RETURNS TABLE, e CREATE OR REPLACE
-- não troca tipo de retorno.
DROP FUNCTION IF EXISTS public.implantacao_base_resumo(uuid);
CREATE FUNCTION public.implantacao_base_resumo(p_contrato_id uuid)
RETURNS TABLE (
  base_id uuid, contrato_nome text, cliente text, cnpj_contratante text, objeto text,
  valor_mensal numeric, valor_mensal_contrato numeric,
  qt_postos integer, qt_colaboradores integer, qt_postos_orcados integer,
  qt_locais integer, qt_cidades integer, qt_tipos_servico integer,
  qt_itens_uniforme integer, qt_itens_material integer,
  qt_prazos integer, qt_documentos integer, qt_reunioes integer,
  situacao text, sincronizado_em timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.id, c.nome, c.cliente, b.cnpj_contratante, COALESCE(b.objeto, ce.objeto),
         b.valor_mensal, COALESCE(b.valor_mensal_contrato, c.valor_mensal_contratado),
         b.qt_postos, b.qt_colaboradores, b.qt_postos_orcados,
         (SELECT count(DISTINCT l.local_nome)::int FROM public."IMPLANTACAO_BASE_LOCAL" l WHERE l.base_id = b.id),
         (SELECT count(DISTINCT l.cidade)::int     FROM public."IMPLANTACAO_BASE_LOCAL" l WHERE l.base_id = b.id AND l.cidade IS NOT NULL),
         (SELECT count(DISTINCT p.tipo_servico)::int FROM public."IMPLANTACAO_BASE_POSTO" p WHERE p.base_id = b.id),
         (SELECT count(*)::int FROM public."IMPLANTACAO_BASE_ITEM" i WHERE i.base_id = b.id AND i.tipo IN ('uniforme', 'epi')),
         (SELECT count(*)::int FROM public."IMPLANTACAO_BASE_ITEM" i WHERE i.base_id = b.id AND i.tipo NOT IN ('uniforme', 'epi')),
         (SELECT count(*)::int FROM public."IMPLANTACAO_BASE_PRAZO" x WHERE x.base_id = b.id),
         (SELECT count(*)::int FROM public."IMPLANTACAO_BASE_DOC"   x WHERE x.base_id = b.id),
         (SELECT count(*)::int FROM public."IMPLANTACAO_BASE_REUNIAO" x WHERE x.base_id = b.id),
         b.situacao, b.sincronizado_em
    FROM public."IMPLANTACAO_BASE" b
    JOIN public.contratos c ON c.id = b.contrato_id
    LEFT JOIN public.capa_edital ce ON ce.contrato_id = c.id
   WHERE b.contrato_id = p_contrato_id
     AND public.implantacao_base_pode_ver();
$$;

REVOKE ALL ON FUNCTION public.implantacao_base_resumo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.implantacao_base_resumo(uuid) TO authenticated;

-- ── 6) Financeiro: o valor do posto é por PESSOA, não por linha ─────────────
-- Antes multiplicava o unitário por qt_postos. Com posto valendo 1, isso daria
-- o custo de uma pessoa por tipo de posto e o total do contrato despencaria —
-- o multiplicador certo sempre foi a quantidade de gente.
DROP FUNCTION IF EXISTS public.implantacao_base_financeiro(uuid);
CREATE FUNCTION public.implantacao_base_financeiro(p_contrato_id uuid)
RETURNS TABLE (
  posto text, valor_posto numeric, qt_postos integer, qt_funcionarios integer,
  valor_mensal_postos numeric, faixa_custo text, participacao numeric, cidade text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT p.*, COALESCE(p.valor_posto, p.total_remuneracao, p.salario_base, 0) AS v_unit
      FROM public."IMPLANTACAO_BASE_POSTO" p
      JOIN public."IMPLANTACAO_BASE" b ON b.id = p.base_id AND b.contrato_id = p_contrato_id
     WHERE has_screen_access(auth.uid(), 'financeiro.inicio_contrato', 'visualizar'::app_acao)
        OR has_screen_access(auth.uid(), 'implantacao.base',           'visualizar'::app_acao)
  ), tot AS (SELECT NULLIF(sum(v_unit * qt_funcionarios), 0) AS total FROM base)
  SELECT b.tipo_servico, b.v_unit, b.qt_postos, b.qt_funcionarios,
         b.v_unit * b.qt_funcionarios,
         CASE WHEN b.v_unit >= 10000 THEN 'alta' WHEN b.v_unit >= 5000 THEN 'media' ELSE 'baixa' END,
         round(100 * (b.v_unit * b.qt_funcionarios) / (SELECT total FROM tot), 2),
         b.cidade
    FROM base b
   ORDER BY b.v_unit * b.qt_funcionarios DESC;
$$;

REVOKE ALL ON FUNCTION public.implantacao_base_financeiro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.implantacao_base_financeiro(uuid) TO authenticated;

-- ── 7) Recarrega o contrato-piloto com a conta certa ────────────────────────
-- Sem gate de permissão: quem roda migration é o dono do banco, não um usuário
-- logado (auth.uid() é nulo aqui — foi o que recusou a carga por chave de
-- serviço em 15/10).
DO $$
DECLARE
  v_contrato uuid := '3918b9ef-ea35-415a-b9f1-9790c863da7f';  -- POLÍCIA CIVIL RS LIMPEZA - 066/2026
  v_base     uuid;
  v_emp      uuid;
BEGIN
  SELECT b.id, b.empresa_id INTO v_base, v_emp
    FROM public."IMPLANTACAO_BASE" b WHERE b.contrato_id = v_contrato;
  IF v_base IS NULL THEN
    RAISE NOTICE 'Contrato-piloto sem base neste banco; recarga ignorada.';
    RETURN;
  END IF;

  DELETE FROM public."IMPLANTACAO_BASE_POSTO" t WHERE t.base_id = v_base AND t.origem = 'base';
  INSERT INTO public."IMPLANTACAO_BASE_POSTO"
    (base_id, empresa_id, ordem, tipo_servico, tipo_posto, qt_postos, qt_funcionarios,
     salario_base, total_remuneracao, valor_posto, sindicato, insalubridade,
     vt_dia, vt_desconto, va_dia, planilha_custo_id, origem)
  SELECT v_base, v_emp, row_number() OVER (ORDER BY pc.posto),
         pc.posto, pc.servico, 1, COALESCE(pc.qt_postos, 0),
         pc.salario,
         COALESCE(pc.salario,0) + COALESCE(pc.insalubridade,0) + COALESCE(pc.periculosidade,0)
           + COALESCE(pc.lideranca,0) + COALESCE(pc.adicional_noturno_reduzido,0)
           + COALESCE(pc.adicional_noturno,0) + COALESCE(pc.adicional_extra,0) + COALESCE(pc.dsr,0),
         pc.total_por_empregado,
         pc.sindicato, pc.insalubridade,
         NULLIF(pc.transporte, 0), NULLIF(pc.transporte_desconto, 0),
         CASE WHEN COALESCE(pc.aux_alimentacao,0) > 0
              THEN replace(to_char(pc.aux_alimentacao, 'FM999999990.00'), '.', ',') END,
         pc.id, 'base'
    FROM public.planilha_custo_vigente(v_contrato, 'EXECUTADO') pc
   WHERE NOT EXISTS (SELECT 1 FROM public."IMPLANTACAO_BASE_POSTO" x
                      WHERE x.base_id = v_base AND x.origem <> 'base'
                        AND upper(x.tipo_servico) = upper(pc.posto));

  UPDATE public."IMPLANTACAO_BASE" b
     SET qt_postos        = COALESCE((SELECT sum(p.qt_postos)       FROM public."IMPLANTACAO_BASE_POSTO" p WHERE p.base_id = v_base), 0),
         qt_colaboradores = COALESCE((SELECT sum(p.qt_funcionarios) FROM public."IMPLANTACAO_BASE_POSTO" p WHERE p.base_id = v_base), 0),
         valor_mensal     = COALESCE((SELECT sum(COALESCE(p.valor_posto,0) * p.qt_funcionarios)
                                        FROM public."IMPLANTACAO_BASE_POSTO" p WHERE p.base_id = v_base), 0),
         valor_mensal_contrato    = COALESCE(b.valor_mensal_contrato,
                                             (SELECT c.valor_mensal_contratado FROM public.contratos c WHERE c.id = v_contrato)),
         qt_postos_orcados        = COALESCE((SELECT count(*) FROM public.planilha_custo_vigente(v_contrato, 'ORÇADO')), 0),
         qt_colaboradores_orcados = COALESCE((SELECT sum(COALESCE(v.qt_postos,0)) FROM public.planilha_custo_vigente(v_contrato, 'ORÇADO') v), 0),
         sincronizado_em  = now()
   WHERE b.id = v_base;

  RAISE NOTICE 'Contrato-piloto recarregado pela regra da Planilha de Custo.';
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA (o que a tela tem que mostrar depois disto)
--   SELECT qt_postos, qt_colaboradores, valor_mensal, valor_mensal_contrato
--     FROM public."IMPLANTACAO_BASE"
--    WHERE contrato_id = '3918b9ef-ea35-415a-b9f1-9790c863da7f';
--   -- esperado: 48 | 177 | 848424.56 | 879461.82
-- ============================================================================

-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- DROP FUNCTION IF EXISTS public.implantacao_base_contratos_painel();
-- DROP FUNCTION IF EXISTS public.planilha_custo_vigente(uuid, text);
-- ALTER TABLE public."IMPLANTACAO_BASE"
--   DROP COLUMN IF EXISTS qt_postos_orcados,
--   DROP COLUMN IF EXISTS qt_colaboradores_orcados,
--   DROP COLUMN IF EXISTS valor_mensal_contrato;
-- (implantacao_base_semear, _resumo e _financeiro voltam pelas migs 0001/0002)
-- NOTIFY pgrst, 'reload schema';
