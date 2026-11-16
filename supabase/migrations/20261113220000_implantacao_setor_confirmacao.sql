-- =====================================================================
-- [SEM-CHAMADO] — Implantação de Contratos: painel por setor e
--                 "confirmação de recebimento por setor"
--
-- CONTEXTO
--   O painel novo (/app/licitacoes/implantacao/painel e /painel/<setor>)
--   lê as respostas que JÁ estão em `checklist_respostas`, agrupadas pelo
--   "Resp. ação" de cada pergunta (`checklist_items.responsavel_acao`).
--   Nada é lançado de novo. O único dado que não existia era o passo do
--   fluxo "Confirmação de recebimento por setor": quem do setor confirmou
--   que recebeu as informações, e quando.
--
-- O QUE CRIA (a menor peça que faltava)
--   1) "IMPLANTACAO_SETOR_CONFIRMACAO" — 1 linha por contrato + setor.
--      `assinatura` é a impressão digital das respostas do setor no momento
--      da confirmação (calculada no front, src/lib/implantacao/painelSetores.ts).
--      Se uma resposta muda depois, a assinatura não bate e o painel mostra
--      a confirmação como desatualizada — o setor confirma de novo. Por isso
--      não precisa de gatilho em `checklist_respostas`.
--      `setor` é texto livre de propósito: os setores nascem do
--      responsavel_acao das perguntas, não de uma lista fixa.
--   2) Gatilho que carimba confirmado_por = auth.uid() e confirmado_em =
--      now() — ninguém confirma em nome de outro nem com data inventada.
--   3) Menu fantasma 'licitacoes-implantacao-confirmar-setor' (rota NULL):
--      quem pode clicar "Confirmar recebimento". Acesso é por pessoa
--      (README), então a liberação fica no Gerenciamento de Acesso.
--      SEMENTE (menu sem linha de permissão seria lido como aberto para
--      todos — ver 20261020000020): perfis que concedem tudo e quem hoje já
--      tem 'alterar' na Implantação (perfil ou pessoa).
--   4) RLS: ler = quem já lê o checklist (mesmo critério da 20261021000080);
--      gravar/desfazer = menu fantasma.
--
-- NÃO MUDA
--   checklist_items, checklist_respostas e suas policies.
--
-- Migration leve (tabela nova + 1 menu): pode rodar inteira de uma vez.
-- Idempotente. ROLLBACK no fim.
-- =====================================================================
SET lock_timeout = '5s';

-- 1) Tabela ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."IMPLANTACAO_SETOR_CONFIRMACAO" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id    uuid NOT NULL REFERENCES public.implantacao_contrato(id) ON DELETE CASCADE,
  setor          text NOT NULL CHECK (btrim(setor) <> ''),
  assinatura     text NOT NULL CHECK (btrim(assinatura) <> ''),
  confirmado_por uuid,
  confirmado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contrato_id, setor)
);

COMMENT ON TABLE public."IMPLANTACAO_SETOR_CONFIRMACAO" IS
  'Confirmação de recebimento das informações da Implantação por setor (Resp. ação do checklist). assinatura = respostas do setor no momento da confirmação.';

-- 2) Carimbo de quem e quando -------------------------------------------
CREATE OR REPLACE FUNCTION public.implantacao_setor_confirmacao_carimbo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.confirmado_por := auth.uid();
  NEW.confirmado_em  := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_implantacao_setor_confirmacao_carimbo ON public."IMPLANTACAO_SETOR_CONFIRMACAO";
CREATE TRIGGER trg_implantacao_setor_confirmacao_carimbo
  BEFORE INSERT OR UPDATE ON public."IMPLANTACAO_SETOR_CONFIRMACAO"
  FOR EACH ROW EXECUTE FUNCTION public.implantacao_setor_confirmacao_carimbo();

-- 3) Menu fantasma + semente ----------------------------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'licitacoes-implantacao-confirmar-setor',
       'Licitações — Implantação: Confirmar recebimento por setor', NULL, 32, true
  FROM public.app_modulo m WHERE m.codigo = 'licitacoes'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('licitacoes-implantacao-confirmar-setor', 'visualizar')
