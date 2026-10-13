-- ============================================================================
-- Implantacao de Contratos -- o seletor de treinamentos (e o bloco de origem)
-- estavam gateados pelo menu ERRADO.
--
-- Sintoma relatado em 13/10/2026: em /app/licitacoes/implantacao, o item
-- "Marque quais treinamentos exigidos" (row_index 22) mostrava
-- "Nenhum curso cadastrado em Treinamentos > Cursos" mesmo com 16 cursos vivos
-- em "TRN_CURSO" e com a tela /app/treinamentos/cursos listando todos.
--
-- Causa: existem DOIS menus para implantacao em app_menu --
--   * 'implantacao'            -> rota legada  /app/contratos/implantacao
--   * 'licitacoes.implantacao' -> rota em uso  /app/licitacoes/implantacao
-- As policies de implantacao_contrato e checklist_respostas ja aceitam os dois
-- (can_access(... 'licitacoes.implantacao' ...) OR can_access(... 'implantacao' ...)),
-- por isso a tela abre e salva normalmente. As duas funcoes SECURITY DEFINER
-- criadas em 20261013000013 ficaram so com o codigo legado, e como o gate mora
-- no WHERE, o resultado nao e erro: e lista vazia. (Medido na producao: dos 26
-- usuarios com 'licitacoes.implantacao'/visualizar, apenas 1 passava em
-- 'implantacao'/visualizar -- ou seja, 25 pessoas viam o seletor vazio.)
--
-- Correcao: as duas funcoes passam a usar o mesmo OR das policies. Nenhuma
-- permissao nova e concedida: quem ja abre a tela passa a enxergar o catalogo
-- de cursos e o bloco de origem que o checklist sempre precisou.
--
-- Relacionado: 20261013000013 (criou as funcoes), 20260930000275 (origem
-- Capa/Grade), 20260718100006 (gate original de implantacao).
-- ============================================================================

