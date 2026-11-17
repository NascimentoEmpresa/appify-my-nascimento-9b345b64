-- SIS-2026-0903 (Fase 2) — Conciliação Financeira do Relatório de Serviços: controle de tratativas das divergências
-- ============================================================================
-- Cada divergência encontrada pela Conciliação pode virar uma TRATATIVA: responsável pela análise, justificativa, situação, data de identificação,
-- prazo de resolução, data de regularização e HISTÓRICO de todas as alterações (a divergência não é "descartada" sem análise registrada).
--   conciliacao_servicos_tratativa            : uma por alvo (`alvo_chave`: "nota:<nf_id>" ou "indicador:<id>|contrato:<id>|mes:<AAAA-MM>").
--   conciliacao_servicos_tratativa_historico  : gravado por TRIGGER (criação e cada campo alterado), com quem e quando. Sem UPDATE/DELETE: o histórico não se apaga.
-- Acesso por pessoa (deny-by-default), no menu da aba que já existe ('relatorio-servicos-conciliacao'): visualizar = ver as tratativas;
-- alterar = registrar e atualizar. Nada de DELETE: encerrar uma tratativa é mudar a situação (regularizada / justificada).
-- (SELECT ...) em volta de auth.uid()/has_screen_access (guardião de desempenho). Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS conciliacao_servicos_tratativa_hist ON public.conciliacao_servicos_tratativa;
--   DROP FUNCTION IF EXISTS public.conciliacao_servicos_tratativa_historico();
--   DROP TABLE IF EXISTS public.conciliacao_servicos_tratativa_historico, public.conciliacao_servicos_tratativa;
--   NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.conciliacao_servicos_tratativa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alvo_chave text NOT NULL,
  alvo_tipo text NOT NULL CHECK (alvo_tipo IN ('nota', 'indicador')),
  nf_emissao_id uuid,
  contrato_id uuid,
  empresa_id uuid,
  competencia date CHECK (competencia IS NULL OR extract(day FROM competencia) = 1),
  indicador text,
  titulo text NOT NULL,
  tipo_divergencia text CHECK (tipo_divergencia IS NULL OR tipo_divergencia IN ('registro_ausente', 'criterio_diferente', 'erro_lancamento', 'divergencia_calculo')),
  valor_diferenca numeric(16,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'em_analise', 'justificada', 'regularizada')),
  responsavel_id uuid,
  responsavel_nome text,
  justificativa text,
  identificada_em date NOT NULL DEFAULT current_date,
  prazo_resolucao date,
  regularizada_em date,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS conciliacao_servicos_tratativa_alvo_uk ON public.conciliacao_servicos_tratativa (alvo_chave);
CREATE INDEX IF NOT EXISTS conciliacao_servicos_tratativa_status_idx ON public.conciliacao_servicos_tratativa (status, prazo_resolucao);
CREATE INDEX IF NOT EXISTS conciliacao_servicos_tratativa_nf_idx ON public.conciliacao_servicos_tratativa (nf_emissao_id) WHERE nf_emissao_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conciliacao_servicos_tratativa_contrato_idx ON public.conciliacao_servicos_tratativa (contrato_id) WHERE contrato_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.conciliacao_servicos_tratativa_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tratativa_id uuid NOT NULL REFERENCES public.conciliacao_servicos_tratativa (id) ON DELETE CASCADE,
  campo text NOT NULL,
  valor_anterior text,
  valor_novo text,
  autor_id uuid,
  autor_nome text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conciliacao_servicos_tratativa_historico_tratativa_idx ON public.conciliacao_servicos_tratativa_historico (tratativa_id, created_at DESC);

