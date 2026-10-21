-- =========================================================================
-- RESCISÕES — submódulo próprio, com kanban (21/10/2026)
--
-- PEDIDO (Pablo): "Submódulo novo > Rescisões. Praticamente igual o do
-- recrutamento, mas pra rescisões, tendo os kanbans também pra mudar os
-- status — mais simples e ágil. Importa todas as informações da planilha
-- como estão e todas as funcionalidades dela também." E a tela de
-- Solicitações de Demissão do RH fica só com o fluxo, numa tela só.
--
-- O QUE ENTRA
--   1. RH_RESCISAO (mig 20261019000030) continua sendo a tabela — o
--      controle da rescisão não muda de casa, ganha:
--        · planilha_original (jsonb): a linha da planilha EXATAMENTE como
--          estava no Excel (cabeçalho → texto/data), para o "como estão" —
--          as colunas normalizadas (tipo, homologação, meios) seguem para
--          filtro e kanban, e a ficha mostra o original ao lado;
--        · planilha_aba: de qual aba veio (RESCISÕES ou HOMOLOGAÇÃO — a aba
--          das homologações antigas, 2024/2025, também é importada);
--        · pontos_ajustados e data_admissao: as duas colunas da planilha que
--          a tabela não tinha (PONTOS AJUSTADOS? e ADMISSÃO);
--        · status_desde: desde quando o card está na coluna do kanban
--          (a planilha não sabia dizer "parado há quantos dias");
--        · origem 'manual': rescisão lançada direto no sistema (a linha que
--          o RH digitava à mão na planilha, sem solicitação do ERP).
--   2. RH_RESCISAO_HISTORICO: cada troca de status (arrastar no kanban ou
--      salvar a ficha) — quem, quando, de onde para onde. Gravado por
--      gatilho, não pela tela: não há como mover sem deixar rastro.
--   3. app_modulo 'rescisoes' + menu rescisoes_gestao (/app/rh/rescisoes).
--
-- IMPORTAÇÃO — continua pela tela (botão "Importar planilha" do módulo),
-- nunca por migration: são nomes e matrículas de gente desligada, e dado
-- pessoal não vai pro git.
--
-- ACESSO (J1/J2)
--   · Menu novo rescisoes_gestao. Quem já tem rh_demissoes ganha as MESMAS
--     ações no menu novo (perfis e exceções por usuário, só allow = true) —
--     ninguém que já controlava a rescisão perde a planilha no dia da troca.
--   · RLS da RH_RESCISAO aceita as duas telas (rh_demissoes OU
--     rescisoes_gestao): a tela de Solicitações de Demissão ainda mostra o
--     status da rescisão na lista. Lançar/mover = alterar OU aprovar (a
--     régua da mig 030); apagar = excluir. `excluir` fica fora do toggle de
--     propósito — vem pelos perfis/usuários que já o tinham em rh_demissoes
--     (copiados abaixo) ou por perfil de acesso.
--   · Módulo novo: o trigger de app_modulo cria o perfil espelho.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Colunas novas ─────────────────────────────────────────────────
ALTER TABLE public."RH_RESCISAO"
  ADD COLUMN IF NOT EXISTS planilha_original jsonb,
  ADD COLUMN IF NOT EXISTS planilha_aba      text,
  ADD COLUMN IF NOT EXISTS pontos_ajustados  text,
  ADD COLUMN IF NOT EXISTS data_admissao     date,
  ADD COLUMN IF NOT EXISTS status_desde      timestamptz;

UPDATE public."RH_RESCISAO" SET status_desde = COALESCE(atualizado_em, criado_em) WHERE status_desde IS NULL;
ALTER TABLE public."RH_RESCISAO" ALTER COLUMN status_desde SET DEFAULT now();

ALTER TABLE public."RH_RESCISAO" DROP CONSTRAINT IF EXISTS rh_rescisao_origem_chk;
ALTER TABLE public."RH_RESCISAO" ADD CONSTRAINT rh_rescisao_origem_chk CHECK (origem IN ('erp', 'planilha', 'manual'));

COMMENT ON COLUMN public."RH_RESCISAO".planilha_original IS
  'A linha da planilha de rescisão como estava no Excel (cabeçalho → valor; datas em dd/mm/aaaa). Mig 20261021000030.';
