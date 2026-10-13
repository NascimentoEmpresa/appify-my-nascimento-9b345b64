-- ============================================================================
-- Implantacao de Contratos -- campos e controles definidos na planilha de
-- ajustes recebida em 13/10/2026.
--
-- A Implantacao ja centralizava, por SECURITY DEFINER, os valores vindos da
-- Capa de Edital e da Grade. Esta migration amplia a mesma fronteira para:
--   * dados adicionais da Capa/Grade;
--   * postos, localizacoes e adicionais da Planilha de Custo;
--   * catalogo de cursos usado no seletor de treinamentos;
--   * dois campos que ainda nao existiam na Capa (prazo e EPIs);
--   * plano de acao idempotente ao confirmar o prazo de treinamentos.
--
-- As funcoes continuam gateadas somente por `implantacao`: quem pode preencher
-- o checklist precisa enxergar apenas estes recortes, mesmo sem acesso direto
-- aos menus Editais, Grade, Planilha de Custo ou Cursos.
-- ============================================================================

-- 1. Campos-fonte que faltavam na Capa de Edital.
ALTER TABLE public.capa_edital
  ADD COLUMN IF NOT EXISTS prazo_envio_treinamentos text,
  ADD COLUMN IF NOT EXISTS epis_especificados text;

COMMENT ON COLUMN public.capa_edital.prazo_envio_treinamentos IS
  'Prazo definido no edital para envio/comprovacao dos treinamentos. Alimenta o checklist de Implantacao (row_index 25).';
COMMENT ON COLUMN public.capa_edital.epis_especificados IS
  'EPIs exigidos pelo edital. Alimenta o checklist de Implantacao (row_index 27).';

-- 2. Metadados dos controles pedidos na planilha.
UPDATE public.checklist_items
   SET tipo_resposta = CASE
         WHEN row_index IN (0, 1, 14) THEN 'simnao'
         WHEN row_index = 8 THEN 'multi_opcoes'
         WHEN row_index = 13 THEN 'lista_com_outro'
         WHEN row_index IN (20, 21, 23, 24, 26, 30) THEN 'simnao_detalhe'
         WHEN row_index = 22 THEN 'multi_treinamentos'
         ELSE tipo_resposta
       END,
       item = CASE
         WHEN row_index = 4 THEN 'Escala de horário de postos'
         WHEN row_index = 22 THEN 'Marque quais treinamentos exigidos'
         ELSE item
       END
 WHERE row_index IN (0, 1, 4, 8, 13, 14, 20, 21, 22, 23, 24, 26, 30);

-- 3. Recorte consolidado Capa + Grade + Planilha de Custo.
-- O retorno mudou; PostgreSQL exige DROP antes de recriar a funcao com novas
-- colunas OUT. Nao ha objeto de banco dependente dela: o unico consumidor e o
-- hook do frontend via PostgREST.
DROP FUNCTION IF EXISTS public.implantacao_origem_contrato(uuid);

CREATE FUNCTION public.implantacao_origem_contrato(p_contrato_id uuid)
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
      AND (SELECT public.can_access(auth.uid(), 'implantacao'::text, 'visualizar'::app_acao))
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

COMMENT ON FUNCTION public.implantacao_origem_contrato(uuid) IS
  'Recorte do checklist de Implantacao vindo da Capa, Grade e Planilha de Custo. Gateado por implantacao/visualizar.';

