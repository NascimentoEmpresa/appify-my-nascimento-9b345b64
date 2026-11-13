-- ============================================================================
-- SIS-2026-0818 — separa a previsão da compra do valor efetivamente cotado
--
-- `malote_despesa.valor_total` tinha dois significados incompatíveis. Na
-- solicitação ele era a previsão informada pelo solicitante; na conversão em
-- despesa passava a ser o valor real aprovado, que precisa bater com pedido e
-- nota fiscal. O dashboard calculava saving sobre esse mesmo campo e, depois
-- da conversão, perdia a referência original.
--
-- A previsão passa a ter coluna própria. O comprador pode ajustá-la enquanto
-- cota, com rastro no evento, e o dashboard usa somente essa referência para
-- o saving. `valor_total` e `valor_aprovado_cotacao` continuam sendo os valores
-- operacionais que chegam ao pedido, à despesa e à nota.
--
-- ROLLBACK:
--   restaurar a definição anterior de sup_dashboard_compras_estoque;
--   DROP FUNCTION IF EXISTS public.sup_malote_enviar_cotacao_previsto(uuid,jsonb,numeric);
--   DROP FUNCTION IF EXISTS public.sup_malote_salvar_rascunho_previsto(uuid,jsonb,numeric);
--   DROP FUNCTION IF EXISTS public.sup_malote_atualizar_valor_previsto(uuid,numeric);
--   DROP TRIGGER IF EXISTS malote_despesa_inicializar_valor_previsto_trg ON public.malote_despesa;
--   DROP FUNCTION IF EXISTS public.malote_despesa_inicializar_valor_previsto();
--   ALTER TABLE public.malote_despesa DROP COLUMN IF EXISTS valor_previsto_editado_por_nome;
--   ALTER TABLE public.malote_despesa DROP COLUMN IF EXISTS valor_previsto_editado_por;
--   ALTER TABLE public.malote_despesa DROP COLUMN IF EXISTS valor_previsto_editado_em;
--   ALTER TABLE public.malote_despesa DROP COLUMN IF EXISTS valor_previsto_compra;
-- ============================================================================

ALTER TABLE public.malote_despesa
  ADD COLUMN IF NOT EXISTS valor_previsto_compra numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_previsto_editado_em timestamptz,
  ADD COLUMN IF NOT EXISTS valor_previsto_editado_por uuid,
  ADD COLUMN IF NOT EXISTS valor_previsto_editado_por_nome text;

COMMENT ON COLUMN public.malote_despesa.valor_previsto_compra IS
  'SIS-2026-0818: referência prevista da compra, preservada exclusivamente para cálculo de saving.';

-- Preserva o melhor valor disponível no histórico. Para solicitações que já
-- viraram despesa, a previsão antiga foi sobrescrita antes desta coluna
-- existir e não pode ser reconstruída com segurança.
UPDATE public.malote_despesa
   SET valor_previsto_compra = valor_total
 WHERE origem = 'solicitacao'
   AND valor_previsto_compra IS NULL;

CREATE OR REPLACE FUNCTION public.malote_despesa_inicializar_valor_previsto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.origem = 'solicitacao' THEN
    IF TG_OP = 'INSERT' AND NEW.valor_previsto_compra IS NULL THEN
      NEW.valor_previsto_compra := NEW.valor_total;
    ELSIF TG_OP = 'UPDATE'
      AND OLD.valor_previsto_compra IS NOT NULL
      AND NEW.valor_previsto_compra IS NULL THEN
      -- A conversão e as edições da despesa não podem apagar a referência.
      NEW.valor_previsto_compra := OLD.valor_previsto_compra;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS malote_despesa_inicializar_valor_previsto_trg
  ON public.malote_despesa;
CREATE TRIGGER malote_despesa_inicializar_valor_previsto_trg
  BEFORE INSERT OR UPDATE OF valor_previsto_compra
  ON public.malote_despesa
  FOR EACH ROW
  EXECUTE FUNCTION public.malote_despesa_inicializar_valor_previsto();