COMMENT ON COLUMN public."RH_RESCISAO".status_desde IS
  'Desde quando está no status atual (coluna do kanban). Mantido pelo gatilho rh_rescisao_tocar.';

-- atualizado_em + status_desde: o gatilho de antes passa a carimbar também a
-- troca de coluna.
CREATE OR REPLACE FUNCTION public.rh_rescisao_tocar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  NEW.atualizado_em := now();
  IF NEW.status_rescisao IS DISTINCT FROM OLD.status_rescisao THEN
    NEW.status_desde := now();
  END IF;
  RETURN NEW;
END $fn$;

-- ── 2. Histórico das trocas de status ────────────────────────────────
CREATE TABLE IF NOT EXISTS public."RH_RESCISAO_HISTORICO" (
  id           BIGSERIAL PRIMARY KEY,
  rescisao_id  BIGINT NOT NULL REFERENCES public."RH_RESCISAO"(id) ON DELETE CASCADE,
  status_de    TEXT,
  status_para  TEXT,
  por          TEXT,
  user_id      UUID DEFAULT auth.uid(),
  em           TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public."RH_RESCISAO_HISTORICO" IS
  'Trocas de status da rescisão (kanban). Gravado pelo gatilho rh_rescisao_historico. Mig 20261021000030.';
CREATE INDEX IF NOT EXISTS rh_rescisao_historico_rescisao_idx ON public."RH_RESCISAO_HISTORICO"(rescisao_id, em DESC);

-- SECURITY DEFINER: quem move o card não precisa (nem deve) ter INSERT
-- direto no histórico — o rastro não é editável pela tela.
CREATE OR REPLACE FUNCTION public.rh_rescisao_historico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public."RH_RESCISAO_HISTORICO" (rescisao_id, status_de, status_para, por)
    VALUES (NEW.id, NULL, NEW.status_rescisao, NEW.atualizado_por);
  ELSIF NEW.status_rescisao IS DISTINCT FROM OLD.status_rescisao THEN
    INSERT INTO public."RH_RESCISAO_HISTORICO" (rescisao_id, status_de, status_para, por)
    VALUES (NEW.id, OLD.status_rescisao, NEW.status_rescisao, NEW.atualizado_por);
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.rh_rescisao_historico() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rh_rescisao_historico() FROM anon;

DROP TRIGGER IF EXISTS trg_rh_rescisao_historico ON public."RH_RESCISAO";
CREATE TRIGGER trg_rh_rescisao_historico
  AFTER INSERT OR UPDATE OF status_rescisao ON public."RH_RESCISAO"
  FOR EACH ROW EXECUTE FUNCTION public.rh_rescisao_historico();

-- ── 3. Módulo e menu ─────────────────────────────────────────────────
INSERT INTO public.app_modulo (codigo, nome, descricao, icone, ordem, ativo)
VALUES ('rescisoes', 'Rescisões', 'Controle das rescisões: kanban de status, planilha do RH, malote e documentação', 'FileX2',
        COALESCE((SELECT ordem FROM public.app_modulo WHERE codigo = 'recrutamento'), 100) + 1, true)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, descricao = EXCLUDED.descricao, icone = EXCLUDED.icone, ativo = true;

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'rescisoes_gestao', 'Gestão de Rescisões', '/app/rh/rescisoes', 1
  FROM public.app_modulo m WHERE m.codigo = 'rescisoes'
ON CONFLICT (modulo_id, codigo) DO NOTHING;
UPDATE public.app_menu SET ativo = true WHERE codigo = 'rescisoes_gestao';

-- Quem já controlava a rescisão em rh_demissoes ganha as mesmas ações aqui.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT pp.perfil_id, 'rescisoes_gestao', pp.acao, true
  FROM public.perfil_acesso_permissao pp
 WHERE pp.menu_codigo = 'rh_demissoes' AND pp.allow
   AND NOT EXISTS (SELECT 1 FROM public.perfil_acesso_permissao x
                    WHERE x.perfil_id = pp.perfil_id AND x.menu_codigo = 'rescisoes_gestao' AND x.acao = pp.acao);

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, 'rescisoes_gestao', s.acao, true,
       'Migração 20261021000030: já tinha Solicitações de Demissão (RH)'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'rh_demissoes' AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'rescisoes_gestao' AND x.acao = s.acao);

