-- =====================================================================
-- ESPAÇO DO COLABORADOR — corrige as FONTES da árvore
--
-- A 20260930000051 montou a árvore em cima das tabelas erradas. Esta
-- migration troca as fontes. Nada da estrutura de acesso muda: o menu, a
-- policy aditiva e a guarda esp_col_exige_acesso continuam como estão.
--
-- OS QUATRO ERROS
--
--   1. POSTO NÃO VEM DE sup_posto. `sup_posto`/`sup_funcao` são o catálogo
--      de COMPRAS (Supply): linhas que o encarregado cria para pedir
--      uniforme/EPI, que nascem com `aprovado = false` e existem para
--      montar o enxoval de uma função. Não são a estrutura operacional do
--      contrato — tanto que a própria 20260830000001 registrou que os
--      "Nome do Posto" de EMPREGADOS não têm NENHUMA correspondência com
--      sup_posto.
--
--      O posto de verdade nasce na LICITAÇÃO, em `planilha_custo`: uma
--      linha por posto do contrato, com `contrato_id` para `contratos`,
--      `posto`, `servico`, `qt_postos` (quantas pessoas o posto comporta) e
--      toda a composição financeira. É o que o usuário preenche quando o
--      contrato é criado. A geografia fica em `planilha_posto_localizacao`.
--
--   2. O ELO COM O CONTRATO NÃO É SÓ "Nome Filial". A coluna que guarda o
--      NOME DO CONTRATO do colaborador é `"Descrição do Local"` — é o que
--      a RH_CONTRATO_ENCARREGADO (20260722000001) usa como chave e o que a
--      tela de Troca de Função lê, com "Nome Filial" só de fallback para
--      quem está sem local. A 51 usava a filial como fonte principal, que
--      era o caminho do Supply, não o do RH.
--
--   3. ENCARREGADO JÁ TEM TABELA. `"RH_CONTRATO_ENCARREGADO"` guarda a
--      designação por contrato (contrato → EMPREGADOS."ID"), feita à mão
--      justamente porque o cadastro não resolve isso sozinho. A 51 adivinhava
--      com regex sobre o "Título do Cargo" e ignorava a designação real.
--
--   4. "LIDER" NÃO É O LÍDER DA PESSOA — é o NÍVEL DELA. A coluna guarda
--      ADMIN / CEO / DIREÇÃO / … / SUPERVISOR / ENCARREGADO / LÍDER (ver
--      NIVEIS em LideresSetor.tsx; o EmpregadoDetalheModal chega a avisar
--      quando o valor não é um nível conhecido). A 51 exibia isso como
--      "Líder" na ficha, e usava regex no cargo para achar supervisor e
--      encarregado quando a resposta estava nesta coluna o tempo todo.
--
-- O QUE AINDA NÃO EXISTE (e por isso não é inventado aqui)
--
--   O fluxo futuro é: Licitação cria o contrato e seus postos → Operação
--   preenche o SUPERVISOR do contrato e quais POSTOS cada encarregado
--   cuida. Hoje só metade disso tem tabela: RH_CONTRATO_ENCARREGADO amarra
--   encarregado ao CONTRATO, não ao POSTO, e supervisor não tem tabela
--   nenhuma. Enquanto a tela da Operação não existir, a árvore mostra:
--     • supervisores  = nível SUPERVISOR dentro do contrato (derivado);
--     • encarregados  = a designação de RH_CONTRATO_ENCARREGADO, e os de
--                       nível ENCARREGADO como complemento, marcados como
--                       derivados para ninguém confundir com designação.
--   Quando a Operação ganhar a tela, troca-se a fonte aqui e a árvore
--   continua igual.
-- =====================================================================