-- 4. Catalogo minimo de cursos para a pergunta de treinamentos. Nao reutiliza
-- trn_cursos_lista(): ela traz metricas/alunos e e gateada pelo menu de Cursos,
-- dados e permissao que nao devem ser exigidos para preencher a Implantacao.
CREATE OR REPLACE FUNCTION public.implantacao_treinamentos_disponiveis()
RETURNS TABLE (id uuid, nome text, publicado boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.nome, c.publicado
    FROM public."TRN_CURSO" c
   WHERE (SELECT public.can_access(auth.uid(), 'implantacao'::text, 'visualizar'::app_acao))
   ORDER BY c.publicado DESC, lower(c.nome), c.id;
$$;

REVOKE ALL ON FUNCTION public.implantacao_treinamentos_disponiveis() FROM public;
GRANT EXECUTE ON FUNCTION public.implantacao_treinamentos_disponiveis() TO authenticated;

COMMENT ON FUNCTION public.implantacao_treinamentos_disponiveis() IS
  'Lista minima de cursos para o seletor do checklist de Implantacao; nao expoe metricas nem exige o menu de Treinamentos.';

-- 5. Ao confirmar/alterar o prazo de treinamentos (row_index 25), mantem um
-- unico plano de acao. Texto livre continua aceito: quando nao for uma data
-- reconhecivel, o plano nasce com pendencia de data em vez de inventar prazo.
CREATE OR REPLACE FUNCTION public.implantacao_gerar_plano_treinamentos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_implantacao public.implantacao_contrato%ROWTYPE;
  v_data date;
  v_id_importacao text;
  v_plano_id uuid;
BEGIN
  IF NEW.row_index <> 25 OR nullif(btrim(NEW.resposta), '') IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_implantacao
    FROM public.implantacao_contrato
   WHERE id = NEW.contrato_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NEW.resposta ~ '^\d{4}-\d{2}-\d{2}$' THEN
      v_data := NEW.resposta::date;
    ELSIF NEW.resposta ~ '^\d{2}/\d{2}/\d{4}$' THEN
      v_data := to_date(NEW.resposta, 'DD/MM/YYYY');
    ELSE
      v_data := NULL;
    END IF;
  EXCEPTION WHEN others THEN
    v_data := NULL;
  END;

  v_id_importacao := 'implantacao-treinamentos:' || NEW.contrato_id::text;

  SELECT id INTO v_plano_id
    FROM public.plano_acao
   WHERE empresa_id = v_implantacao.empresa_id
     AND id_importacao = v_id_importacao
   LIMIT 1;

  IF v_plano_id IS NULL THEN
    INSERT INTO public.plano_acao (
      empresa_id, id_importacao, titulo, area, prioridade_normalizada,
      problema, acao, data_acao, data_acao_original, status_normalizado,
      pendencia_responsavel, pendencia_datas, pendencias_iniciais,
      origem, metadata_origem, criado_por, atualizado_por
    ) VALUES (
      v_implantacao.empresa_id,
      v_id_importacao,
      'Enviar treinamentos - ' || coalesce(nullif(v_implantacao.nome, ''), 'Contrato'),
      'Treinamentos',
      'media',
      'Prazo de treinamentos definido na Implantacao de Contratos.',
      'Providenciar e enviar os treinamentos exigidos pelo contrato.',
      v_data,
      NEW.resposta,
      'a_definir',
      true,
      v_data IS NULL,
      CASE WHEN v_data IS NULL
           THEN ARRAY['PENDENTE_RESPONSAVEL', 'PENDENTE_DATAS']::text[]
           ELSE ARRAY['PENDENTE_RESPONSAVEL']::text[] END,
      'implantacao_contrato',
      jsonb_build_object('implantacao_contrato_id', NEW.contrato_id, 'checklist_row_index', 25),
      auth.uid(),
      auth.uid()
    );
  ELSE
    UPDATE public.plano_acao
       SET titulo = 'Enviar treinamentos - ' || coalesce(nullif(v_implantacao.nome, ''), 'Contrato'),
           data_acao = v_data,
           data_acao_original = NEW.resposta,
           pendencia_datas = v_data IS NULL,
           pendencia_responsavel = responsavel_profile_id IS NULL,
           pendencias_iniciais = CASE
             WHEN responsavel_profile_id IS NULL AND v_data IS NULL
               THEN ARRAY['PENDENTE_RESPONSAVEL', 'PENDENTE_DATAS']::text[]
             WHEN responsavel_profile_id IS NULL
               THEN ARRAY['PENDENTE_RESPONSAVEL']::text[]
             WHEN v_data IS NULL
               THEN ARRAY['PENDENTE_DATAS']::text[]
             ELSE ARRAY[]::text[]
           END,
           deleted_at = NULL,
           atualizado_por = auth.uid(),
           updated_at = now()
     WHERE id = v_plano_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_implantacao_plano_treinamentos ON public.checklist_respostas;
CREATE TRIGGER trg_implantacao_plano_treinamentos
AFTER INSERT OR UPDATE OF resposta ON public.checklist_respostas
FOR EACH ROW
WHEN (NEW.row_index = 25)
EXECUTE FUNCTION public.implantacao_gerar_plano_treinamentos();

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (executar manualmente, se necessario)
-- ============================================================================
-- DROP TRIGGER IF EXISTS trg_implantacao_plano_treinamentos ON public.checklist_respostas;
-- DROP FUNCTION IF EXISTS public.implantacao_gerar_plano_treinamentos();
-- DROP FUNCTION IF EXISTS public.implantacao_treinamentos_disponiveis();
-- -- Reaplicar a definicao anterior de implantacao_origem_contrato da migration
-- -- 20260930000275_implantacao_origem_capa_grade.sql antes de remover colunas.
-- ALTER TABLE public.capa_edital
--   DROP COLUMN IF EXISTS prazo_envio_treinamentos,
--   DROP COLUMN IF EXISTS epis_especificados;
-- NOTIFY pgrst, 'reload schema';
-- ============================================================================
