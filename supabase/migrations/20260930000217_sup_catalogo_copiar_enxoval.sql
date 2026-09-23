-- =====================================================================
-- Catálogo de Materiais: copiar o enxoval de uma função para outras
-- funções do mesmo contrato.
--
-- Um contrato pode ter dezenas de postos com a mesma composição de
-- uniforme/EPI. A cópia precisa criar o vínculo e o rascunho de aprovação
-- juntos: gravá-los do navegador em chamadas separadas deixaria itens no
-- enxoval sem uma alteração correspondente se uma das chamadas falhasse.
--
-- A função é deliberadamente restrita ao mesmo contrato. Assim, o usuário
-- não leva por engano um enxoval de uma operação para outra, mas consegue
-- replicá-lo para todos os postos equivalentes de uma só vez.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_cat_copiar_enxoval(uuid, uuid[]);
-- =====================================================================

CREATE OR REPLACE FUNCTION public.sup_cat_copiar_enxoval(
  p_funcao_origem_id uuid,
  p_funcoes_destino_ids uuid[]
) RETURNS TABLE(funcoes_destino integer, itens_copiados integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_empresa_id uuid;
  v_contrato_id uuid;
  v_funcao_origem_nome text;
  v_total_destinos integer;
  v_destinos_validos integer;
  v_itens_copiados integer;
  v_criado_por_nome text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF NOT public.can_access(v_uid, 'sup_catalogo', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o catálogo';
  END IF;

  SELECT p.empresa_id, p.contrato_id, f.nome
    INTO v_empresa_id, v_contrato_id, v_funcao_origem_nome
    FROM public.sup_funcao f
    JOIN public.sup_posto p ON p.id = f.posto_id
   WHERE f.id = p_funcao_origem_id
     AND f.ativo
     AND p.ativo;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Função de origem não encontrada ou inativa';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.user_empresa ue
     WHERE ue.user_id = v_uid
       AND ue.empresa_id = v_empresa_id
  ) THEN
    RAISE EXCEPTION 'Sem acesso à empresa da função de origem';
  END IF;

  WITH destinos AS (
    SELECT DISTINCT funcao_id
      FROM unnest(p_funcoes_destino_ids) AS d(funcao_id)
     WHERE funcao_id IS NOT NULL
  )
  SELECT count(*) INTO v_total_destinos FROM destinos;

  IF v_total_destinos = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos uma função de destino';
  END IF;

  WITH destinos AS (
    SELECT DISTINCT funcao_id
      FROM unnest(p_funcoes_destino_ids) AS d(funcao_id)
     WHERE funcao_id IS NOT NULL
  )
  SELECT count(*) INTO v_destinos_validos
    FROM destinos d
    JOIN public.sup_funcao f ON f.id = d.funcao_id
    JOIN public.sup_posto p ON p.id = f.posto_id
   WHERE f.ativo
     AND p.ativo
     AND p.contrato_id = v_contrato_id
     AND f.id <> p_funcao_origem_id;

  IF v_destinos_validos <> v_total_destinos THEN
    RAISE EXCEPTION 'Todas as funções de destino devem estar ativas, ser diferentes da origem e pertencer ao mesmo contrato';
  END IF;

  SELECT p.display_name INTO v_criado_por_nome
    FROM public.profiles p
   WHERE p.id = v_uid;

  WITH destinos AS (
    SELECT DISTINCT funcao_id
      FROM unnest(p_funcoes_destino_ids) AS d(funcao_id)
     WHERE funcao_id IS NOT NULL
  ), origem AS (
    SELECT fi.item_id, fi.ordem
      FROM public.sup_funcao_item fi
     WHERE fi.funcao_id = p_funcao_origem_id
       AND fi.ativo
  ), inseridos AS (
    INSERT INTO public.sup_funcao_item (funcao_id, item_id, ordem, created_by)
    SELECT d.funcao_id, o.item_id, o.ordem, v_uid
      FROM destinos d
      CROSS JOIN origem o
    ON CONFLICT (funcao_id, item_id) DO NOTHING
    RETURNING id, funcao_id, item_id
  ), alteracoes AS (
    INSERT INTO public.sup_cat_alteracao (
      empresa_id, tipo_entidade, tipo_acao, alvo_id, dados, contexto,
      descricao, status, criado_por, criado_por_nome
    )
    SELECT
      v_empresa_id,
      'funcao_item',
      'criar',
      fi.id,
      jsonb_build_object(
        'funcao_origem_id', p_funcao_origem_id,
        'funcao_destino_id', fi.funcao_id,
        'item_id', fi.item_id,
        'origem', 'copia_enxoval'
      ),
      jsonb_build_object(
        'contrato', c.nome,
        'posto', p.nome,
        'funcao', f.nome,
        'item', i.nome
      ),
      format('Copiar "%s" do enxoval de "%s" para "%s"', i.nome, v_funcao_origem_nome, f.nome),
      'RASCUNHO',
      v_uid,
      v_criado_por_nome
    FROM inseridos fi
    JOIN public.sup_funcao f ON f.id = fi.funcao_id
    JOIN public.sup_posto p ON p.id = f.posto_id
    JOIN public.contratos c ON c.id = p.contrato_id
    JOIN public.sup_item i ON i.id = fi.item_id
    RETURNING id
  )
  SELECT count(*) INTO v_itens_copiados FROM alteracoes;

  RETURN QUERY SELECT v_total_destinos, v_itens_copiados;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sup_cat_copiar_enxoval(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_cat_copiar_enxoval(uuid, uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
