-- =========================================================================
-- Nova Vaga: o "Selecione o posto" lista só os postos da Planilha de Custo,
-- e o posto escolhido traz o endereço do local (13/11/2026)
--
-- RELATO (Pablo): no Solicitar Nova Vaga, contrato 1065 - DMAE - 895/0, o
-- posto oferecia GALERIA DE ARTES, PORTARIA DA CENTRAL DE VEICULOS,
-- PORTARIA DA GDCE... — locais antigos do catálogo de Suprimentos — em vez
-- dos quatro postos da planilha (PORTEIRO 9H P/DIA DIURNO, PORTEIRO 10H
-- P/DIA DIURNO, PORTEIRO 12X36 DIURNO, SUPERVISOR).
--
-- CAUSA: a lista vinha de sup_cat_postos_do_contrato, que devolve TODO
-- sup_posto ativo do contrato: os da planilha, os do quadro do contrato e
-- os antigos que ainda têm função pendurada (o passo (c) dela não desativa
-- posto com função, de propósito — ver mig 20260930000081). Para o
-- Catálogo isso está certo; para a vaga, não: V.A e V.T só saem de posto
-- que está na planilha (rec_custo_do_posto casa pelo nome).
--
-- O QUE ESTA FUNÇÃO FAZ: devolve os postos VIGENTES (não encerrados) da
-- Planilha de Custo do contrato, um por nome (a vigência mais nova), com:
--   • sup_posto_id — o espelho em sup_posto (é o id que a vaga grava em
--     posto_id; sup_cat_postos_do_contrato é chamada antes e cria o espelho);
--   • locais — os endereços cadastrados em planilha_posto_localizacao para
--     aquela linha da planilha (a Licitação ainda está preenchendo: vazio é
--     normal, e a tela deixa o endereço para quem pede digitar).
-- sup_cat_postos_do_contrato NÃO muda — o Catálogo segue como está.
--
-- Por que RPC e não SELECT direto: planilha_posto_localizacao tem RLS por
-- user_empresa (padrão antigo) e quem pede vaga — encarregado, Central —
-- não é da Licitação. A trava é a mesma lista de quem pede vaga de
-- sup_cat_postos_do_contrato (mig 282) + as de rec_custo_do_posto.
--
-- Idempotente.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rec_postos_planilha_do_contrato(p_contrato_id uuid)
 RETURNS TABLE(sup_posto_id uuid, posto text, planilha_custo_id uuid, vigencia date, locais jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_empresa  uuid;
  v_contrato text;
BEGIN
  IF NOT (public.can_access(auth.uid(), 'sup_catalogo', 'visualizar')
          OR public.can_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar')
          OR public.can_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar')
          OR public.can_access(auth.uid(), 'recrutamento_gestao', 'visualizar')
          OR public.can_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar')
          OR public.can_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'visualizar')
          OR public.can_access(auth.uid(), 'operacional_recrutamento', 'visualizar')
          OR public.can_access(auth.uid(), 'encarregados_solicitar_demissao', 'visualizar')
          OR public.can_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  SELECT c.empresa_id, c.nome INTO v_empresa, v_contrato
    FROM public.contratos c WHERE c.id = p_contrato_id;
  IF v_empresa IS NULL THEN
    RETURN;
  END IF;

  -- Mesmo casamento de contrato da sup_cat_postos_do_contrato: contrato_id
  -- OU nome (linha importada depois de 20260714000002 pode ter o FK nulo).
  RETURN QUERY
  WITH linhas AS (
    SELECT DISTINCT ON (public.sup_norm_nome(pc.posto))
           pc.id, btrim(pc.posto) AS nome, pc.data_vigencia
      FROM public.planilha_custo pc
     WHERE btrim(coalesce(pc.posto, '')) <> ''
       AND coalesce(pc.encerrado, false) = false
       AND (pc.contrato_id = p_contrato_id
            OR (pc.contrato_id IS NULL
                AND pc.empresa_id = v_empresa
                AND public.sup_norm_nome(pc.contrato) = public.sup_norm_nome(v_contrato)))
     ORDER BY public.sup_norm_nome(pc.posto), pc.data_vigencia DESC NULLS LAST, pc.created_at DESC NULLS LAST
  )
  SELECT (SELECT sp.id FROM public.sup_posto sp
           WHERE sp.contrato_id = p_contrato_id
             AND sp.ativo
             AND public.sup_norm_nome(sp.nome) = public.sup_norm_nome(l.nome)
           ORDER BY sp.created_at
           LIMIT 1),
         l.nome,
         l.id,
         l.data_vigencia,
         coalesce((
           SELECT jsonb_agg(jsonb_build_object(
                    'nome', loc.nome, 'cep', loc.cep, 'logradouro', loc.logradouro,
                    'numero', loc.numero, 'complemento', loc.complemento,
                    'bairro', loc.bairro, 'municipio', loc.municipio, 'uf', loc.uf)
                  ORDER BY loc.created_at)
             FROM public.planilha_posto_localizacao loc
            WHERE loc.planilha_custo_id = l.id), '[]'::jsonb)
    FROM linhas l
   ORDER BY l.nome;
END $function$;

REVOKE ALL ON FUNCTION public.rec_postos_planilha_do_contrato(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_postos_planilha_do_contrato(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.rec_postos_planilha_do_contrato(uuid);
-- NOTIFY pgrst, 'reload schema';