-- 1. Bloco de origem (Capa/Grade/Planilha de Custo) do cabecalho do checklist.
CREATE OR REPLACE FUNCTION public.implantacao_origem_contrato(p_contrato_id uuid)
RETURNS TABLE (
  locais_postos                    text,    -- row_index 3  -- Planilha de Custo
  escalas_postos                   text,    -- row_index 4  -- descricao dos postos
  prazo_envio_treinamentos         text,    -- row_index 25 -- Capa de Edital
  epis_especificados               text,    -- row_index 27 -- Capa de Edital
  insalubridade_periculosidade     text,    -- row_index 28 -- Planilha de Custo
  data_inicio                      text,    -- row_index 31 -- Capa de Edital
  data_homologacao                 text,    -- row_index 48 -- Capa de Edital
  abertura                         text,    -- row_index 49 -- Capa de Edital
  data_captacao                    text,    -- row_index 50 -- Grade
  edital                           text,    -- row_index 51 -- Grade
  horario                          text,    -- row_index 52 -- Grade
  cidade                           text,    -- row_index 53 -- Grade
  objeto                           text,    -- row_index 54 -- Capa de Edital
  empresa                          text,    -- row_index 55 -- Capa de Edital
  responsavel                      text,    -- row_index 56 -- Capa de Edital
  posicao                          text,    -- row_index 57 -- Grade
  uf                               text,    -- row_index 58 -- Capa/Grade
  status                           text,    -- row_index 59 -- Capa de Edital
  fase                             text,    -- row_index 60 -- Grade vinculada
  valor_global                     text,    -- row_index 61 -- Capa/Grade
  qtd_postos                       integer  -- row_index 62 -- Capa/Grade
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT
      ic.id,
      coalesce(ic.contrato_id, c.contrato_id) AS contrato_oficial_id,
      ic.data_inicio AS implantacao_data_inicio,
      ic.abertura AS implantacao_abertura,
      c.id AS capa_id,
      c.data_inicio,
      c.data_homologacao,
      c.abertura,
      c.objeto,
      c.cidade AS capa_cidade,
      c.uf AS capa_uf,
      c.valor_estimado,
      c.qtd_postos,
      c.responsavel,
      c.status,
      c.prazo_envio_treinamentos,
      c.epis_especificados,
      g.edital,
      g.horario,
      g.cidade AS grade_cidade,
      g.uf AS grade_uf,
      g.data AS grade_data,
      g.data_captacao,
      g.posicao,
      g.fase,
      g.valor_global AS grade_valor_global,
      g.qtd_pessoas,
      e.razao_social,
      e.nome_fantasia
    FROM public.implantacao_contrato ic
    LEFT JOIN public.capa_edital c ON c.id = ic.capa_id
    LEFT JOIN public.grade       g ON g.id = c.grade_id
    LEFT JOIN public.empresas    e ON e.id = c.empresa_id
    WHERE ic.id = p_contrato_id
      AND (SELECT public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'visualizar'::app_acao)
            OR  public.can_access(auth.uid(), 'implantacao'::text, 'visualizar'::app_acao))
  ),
  -- Uma linha vigente por posto. A mesma regra conceitual da tela de Planilha
  -- de Custo: executado, nao encerrado e a vigencia mais recente ate hoje.
  custo_vigente AS (
    SELECT DISTINCT ON (pc.contrato_id, pc.posto)
           pc.id, pc.contrato_id, pc.posto, pc.insalubridade,
           pc.periculosidade, pc.data_vigencia, pc.created_at
      FROM public.planilha_custo pc
      JOIN base b ON b.contrato_oficial_id = pc.contrato_id
     WHERE pc.orexec = 'EXECUTADO'
       AND NOT coalesce(pc.encerrado, false)
       AND (pc.data_vigencia IS NULL OR pc.data_vigencia <= current_date)
       AND nullif(btrim(pc.posto), '') IS NOT NULL
     ORDER BY pc.contrato_id, pc.posto,
              pc.data_vigencia DESC NULLS LAST, pc.created_at DESC
  ),
  custo_resumo AS (
    SELECT
      cv.contrato_id,
      string_agg(cv.posto, E'\n' ORDER BY cv.posto) AS escalas_postos,
      string_agg(
        concat(
          cv.posto, ': ',
          CASE
            WHEN coalesce(cv.insalubridade, 0) <= 0
             AND coalesce(cv.periculosidade, 0) <= 0 THEN 'Sem adicional'
            ELSE concat_ws(' | ',
              CASE WHEN coalesce(cv.insalubridade, 0) > 0
                   THEN 'Insalubridade: R$ ' || replace(round(cv.insalubridade, 2)::text, '.', ',') END,
              CASE WHEN coalesce(cv.periculosidade, 0) > 0
                   THEN 'Periculosidade: R$ ' || replace(round(cv.periculosidade, 2)::text, '.', ',') END
            )
          END
        ),
        E'\n' ORDER BY cv.posto
      ) AS insalubridade_periculosidade
    FROM custo_vigente cv
    GROUP BY cv.contrato_id
  ),
  locais_resumo AS (
    SELECT
      cv.contrato_id,
      string_agg(
        concat(
          cv.posto, ': ',
          concat_ws(', ',
            nullif(btrim(pl.nome), ''),
            nullif(btrim(concat_ws(' ', nullif(btrim(pl.logradouro), ''), nullif(btrim(pl.numero), ''))), ''),
            nullif(btrim(pl.complemento), ''),
            nullif(btrim(pl.bairro), ''),
            nullif(btrim(concat_ws('/', nullif(btrim(pl.municipio), ''), nullif(btrim(pl.uf), ''))), ''),
            CASE WHEN nullif(btrim(pl.cep), '') IS NOT NULL THEN 'CEP ' || btrim(pl.cep) END
          )
        ),
        E'\n' ORDER BY cv.posto, pl.nome, pl.logradouro
      ) AS locais_postos
    FROM custo_vigente cv
    JOIN public.planilha_posto_localizacao pl ON pl.planilha_custo_id = cv.id
    GROUP BY cv.contrato_id
  )
  SELECT
    -- Endereco nao cai para o nome do posto: sem localizacao cadastrada, a
    -- tela precisa sinalizar "sem dado" em vez de confirmar dado incompleto.
    lr.locais_postos,
    cr.escalas_postos,
    nullif(btrim(b.prazo_envio_treinamentos), ''),
    nullif(btrim(b.epis_especificados), ''),
    cr.insalubridade_periculosidade,
    coalesce(b.data_inicio::text, b.implantacao_data_inicio::text),
    b.data_homologacao::text,
    coalesce(nullif(btrim(b.abertura), ''), nullif(btrim(b.implantacao_abertura), ''), b.grade_data::text),
    b.data_captacao::text,
    nullif(btrim(b.edital), ''),
    nullif(btrim(b.horario), ''),
    coalesce(nullif(btrim(b.grade_cidade), ''), nullif(btrim(b.capa_cidade), '')),
    nullif(btrim(b.objeto), ''),
    coalesce(nullif(btrim(b.razao_social), ''), nullif(btrim(b.nome_fantasia), '')),
    nullif(btrim(b.responsavel), ''),
    CASE WHEN b.posicao IS NULL THEN NULL ELSE b.posicao::text || 'º' END,
    coalesce(nullif(btrim(b.capa_uf), ''), nullif(btrim(b.grade_uf), '')),
    b.status::text,
    b.fase::text,
    coalesce(nullif(btrim(b.valor_estimado), ''), nullif(btrim(b.grade_valor_global), '')),
    nullif(coalesce(b.qtd_postos, b.qtd_pessoas), 0)
  FROM base b
  LEFT JOIN custo_resumo cr ON cr.contrato_id = b.contrato_oficial_id
  LEFT JOIN locais_resumo lr ON lr.contrato_id = b.contrato_oficial_id;