ALTER TABLE public.conciliacao_servicos_tratativa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conciliacao_servicos_tratativa_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conciliacao_servicos_tratativa_select ON public.conciliacao_servicos_tratativa;
CREATE POLICY conciliacao_servicos_tratativa_select ON public.conciliacao_servicos_tratativa FOR SELECT TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'relatorio-servicos-conciliacao', 'visualizar'::public.app_acao)));
DROP POLICY IF EXISTS conciliacao_servicos_tratativa_insert ON public.conciliacao_servicos_tratativa;
CREATE POLICY conciliacao_servicos_tratativa_insert ON public.conciliacao_servicos_tratativa FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_screen_access((SELECT auth.uid()), 'relatorio-servicos-conciliacao', 'alterar'::public.app_acao)));
DROP POLICY IF EXISTS conciliacao_servicos_tratativa_update ON public.conciliacao_servicos_tratativa;
CREATE POLICY conciliacao_servicos_tratativa_update ON public.conciliacao_servicos_tratativa FOR UPDATE TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'relatorio-servicos-conciliacao', 'alterar'::public.app_acao)))
  WITH CHECK ((SELECT public.has_screen_access((SELECT auth.uid()), 'relatorio-servicos-conciliacao', 'alterar'::public.app_acao)));
DROP POLICY IF EXISTS conciliacao_servicos_tratativa_historico_select ON public.conciliacao_servicos_tratativa_historico;
CREATE POLICY conciliacao_servicos_tratativa_historico_select ON public.conciliacao_servicos_tratativa_historico FOR SELECT TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'relatorio-servicos-conciliacao', 'visualizar'::public.app_acao)));

GRANT SELECT, INSERT, UPDATE ON public.conciliacao_servicos_tratativa TO authenticated;
GRANT SELECT ON public.conciliacao_servicos_tratativa_historico TO authenticated;

-- Histórico: o trigger grava (a tela não escreve no histórico, então ele não depende de ninguém lembrar de registrar)
CREATE OR REPLACE FUNCTION public.conciliacao_servicos_tratativa_historico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_nome text;
  c record;
BEGIN
  SELECT display_name INTO v_nome FROM public.profiles WHERE id = v_uid;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.conciliacao_servicos_tratativa_historico (tratativa_id, campo, valor_anterior, valor_novo, autor_id, autor_nome)
    VALUES (NEW.id, 'criacao', NULL, NEW.titulo, v_uid, v_nome);
    RETURN NEW;
  END IF;
  -- ao regularizar sem informar a data, vale hoje
  IF NEW.status = 'regularizada' AND NEW.regularizada_em IS NULL THEN NEW.regularizada_em := current_date; END IF;
  FOR c IN
    SELECT * FROM (VALUES
      ('situação', OLD.status, NEW.status),
      ('responsável', OLD.responsavel_nome, NEW.responsavel_nome),
      ('justificativa', OLD.justificativa, NEW.justificativa),
      ('prazo de resolução', OLD.prazo_resolucao::text, NEW.prazo_resolucao::text),
      ('data de regularização', OLD.regularizada_em::text, NEW.regularizada_em::text),
      ('valor da diferença', OLD.valor_diferenca::text, NEW.valor_diferenca::text)
    ) AS t(campo, antes, depois)
     WHERE t.antes IS DISTINCT FROM t.depois
  LOOP
    INSERT INTO public.conciliacao_servicos_tratativa_historico (tratativa_id, campo, valor_anterior, valor_novo, autor_id, autor_nome)
    VALUES (NEW.id, c.campo, c.antes, c.depois, v_uid, v_nome);
  END LOOP;
  NEW.updated_at := now();
  NEW.updated_by := v_uid;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conciliacao_servicos_tratativa_hist ON public.conciliacao_servicos_tratativa;
CREATE TRIGGER conciliacao_servicos_tratativa_hist
  AFTER INSERT ON public.conciliacao_servicos_tratativa
  FOR EACH ROW EXECUTE FUNCTION public.conciliacao_servicos_tratativa_historico();
DROP TRIGGER IF EXISTS conciliacao_servicos_tratativa_hist_upd ON public.conciliacao_servicos_tratativa;
CREATE TRIGGER conciliacao_servicos_tratativa_hist_upd
  BEFORE UPDATE ON public.conciliacao_servicos_tratativa
  FOR EACH ROW EXECUTE FUNCTION public.conciliacao_servicos_tratativa_historico();

NOTIFY pgrst, 'reload schema';
