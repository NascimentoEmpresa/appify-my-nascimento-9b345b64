-- =========================================================================
-- Catálogo: postos do contrato também para quem solicita demissão/vaga
--
-- O SINTOMA (14/09/2026)
--   Em Solicitar Demissão o campo "Posto" era travado com o que o Senior
--   traz em "Organograma"/"Descrição do Local" — vazio ou velho em muita
--   gente — e não havia como escolher, embora os postos existam no catálogo
--   de Suprimentos (contratos → sup_posto, derivados da Planilha de Custo).
--
-- A CORREÇÃO
--   A tela passa a listar os postos pelo mesmo caminho da vaga
--   (sup_cat_postos_do_contrato). Só que a RPC exigia 'sup_catalogo' +
--   visualizar, que o encarregado não tem — mesmo com a policy de leitura de
--   sup_posto já aberta para quem solicita vaga desde a 20260930000049.
--   Aqui o gate da RPC ganha os mesmos OR da policy, mais as telas de
--   demissão do encarregado. O corpo é o da 20260930000081, sem mudança.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.sup_cat_postos_do_contrato(p_contrato_id uuid)
RETURNS TABLE (
  id          uuid,
  contrato_id uuid,
  nome        text,
  ativo       boolean,
  aprovado    boolean,
  na_planilha boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
-- Os parâmetros de saída do RETURNS TABLE (id, nome, ativo, aprovado) têm o
-- mesmo nome de colunas de sup_posto que aparecem no INSERT e no ON CONFLICT
-- abaixo. Sem este pragma, plpgsql pode resolver o nome para a variável e
-- recusar a instrução por ambiguidade. Nenhuma dessas variáveis é lida aqui
-- (a devolução é por RETURN QUERY), então preferir a coluna é sempre o certo.
#variable_conflict use_column
DECLARE
  v_empresa   uuid;
  v_contrato  text;
  v_nomes     text[];   -- nomes de posto como a planilha escreveu
  v_norm      text[];   -- os mesmos, normalizados, para casar sem acento/caixa
BEGIN
  IF NOT (public.can_access(auth.uid(), 'sup_catalogo', 'visualizar')
          OR public.can_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar')
          OR public.can_access(auth.uid(), 'recrutamento_gestao', 'visualizar')
          OR public.can_access(auth.uid(), 'encarregados_solicitar_demissao', 'visualizar')
          OR public.can_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem permissão para o Catálogo de Materiais.';
  END IF;

  SELECT c.empresa_id, c.nome INTO v_empresa, v_contrato
    FROM public.contratos c WHERE c.id = p_contrato_id;
  IF v_empresa IS NULL THEN
    RETURN;
  END IF;

  -- Os postos que a planilha declara para este contrato.
  --
  -- O casamento aceita contrato_id OU nome porque planilha_custo.contrato_id
  -- foi preenchido por um UPDATE de uma vez (20260714000002) e não há
  -- trigger que o mantenha: linha importada depois disso pode ter o FK
  -- nulo e só o nome do contrato em texto.
  SELECT array_agg(p.nome), array_agg(public.sup_norm_nome(p.nome))
    INTO v_nomes, v_norm
    FROM (
      SELECT DISTINCT btrim(pc.posto) AS nome
        FROM public.planilha_custo pc
       WHERE btrim(coalesce(pc.posto, '')) <> ''
         AND (pc.contrato_id = p_contrato_id
              OR (pc.contrato_id IS NULL
                  AND pc.empresa_id = v_empresa
                  AND public.sup_norm_nome(pc.contrato) = public.sup_norm_nome(v_contrato)))
    ) p;

  v_nomes := coalesce(v_nomes, ARRAY[]::text[]);
  v_norm  := coalesce(v_norm,  ARRAY[]::text[]);

  -- (a) novos
  INSERT INTO public.sup_posto (empresa_id, contrato_id, nome, ativo, aprovado)
  SELECT v_empresa, p_contrato_id, n, true, true
    FROM unnest(v_nomes) AS n
   WHERE NOT EXISTS (
     SELECT 1 FROM public.sup_posto sp
      WHERE sp.contrato_id = p_contrato_id
        AND public.sup_norm_nome(sp.nome) = public.sup_norm_nome(n))
  ON CONFLICT (contrato_id, nome) DO NOTHING;

  -- (b) reativados
  UPDATE public.sup_posto sp
     SET ativo = true, aprovado = true, updated_at = now()
   WHERE sp.contrato_id = p_contrato_id
     AND (sp.ativo IS FALSE OR sp.aprovado IS FALSE)
     AND public.sup_norm_nome(sp.nome) = ANY (v_norm);

  -- (c) saiu da planilha e não tem função -- sai da lista
  IF array_length(v_norm, 1) > 0 THEN
    UPDATE public.sup_posto sp
       SET ativo = false, updated_at = now()
     WHERE sp.contrato_id = p_contrato_id
       AND sp.ativo
       AND NOT (public.sup_norm_nome(sp.nome) = ANY (v_norm))
       AND NOT EXISTS (
         SELECT 1 FROM public.sup_funcao f
          WHERE f.posto_id = sp.id AND f.ativo);
  END IF;

  RETURN QUERY
  SELECT sp.id, sp.contrato_id, sp.nome, sp.ativo, sp.aprovado,
         (public.sup_norm_nome(sp.nome) = ANY (v_norm)) AS na_planilha
    FROM public.sup_posto sp
   WHERE sp.contrato_id = p_contrato_id
     AND sp.ativo
   ORDER BY sp.nome;
END $fn$;

REVOKE ALL ON FUNCTION public.sup_cat_postos_do_contrato(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sup_cat_postos_do_contrato(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   Reaplicar o bloco CREATE OR REPLACE FUNCTION public.sup_cat_postos_do_contrato
--   da 20260930000081_supply_catalogo_posto_da_planilha.sql (gate só com
--   'sup_catalogo') e NOTIFY pgrst, 'reload schema';