-- ── 1. Resolver o contrato de um colaborador ─────────────────────────
--
-- Vira função para as três RPCs usarem a MESMA regra. Com a regra copiada
-- em três lugares, a árvore, a busca e a ficha divergem no dia em que
-- alguém corrigir uma delas — e divergir aqui significa a mesma pessoa
-- aparecendo em contratos diferentes conforme a tela.
--
-- Ordem de precedência, da mais confiável para a menos:
--   1. "Descrição do Local" — a coluna que É o nome do contrato;
--   2. o de-para manual do RH, para as filiais cuja grafia não casa;
--   3. "Nome Filial" — fallback de quem está sem local preenchido.
CREATE OR REPLACE FUNCTION public.esp_col_contrato_id(
  p_local  text,
  p_filial text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
  SELECT COALESCE(
    (SELECT c.id FROM public.contratos c
      WHERE public.sup_norm_nome(c.nome) = public.sup_norm_nome(p_local)
        AND COALESCE(btrim(p_local), '') <> '' LIMIT 1),
    (SELECT dp.contrato_id FROM public.sup_empregado_contrato_depara dp
      WHERE dp.filial_nome = p_filial LIMIT 1),
    (SELECT c.id FROM public.contratos c
      WHERE public.sup_norm_nome(c.nome) = public.sup_norm_nome(p_filial)
        AND COALESCE(btrim(p_filial), '') <> '' LIMIT 1)
  );
$fn$;

REVOKE ALL ON FUNCTION public.esp_col_contrato_id(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_contrato_id(text, text) TO authenticated;


-- ── 2. A árvore, agora com os postos da planilha de custo ────────────
--
-- `planilha_custo` guarda histórico: o mesmo posto reaparece a cada
-- vigência. DISTINCT ON pega a linha mais recente de cada posto — sem isso
-- um contrato de três anos mostraria "Recepção Área Sul" três vezes, com
-- três valores de qt_postos, e ninguém saberia qual vale hoje.
--
-- O filtro é o mesmo que Documentos, Implantação, ChecklistImplantacao e
-- ContratosERP já usam: EXECUTADO, não encerrado, com vigência.
CREATE OR REPLACE FUNCTION public.esp_col_arvore()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.esp_col_exige_acesso();

  WITH posto_vivo AS (
    SELECT DISTINCT ON (pc.contrato_id, public.sup_norm_nome(pc.posto))
           pc.id, pc.contrato_id, btrim(pc.posto) AS posto, pc.servico,
           pc.qt_postos, pc.data_vigencia
      FROM public.planilha_custo pc
     WHERE pc.contrato_id IS NOT NULL
       AND pc.orexec = 'EXECUTADO'
       AND NOT COALESCE(pc.encerrado, false)
       AND pc.data_vigencia IS NOT NULL
       AND COALESCE(btrim(pc.posto), '') <> ''
     ORDER BY pc.contrato_id, public.sup_norm_nome(pc.posto), pc.data_vigencia DESC
  ),
  posto_local AS (
    -- Onde o posto fica, e quantas pessoas ele comporta por local.
    SELECT l.planilha_custo_id,
           jsonb_agg(jsonb_build_object(
             'id', l.id, 'nome', l.nome, 'municipio', l.municipio, 'uf', l.uf,
             'orcadas', l.qt_pessoas_orcadas, 'executadas', l.qt_pessoas_executadas)
             ORDER BY l.nome) AS itens
      FROM public.planilha_posto_localizacao l
     GROUP BY l.planilha_custo_id
  ),
  postos AS (
    SELECT pv.contrato_id,
           jsonb_agg(jsonb_build_object(
             'id', pv.id, 'nome', pv.posto, 'servico', pv.servico,
             'vagas', pv.qt_postos, 'vigencia', pv.data_vigencia,
             'locais', COALESCE(pl.itens, '[]'::jsonb))
             ORDER BY pv.posto) AS itens,
           count(*)::int          AS qtd_postos,
           sum(COALESCE(pv.qt_postos, 0))::numeric AS vagas
      FROM posto_vivo pv
      LEFT JOIN posto_local pl ON pl.planilha_custo_id = pv.id
     GROUP BY pv.contrato_id
  ),
  cont_qtd AS (
    SELECT public.esp_col_contrato_id(e."Descrição do Local", e."Nome Filial") AS contrato_id,
           count(*)::int AS qtd
      FROM public."EMPREGADOS" e
     WHERE COALESCE(e."Situação", '') <> 'Demitido'
       AND COALESCE(btrim(e."Nome"), '') <> ''
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'id', c.id, 'nome', c.nome, 'cliente', c.cliente, 'status', c.status,
             'colaboradores', COALESCE(cq.qtd, 0),
             'qtd_postos',    COALESCE(pt.qtd_postos, 0),
             'vagas',         COALESCE(pt.vagas, 0),
             -- A designação da Operação, quando existe. A chave da
             -- RH_CONTRATO_ENCARREGADO é o TEXTO do contrato
             -- ("Descrição do Local"), não o uuid — por isso o casamento
             -- aqui é por nome normalizado.
             'encarregado_designado', (
               SELECT jsonb_build_object('id', r.encarregado_id, 'nome', r.encarregado_nome)
                 FROM public."RH_CONTRATO_ENCARREGADO" r
                WHERE public.sup_norm_nome(r.contrato) = public.sup_norm_nome(c.nome)
                LIMIT 1),
             'postos', COALESCE(pt.itens, '[]'::jsonb))
           ORDER BY c.nome), '[]'::jsonb)
    INTO v_out
    FROM public.contratos c
    LEFT JOIN postos   pt ON pt.contrato_id = c.id
    LEFT JOIN cont_qtd cq ON cq.contrato_id = c.id
   WHERE COALESCE(c.status, 'ativo') <> 'encerrado';

  RETURN v_out;