$$;

REVOKE ALL ON FUNCTION public.implantacao_origem_contrato(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.implantacao_origem_contrato(uuid) TO authenticated;

-- 2. Catalogo de cursos do item "Marque quais treinamentos exigidos".
CREATE OR REPLACE FUNCTION public.implantacao_treinamentos_disponiveis()
RETURNS TABLE (id uuid, nome text, publicado boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.nome, c.publicado
    FROM public."TRN_CURSO" c
   WHERE (SELECT public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'visualizar'::app_acao)
           OR  public.can_access(auth.uid(), 'implantacao'::text, 'visualizar'::app_acao))
   ORDER BY c.publicado DESC, lower(c.nome), c.id;
$$;

REVOKE ALL ON FUNCTION public.implantacao_treinamentos_disponiveis() FROM public;
GRANT EXECUTE ON FUNCTION public.implantacao_treinamentos_disponiveis() TO authenticated;

COMMENT ON FUNCTION public.implantacao_treinamentos_disponiveis() IS
  'Lista minima de cursos para o seletor do checklist de Implantacao; aceita os dois codigos de menu da tela (licitacoes.implantacao e o legado implantacao).';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (volta ao gate somente-legado de 20261013000013):
--
-- CREATE OR REPLACE FUNCTION public.implantacao_treinamentos_disponiveis()
-- RETURNS TABLE (id uuid, nome text, publicado boolean)
-- LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
-- AS $$
--   SELECT c.id, c.nome, c.publicado
--     FROM public."TRN_CURSO" c
--    WHERE (SELECT public.can_access(auth.uid(), 'implantacao'::text, 'visualizar'::app_acao))
--    ORDER BY c.publicado DESC, lower(c.nome), c.id;
-- $$;
-- -- E reaplicar implantacao_origem_contrato de 20261013000013 (linhas 49-209).
-- NOTIFY pgrst, 'reload schema';
-- ============================================================================
