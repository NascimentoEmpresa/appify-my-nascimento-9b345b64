-- ============================================================================
-- [SEM-CHAMADO] Excluir uma conciliação bancária (competência) para refazê-la
-- ============================================================================
-- Pedido da equipe: no Dashboard de Conciliações › Saldos, poder excluir a conciliação de uma competência para
-- realizar de novo. Hoje a conciliação salva é um snapshot sem como apagar (a tabela só tem policy de DELETE para
-- 'excluir', que ninguém tem, e a tela não oferece o botão).
--
--   1. financeiro_conciliacao_fluxo_caixa_exclusao : registro de cada exclusão (quem, quando, motivo, foto do cabeçalho)
--   2. conciliacao_fluxo_excluir(_id, _motivo)      : RPC que apaga a conciliação E as repetições do mesmo registro
--      (mesmo banco, empresas, conta e período: salvar duas vezes não duplica o indicador, vale a mais recente, então
--      apagar só a última faria a anterior voltar a valer). Linhas e arquivos dependem em cascata.
--
-- Exige 'conciliacao-fluxo-caixa' › 'excluir' (hoje ninguém tem: liberar por usuário em Administração).
-- NÃO desfaz o que a conciliação alterou no Fluxo de Caixa (ajustes e lançamentos criados continuam valendo) e NÃO apaga os
-- arquivos .OFX do storage (ficam como evidência). A exclusão fica registrada com o texto do motivo.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.conciliacao_fluxo_excluir(uuid, text);
--   DROP TABLE IF EXISTS public.financeiro_conciliacao_fluxo_caixa_exclusao;
--   NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.financeiro_conciliacao_fluxo_caixa_exclusao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banco_id uuid,
  data_inicio date NOT NULL,
  data_fim date NOT NULL,
  registros_apagados int NOT NULL,
  motivo text NOT NULL CHECK (length(btrim(motivo)) >= 5),
  cabecalho jsonb NOT NULL,                 -- foto do registro apagado (a versão mais recente)
  excluido_por uuid NOT NULL,
  excluido_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS financeiro_conciliacao_fluxo_caixa_exclusao_data ON public.financeiro_conciliacao_fluxo_caixa_exclusao (data_fim, excluido_em DESC);

ALTER TABLE public.financeiro_conciliacao_fluxo_caixa_exclusao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financeiro_conciliacao_fluxo_caixa_exclusao_select ON public.financeiro_conciliacao_fluxo_caixa_exclusao;
CREATE POLICY financeiro_conciliacao_fluxo_caixa_exclusao_select ON public.financeiro_conciliacao_fluxo_caixa_exclusao
  FOR SELECT TO authenticated
  USING ((SELECT public.can_access((SELECT auth.uid()), 'conciliacao-fluxo-caixa', 'visualizar')));
GRANT SELECT ON public.financeiro_conciliacao_fluxo_caixa_exclusao TO authenticated;

CREATE OR REPLACE FUNCTION public.conciliacao_fluxo_excluir(_id uuid, _motivo text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_motivo text := btrim(coalesce(_motivo, ''));
  c public.financeiro_conciliacao_fluxo_caixa%ROWTYPE;
  v_ids uuid[];
BEGIN
  IF v_uid IS NULL OR NOT public.can_access(v_uid, 'conciliacao-fluxo-caixa', 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir conciliações.';
  END IF;
  IF length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão (pelo menos 5 caracteres).';
  END IF;

  SELECT * INTO c FROM public.financeiro_conciliacao_fluxo_caixa WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conciliação não encontrada (talvez já tenha sido excluída).'; END IF;

  -- O mesmo registro salvo mais de uma vez: apaga todas as versões.
  SELECT array_agg(x.id) INTO v_ids
    FROM public.financeiro_conciliacao_fluxo_caixa x
   WHERE x.banco_id IS NOT DISTINCT FROM c.banco_id
     AND x.todas_empresas IS NOT DISTINCT FROM c.todas_empresas
     AND ARRAY(SELECT unnest(x.empresa_ids) ORDER BY 1) IS NOT DISTINCT FROM ARRAY(SELECT unnest(c.empresa_ids) ORDER BY 1)
     AND x.conta_extrato IS NOT DISTINCT FROM c.conta_extrato
     AND x.conta_banco_id IS NOT DISTINCT FROM c.conta_banco_id
     AND x.data_inicio = c.data_inicio
     AND x.data_fim = c.data_fim;

  INSERT INTO public.financeiro_conciliacao_fluxo_caixa_exclusao (banco_id, data_inicio, data_fim, registros_apagados, motivo, cabecalho, excluido_por)
  VALUES (c.banco_id, c.data_inicio, c.data_fim, coalesce(array_length(v_ids, 1), 1), v_motivo, to_jsonb(c), v_uid);

  DELETE FROM public.financeiro_conciliacao_fluxo_caixa WHERE id = ANY (v_ids);
  RETURN coalesce(array_length(v_ids, 1), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.conciliacao_fluxo_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conciliacao_fluxo_excluir(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
