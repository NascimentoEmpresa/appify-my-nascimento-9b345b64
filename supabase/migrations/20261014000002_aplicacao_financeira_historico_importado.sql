-- SIS-2026-0651: a tela Aplicações Financeiras passa a mostrar também o histórico da planilha de
-- Fluxo de Caixa 2026 (SIS-2026-0569) — tudo que foi importado nas classificações "Aplicação
-- Financeira" (saídas = aplicação, entradas = resgate) e "RENDIMENTO APLICAÇÃO" (entradas).
--
-- O módulo começou em 09/09/2026 e a importação termina em 08/09/2026: não há sobreposição.
-- Nada é copiado para APLICACAO_FINANCEIRA (isso duplicaria no Fluxo pelas views do módulo): a
-- fonte continua sendo fluxo_caixa_importado, lida pela view do Fluxo — que já aplica os ajustes
-- feitos na Gestão do Fluxo de Caixa (valor, data, classificação, banco). Corrigiu no Fluxo,
-- reflete aqui.
--
-- fluxo_caixa_importado só é legível por quem tem o menu do Fluxo; por isso a leitura passa por
-- esta função SECURITY DEFINER, liberada pelo menu das Aplicações (visualizar). Sem permissão,
-- devolve vazio.
--
-- Migration leve (só cria função): pode rodar inteira no SQL Editor.

CREATE OR REPLACE FUNCTION public.aplicacao_financeira_historico_importado()
RETURNS TABLE (
  linha_id uuid,
  id_malote text,
  data_pagamento date,
  empresa_id uuid,
  empresa_nome text,
  banco_nome text,
  banco_logo_path text,
  descricao text,
  valor numeric,
  movimento text,
  ajustado boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    v.linha_id,
    v.id_malote,
    v.data_pagamento,
    v.empresa_id,
    v.empresa_nome,
    v.banco_nome,
    v.banco_logo_path,
    v.descricao,
    v.valor,
    CASE
      WHEN cl.nome_key = 'rendimento aplicação' THEN 'rendimento'
      WHEN v.tipo = 'saida' THEN 'aplicacao'
      ELSE 'resgate'
    END AS movimento,
    v.ajustado
  FROM public.v_fluxo_caixa_importado_fluxo_caixa v
  JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = v.classificacao_id
  WHERE cl.nome_key IN ('aplicação financeira', 'rendimento aplicação')
    AND (SELECT public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'visualizar'))
  ORDER BY v.data_pagamento DESC, v.linha_id;
$$;

REVOKE ALL ON FUNCTION public.aplicacao_financeira_historico_importado() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.aplicacao_financeira_historico_importado() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.aplicacao_financeira_historico_importado();
--   NOTIFY pgrst, 'reload schema';