END $fn$;

REVOKE ALL ON FUNCTION public.esp_col_arvore() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_arvore() TO authenticated;


-- ── 3. Colaboradores: ganha o NÍVEL ──────────────────────────────────
--
-- DROP antes do CREATE porque a assinatura muda (a tabela de retorno ganha
-- `nivel`), e CREATE OR REPLACE não altera tipo de retorno.
DROP FUNCTION IF EXISTS public.esp_col_colaboradores(uuid, text, int);
CREATE FUNCTION public.esp_col_colaboradores(
  p_contrato_id uuid DEFAULT NULL,
  p_busca       text DEFAULT NULL,
  p_limite      int  DEFAULT 500)
RETURNS TABLE (
  empregado_id bigint,
  matricula    text,
  nome         text,
  cargo        text,
  posto        text,
  local        text,
  filial       text,
  situacao     text,
  admissao     date,
  -- EMPREGADOS."LIDER": o nível hierárquico DA PESSOA (SUPERVISOR,
  -- ENCARREGADO, …), não o nome de quem lidera ela.
  nivel        text,
  contrato_id  uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_lim    int := least(greatest(COALESCE(p_limite, 500), 1), 2000);
  v_termos text[];
BEGIN
  PERFORM public.esp_col_exige_acesso();

  v_termos := array_remove(string_to_array(public.sup_norm_busca(COALESCE(p_busca, '')), ' '), '');

  RETURN QUERY
  SELECT e."ID"::bigint,
         nullif(btrim(e."Cadastro"::text), ''),
         e."Nome",
         e."Título do Cargo",
         e."Nome do Posto",
         e."Descrição do Local",
         e."Nome Filial",
         e."Situação",
         public.rh_data(e."Admissão"::text),
         btrim(COALESCE(e."LIDER", '')),
         public.esp_col_contrato_id(e."Descrição do Local", e."Nome Filial")
    FROM public."EMPREGADOS" e
   WHERE COALESCE(e."Situação", '') <> 'Demitido'
     AND COALESCE(btrim(e."Nome"), '') <> ''
     AND (p_contrato_id IS NULL
          OR public.esp_col_contrato_id(e."Descrição do Local", e."Nome Filial") = p_contrato_id)
     AND (cardinality(v_termos) = 0 OR NOT EXISTS (
            SELECT 1 FROM unnest(v_termos) t
             WHERE public.sup_norm_busca(e."Nome") NOT LIKE '%' || t || '%'))
   ORDER BY e."Nome"
   LIMIT v_lim;
END $fn$;

REVOKE ALL ON FUNCTION public.esp_col_colaboradores(uuid, text, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_colaboradores(uuid, text, int) TO authenticated;


-- ── 4. Ficha: nível no lugar de "líder", e o encarregado do contrato ──
DROP FUNCTION IF EXISTS public.esp_col_ficha(text);
CREATE FUNCTION public.esp_col_ficha(p_ref text)
RETURNS TABLE (
  empregado_id       bigint,
  matricula          text,
  nome               text,
  cargo              text,
  posto              text,
  local              text,
  filial             text,
  empresa            text,
  setor              text,
  situacao           text,
  admissao           date,
  escala             text,
  nivel              text,
  contrato_id        uuid,
  contrato_nome      text,
  encarregado_nome   text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_ref text := btrim(COALESCE(p_ref, ''));
  v_num bigint;
BEGIN
  PERFORM public.esp_col_exige_acesso();
  IF v_ref = '' THEN RETURN; END IF;

  v_num := CASE WHEN v_ref ~ '^[0-9]+$' THEN v_ref::bigint ELSE NULL END;

  RETURN QUERY
  SELECT e."ID"::bigint,
         nullif(btrim(e."Cadastro"::text), ''),
         e."Nome",
         e."Título do Cargo",
         e."Nome do Posto",
         e."Descrição do Local",
         e."Nome Filial",
         e."Nome da Empresa",
         e."Setor_ERP",
         e."Situação",
         public.rh_data(e."Admissão"::text),
         e."Escala",
         btrim(COALESCE(e."LIDER", '')),
         ct.id,
         ct.nome,
         (SELECT r.encarregado_nome FROM public."RH_CONTRATO_ENCARREGADO" r
           WHERE public.sup_norm_nome(r.contrato) = public.sup_norm_nome(ct.nome)
           LIMIT 1)
    FROM public."EMPREGADOS" e
    LEFT JOIN public.contratos ct
           ON ct.id = public.esp_col_contrato_id(e."Descrição do Local", e."Nome Filial")
   WHERE btrim(e."Cadastro"::text) = v_ref
      OR (v_num IS NOT NULL AND e."ID" = v_num)
   ORDER BY (btrim(e."Cadastro"::text) = v_ref) DESC
   LIMIT 1;
END $fn$;

REVOKE ALL ON FUNCTION public.esp_col_ficha(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_ficha(text) TO authenticated;


NOTIFY pgrst, 'reload schema';


-- ── Conferência ──────────────────────────────────────────────────────
-- Quantos contratos têm posto na planilha de custo, e quantas pessoas
-- casam com contrato. Se `com_posto` vier 0, a árvore aparece sem postos —
-- é sinal de planilha_custo sem contrato_id preenchido, não de bug na RPC.
SELECT count(DISTINCT pc.contrato_id) AS contratos_com_posto,
       count(*)                       AS linhas_de_posto_vivas
  FROM public.planilha_custo pc
 WHERE pc.contrato_id IS NOT NULL
   AND pc.orexec = 'EXECUTADO'
   AND NOT COALESCE(pc.encerrado, false)
   AND pc.data_vigencia IS NOT NULL;

-- Cobertura do casamento pessoa → contrato, pelas três vias.
SELECT count(*) FILTER (WHERE public.esp_col_contrato_id(e."Descrição do Local", e."Nome Filial") IS NOT NULL) AS com_contrato,
       count(*) FILTER (WHERE public.esp_col_contrato_id(e."Descrição do Local", e."Nome Filial") IS NULL)     AS sem_contrato,
       count(*) AS total_ativos
  FROM public."EMPREGADOS" e
 WHERE COALESCE(e."Situação", '') <> 'Demitido'
   AND COALESCE(btrim(e."Nome"), '') <> '';


-- =====================================================================
-- ROLLBACK
--   Volta a 20260930000051: reexecutar aquele arquivo recria esp_col_arvore,
--   esp_col_colaboradores e esp_col_ficha nas versões antigas. Depois:
--   DROP FUNCTION IF EXISTS public.esp_col_contrato_id(text, text);
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
