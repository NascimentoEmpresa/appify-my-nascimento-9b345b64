-- =========================================================================
-- Postos do contrato: volta a liberar para quem pede vaga (01/10/2026)
--
-- RELATO (Pablo): encarregado abrindo vaga no módulo Encarregados via
-- "Contrato sem posto no catálogo" para a POLÍCIA CIVIL RS LIMPEZA -
-- 066/2026, que tem 151 postos no Catálogo de Suprimentos. "Tem que
-- aparecer todos os postos desse contrato pra ele selecionar qual quiser, e
-- isso pra todos os contratos."
--
-- CAUSA — regressão: a mig 111 tinha aberto sup_cat_postos_do_contrato para
-- quem pede vaga (Central, Recrutamento, encarregados). A 238 (quadro de
-- postos) e a 241 (correção dela) recriaram a função a partir do corpo
-- antigo (081/096) e a trava voltou a ser só 'sup_catalogo'. Quem não tem o
-- Catálogo recebe a exceção, o VinculoCatalogoVaga engole o erro e mostra a
-- lista vazia. Provado em 01/10: a mesma chamada devolve 151 postos para o
-- Pablo e "Sem permissão para o Catálogo de Materiais." para um encarregado.
--
-- O QUE MUDA: só a trava do início (lista da 111 + a vaga administrativa do
-- Recrutamento). O corpo é o que está no ar (o da 241, com o quadro).
-- A leitura direta de sup_posto/sup_funcao já foi aberta na mig 116.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.sup_cat_postos_do_contrato(p_contrato_id uuid)
 RETURNS TABLE(id uuid, contrato_id uuid, nome text, ativo boolean, aprovado boolean, na_planilha boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_empresa   uuid;
  v_contrato  text;
  v_nomes     text[];   -- nomes de posto como a planilha escreveu
  v_norm      text[];   -- os mesmos, normalizados, para casar sem acento/caixa
  v_quadro    text[];   -- nomes normalizados que o QUADRO do contrato declara
  v_vivos     text[];   -- planilha + quadro: o que não pode ser desativado
BEGIN
  -- Quem pede vaga também escolhe o posto (mig 111). A 238/241 recriaram esta
  -- função a partir do corpo antigo e a trava voltou a ser só sup_catalogo.
  IF NOT (public.can_access(auth.uid(), 'sup_catalogo', 'visualizar')
          OR public.can_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar')
          OR public.can_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar')
          OR public.can_access(auth.uid(), 'recrutamento_gestao', 'visualizar')
          OR public.can_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar')
          OR public.can_access(auth.uid(), 'encarregados_solicitar_demissao', 'visualizar')
          OR public.can_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem permissão para o Catálogo de Materiais.';
  END IF;

  SELECT c.empresa_id, c.nome INTO v_empresa, v_contrato
    FROM public.contratos c WHERE c.id = p_contrato_id;
  IF v_empresa IS NULL THEN
    RETURN;
  END IF;

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

  SELECT coalesce(array_agg(public.sup_norm_nome(q.posto_nome)), ARRAY[]::text[])
    INTO v_quadro
    FROM public."CONTRATO_QUADRO_POSTO" q
   WHERE q.contrato_id = p_contrato_id AND q.ativo;

  v_vivos := v_norm || v_quadro;

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
     AND public.sup_norm_nome(sp.nome) = ANY (v_vivos);

  -- (c) saiu da planilha E não está no quadro E não tem função -- sai da lista
  IF array_length(v_vivos, 1) > 0 THEN
    UPDATE public.sup_posto sp
       SET ativo = false, updated_at = now()
     WHERE sp.contrato_id = p_contrato_id
       AND sp.ativo
       AND NOT (public.sup_norm_nome(sp.nome) = ANY (v_vivos))
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
END $function$;

REVOKE ALL ON FUNCTION public.sup_cat_postos_do_contrato(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_cat_postos_do_contrato(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reexecutar o CREATE OR REPLACE de sup_cat_postos_do_contrato da
-- 20260930000241_contrato_quadro_postos_corrige_cast.sql (trava só sup_catalogo)
-- e NOTIFY pgrst, 'reload schema';
