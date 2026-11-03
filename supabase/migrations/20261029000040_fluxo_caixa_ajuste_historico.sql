-- SIS-2026-0733: rastreabilidade das edições feitas no Fluxo de Caixa. O ajuste (financeiro_fluxo_caixa_ajuste) não guardava
-- histórico e "Reverter ajuste" apaga a linha de vez — na DM-2026-1126 uma edição de valor foi feita e desfeita sem deixar rastro
-- de quem, quando e o quê. Agora todo INSERT/UPDATE/DELETE do ajuste grava uma linha aqui, por gatilho (não depende da tela),
-- com o usuário, o antes e o depois. A tabela é só leitura para a aplicação: ninguém edita nem apaga o histórico.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.financeiro_fluxo_caixa_ajuste_historico (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ajuste_id       uuid NOT NULL,
  origem          text NOT NULL,
  despesa_id      uuid NOT NULL,
  numero_parcela  int,
  operacao        text NOT NULL CHECK (operacao IN ('criado', 'alterado', 'desfeito')),
  campos          text[] NOT NULL DEFAULT '{}',
  antes           jsonb,
  depois          jsonb,
  usuario_id      uuid,
  usuario_nome    text,
  -- Quem executou no banco quando não há usuário da aplicação (pgAdmin, script, service role).
  usuario_banco   text NOT NULL DEFAULT current_user,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ffc_ajuste_hist_linha
  ON public.financeiro_fluxo_caixa_ajuste_historico (origem, despesa_id, numero_parcela, created_at DESC);

CREATE OR REPLACE FUNCTION public.financeiro_fluxo_caixa_ajuste_registrar_historico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_antes  jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) - 'updated_at' - 'updated_by' END;
  v_depois jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) - 'updated_at' - 'updated_by' END;
  v_linha  public.financeiro_fluxo_caixa_ajuste := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_campos text[];
  v_uid    uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' AND v_antes IS NOT DISTINCT FROM v_depois THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(array_agg(k ORDER BY k), '{}')
    INTO v_campos
    FROM (
      SELECT k FROM jsonb_object_keys(COALESCE(v_depois, v_antes)) AS k
       WHERE k NOT IN ('id', 'origem', 'despesa_id', 'numero_parcela', 'created_at')
         AND (v_antes ->> k) IS DISTINCT FROM (v_depois ->> k)
    ) x;

  INSERT INTO public.financeiro_fluxo_caixa_ajuste_historico
    (ajuste_id, origem, despesa_id, numero_parcela, operacao, campos, antes, depois, usuario_id, usuario_nome)
  VALUES (
    v_linha.id, v_linha.origem, v_linha.despesa_id, v_linha.numero_parcela,
    CASE TG_OP WHEN 'INSERT' THEN 'criado' WHEN 'UPDATE' THEN 'alterado' ELSE 'desfeito' END,
    v_campos, v_antes, v_depois, v_uid,
    (SELECT p.display_name FROM public.profiles p WHERE p.id = v_uid)
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_financeiro_fluxo_caixa_ajuste_historico ON public.financeiro_fluxo_caixa_ajuste;
CREATE TRIGGER trg_financeiro_fluxo_caixa_ajuste_historico
  AFTER INSERT OR UPDATE OR DELETE ON public.financeiro_fluxo_caixa_ajuste
  FOR EACH ROW EXECUTE FUNCTION public.financeiro_fluxo_caixa_ajuste_registrar_historico();

ALTER TABLE public.financeiro_fluxo_caixa_ajuste_historico ENABLE ROW LEVEL SECURITY;

-- Só leitura, no mesmo menu do Fluxo. Sem política de escrita: o gatilho (SECURITY DEFINER) é o único que grava.
DROP POLICY IF EXISTS ffc_ajuste_hist_select ON public.financeiro_fluxo_caixa_ajuste_historico;
CREATE POLICY ffc_ajuste_hist_select ON public.financeiro_fluxo_caixa_ajuste_historico
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'visualizar'::public.app_acao));

REVOKE ALL ON public.financeiro_fluxo_caixa_ajuste_historico FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.financeiro_fluxo_caixa_ajuste_historico TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_financeiro_fluxo_caixa_ajuste_historico ON public.financeiro_fluxo_caixa_ajuste;
--   DROP FUNCTION IF EXISTS public.financeiro_fluxo_caixa_ajuste_registrar_historico();
--   DROP TABLE IF EXISTS public.financeiro_fluxo_caixa_ajuste_historico;
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