-- ── 4. RLS — as duas telas ───────────────────────────────────────────
DROP POLICY IF EXISTS rh_rescisao_select ON public."RH_RESCISAO";
CREATE POLICY rh_rescisao_select ON public."RH_RESCISAO" FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'rescisoes_gestao', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'rh_demissoes', 'visualizar'));

DROP POLICY IF EXISTS rh_rescisao_insert ON public."RH_RESCISAO";
CREATE POLICY rh_rescisao_insert ON public."RH_RESCISAO" FOR INSERT TO authenticated
  WITH CHECK (public.has_screen_access(auth.uid(), 'rescisoes_gestao', 'alterar')
           OR public.has_screen_access(auth.uid(), 'rescisoes_gestao', 'aprovar')
           OR public.has_screen_access(auth.uid(), 'rh_demissoes', 'alterar')
           OR public.has_screen_access(auth.uid(), 'rh_demissoes', 'aprovar'));

DROP POLICY IF EXISTS rh_rescisao_update ON public."RH_RESCISAO";
CREATE POLICY rh_rescisao_update ON public."RH_RESCISAO" FOR UPDATE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'rescisoes_gestao', 'alterar')
      OR public.has_screen_access(auth.uid(), 'rescisoes_gestao', 'aprovar')
      OR public.has_screen_access(auth.uid(), 'rh_demissoes', 'alterar')
      OR public.has_screen_access(auth.uid(), 'rh_demissoes', 'aprovar'))
  WITH CHECK (public.has_screen_access(auth.uid(), 'rescisoes_gestao', 'alterar')
           OR public.has_screen_access(auth.uid(), 'rescisoes_gestao', 'aprovar')
           OR public.has_screen_access(auth.uid(), 'rh_demissoes', 'alterar')
           OR public.has_screen_access(auth.uid(), 'rh_demissoes', 'aprovar'));

DROP POLICY IF EXISTS rh_rescisao_delete ON public."RH_RESCISAO";
CREATE POLICY rh_rescisao_delete ON public."RH_RESCISAO" FOR DELETE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'rescisoes_gestao', 'excluir')
      OR public.has_screen_access(auth.uid(), 'rh_demissoes', 'excluir'));

ALTER TABLE public."RH_RESCISAO_HISTORICO" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."RH_RESCISAO_HISTORICO" TO authenticated;

DROP POLICY IF EXISTS rh_rescisao_historico_select ON public."RH_RESCISAO_HISTORICO";
CREATE POLICY rh_rescisao_historico_select ON public."RH_RESCISAO_HISTORICO" FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'rescisoes_gestao', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'rh_demissoes', 'visualizar'));

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_rh_rescisao_historico ON public."RH_RESCISAO";
-- DROP FUNCTION IF EXISTS public.rh_rescisao_historico();
-- DROP TABLE IF EXISTS public."RH_RESCISAO_HISTORICO";
-- (rh_rescisao_tocar: voltar ao corpo da mig 20261019000030; policies idem, só rh_demissoes)
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'rescisoes_gestao';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'rescisoes_gestao';
-- DELETE FROM public.app_menu WHERE codigo = 'rescisoes_gestao';
-- DELETE FROM public.app_modulo WHERE codigo = 'rescisoes';
-- ALTER TABLE public."RH_RESCISAO" DROP CONSTRAINT IF EXISTS rh_rescisao_origem_chk;
-- ALTER TABLE public."RH_RESCISAO" ADD CONSTRAINT rh_rescisao_origem_chk CHECK (origem IN ('erp', 'planilha'));
-- ALTER TABLE public."RH_RESCISAO" DROP COLUMN IF EXISTS planilha_original, DROP COLUMN IF EXISTS planilha_aba,
--   DROP COLUMN IF EXISTS pontos_ajustados, DROP COLUMN IF EXISTS data_admissao, DROP COLUMN IF EXISTS status_desde;
-- NOTIFY pgrst, 'reload schema';