CREATE OR REPLACE FUNCTION public.sup_malote_atualizar_valor_previsto(
  p_id uuid,
  p_valor numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v public.malote_despesa;
  v_nome text := public.sup_malote_nome_ator();
BEGIN
  v := public.sup_malote_carregar(p_id, 'alterar');

  IF v.status <> 'aguardando_cotacao' THEN
    RAISE EXCEPTION 'O valor previsto só pode ser ajustado enquanto a cotação está pendente (status atual: %)', v.status
      USING ERRCODE = '22023';
  END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Informe um valor previsto maior que zero'
      USING ERRCODE = '22023';
  END IF;

  IF p_valor IS DISTINCT FROM COALESCE(v.valor_previsto_compra, v.valor_total) THEN
    UPDATE public.malote_despesa
       SET valor_previsto_compra = p_valor,
           valor_previsto_editado_em = now(),
           valor_previsto_editado_por = auth.uid(),
           valor_previsto_editado_por_nome = v_nome,
           updated_at = now(),
           updated_by = auth.uid()
     WHERE id = p_id;

    INSERT INTO public.malote_despesa_evento
      (despesa_id, tipo_evento, ator_user_id, descricao)
    VALUES
      (p_id, 'edicao', auth.uid(),
       format('Valor previsto da compra ajustado por %s: de R$ %s para R$ %s. Referência exclusiva para saving.',
              v_nome,
              public.sup_malote_brl(COALESCE(v.valor_previsto_compra, v.valor_total)),
              public.sup_malote_brl(p_valor)));
  END IF;
END;
$function$;

-- Wrappers mantêm previsão e cotações na mesma transação. Os nomes novos
-- evitam overload ambíguo no PostgREST e preservam consumidores antigos.
CREATE OR REPLACE FUNCTION public.sup_malote_salvar_rascunho_previsto(
  p_id uuid,
  p_cotacoes jsonb,
  p_valor_previsto numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public.sup_malote_atualizar_valor_previsto(p_id, p_valor_previsto);
  PERFORM public.sup_malote_salvar_rascunho(p_id, p_cotacoes);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sup_malote_enviar_cotacao_previsto(
  p_id uuid,
  p_cotacoes jsonb,
  p_valor_previsto numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public.sup_malote_atualizar_valor_previsto(p_id, p_valor_previsto);
  PERFORM public.sup_malote_enviar_cotacao(p_id, p_cotacoes);
END;
$function$;

REVOKE ALL ON FUNCTION public.sup_malote_atualizar_valor_previsto(uuid,numeric)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_malote_salvar_rascunho_previsto(uuid,jsonb,numeric)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_malote_enviar_cotacao_previsto(uuid,jsonb,numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_malote_atualizar_valor_previsto(uuid,numeric)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_malote_salvar_rascunho_previsto(uuid,jsonb,numeric)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_malote_enviar_cotacao_previsto(uuid,jsonb,numeric)
  TO authenticated;

-- Esta RPC acumula patches por pg_get_functiondef. Alterar só as duas
-- expressões de saving preserva os hotfixes já aplicados sobre a definição.
-- guardiao-ok: inspeciona apenas a definição da função, sem consultar dados de negócio; âncora ausente impede alteração parcial da RPC.
DO $migration$
DECLARE
  v_def text;
  v_origem_saving text := 'GREATEST(COALESCE(d.valor_total, 0) - COALESCE(d.valor_aprovado_cotacao, 0), 0) AS saving';
  v_destino_saving text := 'GREATEST(COALESCE(d.valor_previsto_compra, d.valor_total, 0) - COALESCE(d.valor_aprovado_cotacao, 0), 0) AS saving';
  v_origem_inicial text := 'sum(COALESCE(cm.valor_total, 0))::numeric AS valor_inicial';
  v_destino_inicial text := 'sum(COALESCE(cm.valor_previsto_compra, cm.valor_total, 0))::numeric AS valor_inicial';
BEGIN
  SELECT pg_get_functiondef(
    'public.sup_dashboard_compras_estoque(uuid,date,date,uuid,text,text)'::regprocedure
  ) INTO v_def;

  IF v_def IS NULL
    OR position(v_origem_saving IN v_def) = 0
    OR position(v_origem_inicial IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncoras do saving não encontradas em sup_dashboard_compras_estoque; patch não aplicado.';
  END IF;

  v_def := replace(v_def, v_origem_saving, v_destino_saving);
  v_def := replace(v_def, v_origem_inicial, v_destino_inicial);
  EXECUTE v_def;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
