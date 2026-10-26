-- SIS-2026-0653: edição dos modelos de e-mail da cobrança automática pela tela (Cobranças > Modelos de e-mail).
--
-- Os textos (cobranca_auto_*) ficam em template_mensagem e a rotina lê o modelo ativo a cada envio, então uma edição vale no
-- próximo tick. Como esse texto vai para o cliente, toda alteração de assunto/corpo guarda a versão ANTERIOR aqui (quem
-- substituiu e quando): dá para ver o que mudou e voltar a uma versão, inclusive o texto original portado do sistema antigo
-- (é a versão mais antiga do código, criada na primeira edição).
--
-- Só o trigger escreve nesta tabela; a tela apenas lê.
-- Idempotente. ROLLBACK no fim.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.cobranca_auto_modelo_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  assunto text,
  corpo text NOT NULL,
  substituida_por uuid,
  substituida_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cobranca_auto_modelo_hist ON public.cobranca_auto_modelo_historico (codigo, substituida_em DESC);

ALTER TABLE public.cobranca_auto_modelo_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS camh_select ON public.cobranca_auto_modelo_historico;
CREATE POLICY camh_select ON public.cobranca_auto_modelo_historico FOR SELECT TO authenticated USING (
  public.can_access(auth.uid(), 'cobrancas', 'alterar'::public.app_acao)
  OR public.can_access(auth.uid(), 'cobrancas', 'aprovar'::public.app_acao)
  OR public.can_access(auth.uid(), 'cobrancas', 'visualizar'::public.app_acao)
);

-- Cluster pós-virada: tabela nova não ganha GRANT sozinha. template_mensagem já tinha RLS por 'cobrancas'; o GRANT só garante o privilégio de tabela.
GRANT SELECT ON TABLE public.cobranca_auto_modelo_historico TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.template_mensagem TO authenticated;
GRANT ALL ON TABLE public.cobranca_auto_modelo_historico TO service_role;

CREATE OR REPLACE FUNCTION public.cobranca_auto_modelo_guarda_versao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.codigo LIKE 'cobranca\_auto\_%' AND (OLD.assunto IS DISTINCT FROM NEW.assunto OR OLD.corpo IS DISTINCT FROM NEW.corpo) THEN
    INSERT INTO public.cobranca_auto_modelo_historico (codigo, assunto, corpo, substituida_por)
    VALUES (OLD.codigo, OLD.assunto, OLD.corpo, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS template_mensagem_guarda_versao_cobranca ON public.template_mensagem;
CREATE TRIGGER template_mensagem_guarda_versao_cobranca
  BEFORE UPDATE ON public.template_mensagem
  FOR EACH ROW EXECUTE FUNCTION public.cobranca_auto_modelo_guarda_versao();

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP TRIGGER IF EXISTS template_mensagem_guarda_versao_cobranca ON public.template_mensagem;
--   DROP FUNCTION IF EXISTS public.cobranca_auto_modelo_guarda_versao();
--   DROP TABLE IF EXISTS public.cobranca_auto_modelo_historico;
--   NOTIFY pgrst, 'reload schema';