ON CONFLICT DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'licitacoes-implantacao-confirmar-setor', 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso pa
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT p.perfil_id, 'licitacoes-implantacao-confirmar-setor', 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso_permissao p
  JOIN public.perfil_acesso pa ON pa.id = p.perfil_id AND pa.ativo AND NOT pa.concede_tudo
 WHERE p.menu_codigo = 'licitacoes.implantacao' AND p.acao = 'alterar' AND p.allow
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- empresa_id nulo nunca conflita no UNIQUE: o NOT EXISTS é que garante que reexecutar não duplica.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT s.user_id, 'licitacoes-implantacao-confirmar-setor', 'visualizar'::public.app_acao, true, s.empresa_id,
       'Painel por setor da Implantação: quem altera a Implantação pode confirmar recebimento'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'licitacoes.implantacao' AND s.acao = 'alterar' AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'licitacoes-implantacao-confirmar-setor'
                      AND x.acao = 'visualizar' AND x.empresa_id IS NOT DISTINCT FROM s.empresa_id);

-- 4) RLS ---------------------------------------------------------------
ALTER TABLE public."IMPLANTACAO_SETOR_CONFIRMACAO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS implantacao_setor_confirmacao_select ON public."IMPLANTACAO_SETOR_CONFIRMACAO";
CREATE POLICY implantacao_setor_confirmacao_select ON public."IMPLANTACAO_SETOR_CONFIRMACAO"
  FOR SELECT TO authenticated
  USING ((
    SELECT public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'visualizar'::app_acao)
        OR public.can_access(auth.uid(), 'implantacao'::text, 'visualizar'::app_acao)
  ));

DROP POLICY IF EXISTS implantacao_setor_confirmacao_insert ON public."IMPLANTACAO_SETOR_CONFIRMACAO";
CREATE POLICY implantacao_setor_confirmacao_insert ON public."IMPLANTACAO_SETOR_CONFIRMACAO"
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.can_access(auth.uid(), 'licitacoes-implantacao-confirmar-setor'::text, 'visualizar'::app_acao)));

DROP POLICY IF EXISTS implantacao_setor_confirmacao_update ON public."IMPLANTACAO_SETOR_CONFIRMACAO";
CREATE POLICY implantacao_setor_confirmacao_update ON public."IMPLANTACAO_SETOR_CONFIRMACAO"
  FOR UPDATE TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'licitacoes-implantacao-confirmar-setor'::text, 'visualizar'::app_acao)))
  WITH CHECK ((SELECT public.can_access(auth.uid(), 'licitacoes-implantacao-confirmar-setor'::text, 'visualizar'::app_acao)));

DROP POLICY IF EXISTS implantacao_setor_confirmacao_delete ON public."IMPLANTACAO_SETOR_CONFIRMACAO";
CREATE POLICY implantacao_setor_confirmacao_delete ON public."IMPLANTACAO_SETOR_CONFIRMACAO"
  FOR DELETE TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'licitacoes-implantacao-confirmar-setor'::text, 'visualizar'::app_acao)));

GRANT SELECT, INSERT, UPDATE, DELETE ON public."IMPLANTACAO_SETOR_CONFIRMACAO" TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP TABLE IF EXISTS public."IMPLANTACAO_SETOR_CONFIRMACAO";
--   DROP FUNCTION IF EXISTS public.implantacao_setor_confirmacao_carimbo();
--   DELETE FROM public.screen_permission_user  WHERE menu_codigo = 'licitacoes-implantacao-confirmar-setor';
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'licitacoes-implantacao-confirmar-setor';
--   DELETE FROM public.app_menu_acao           WHERE menu_codigo = 'licitacoes-implantacao-confirmar-setor';
--   DELETE FROM public.app_menu                WHERE codigo      = 'licitacoes-implantacao-confirmar-setor';
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
