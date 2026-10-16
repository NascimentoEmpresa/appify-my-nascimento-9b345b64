-- =========================================================================
-- SISTEMA_COMENTARIOS: RLS por módulo (fecha o USING (true))
--
-- ⚠ RASCUNHO — NÃO APLICADO. Aguarda o OK do Pablo (16/10/2026).
--
-- O PROBLEMA
--   O feed único (consolidação de jun/2026, mig 20260622000016) nasceu com UMA
--   policy, "SISTEMA_COMENTARIOS_all_auth" FOR ALL USING (true) WITH CHECK
--   (true). Qualquer login lê, grava, edita e apaga qualquer comentário de
--   qualquer módulo. Em 16/10/2026: advertencia 98, demissao 79, processo 53,
--   ferias 37, troca_funcao 11, patrimonio 2 — e a conversa de advertência e
--   demissão é exatamente o tipo de coisa que não pode vazar. Achado ao montar
--   os comentários do Quadro de Avisos (mig 20261016000003), que teve de ganhar
--   tabelas próprias porque aqui não dava para restringir: policies
--   permissivas somam com OR, e esta abria tudo.
--
-- A RÉGUA: "quem vê a coisa vê a conversa dela"
--   Cada módulo segue o acesso da tela que já mostra aquela entidade — por
--   usuário (has_screen_access), nunca por cargo/empresa.
--
--   advertencia   herda o RLS de SISTEMA_SOLICITACOES_ADVERTENCIA: o EXISTS
--                 abaixo roda COM o RLS da tabela-mãe (adv_select = tela
--                 'advertencias' OU solicitante OU eh_analista_advertencia).
--                 Assim as duas réguas não divergem nunca.
--   ferias        tela rh_ferias, ou quem pediu (solicitante_email).
--   demissao      telas rh_demissoes, operacional_demissoes,
--                 diretoria_solicitacoes_demissao, licitacoes_analistas_demissao,
--                 sst_aso_demissional, ou quem pediu.
--   troca_funcao  telas rh_troca_funcao, operacional_troca_funcao,
--                 sst_troca_funcao, escritorio_troca_funcao,
--                 diretoria_troca_funcao, licitacoes_analistas_troca_funcao,
--                 ou quem pediu.
--   processo      tela 'processos' (a mesma de JUR_PROCESSOS).
--   patrimonio    tela 'patrimonios' (a mesma de JUR_PATRIMONIOS).
--   notificacao   tela 'juridico_notificacoes' (a mesma de JUR_NOTIFICACOES).
--   (módulo desconhecido: ninguém — deny-by-default. Módulo novo no feed
--    precisa ganhar a sua linha aqui.)
--
--   Os pais de férias/demissão/troca de função ainda são USING (true) também
--   (sf_all_auth, ssd_all_auth, stf_all_auth) — por isso aqui a régua é
--   explícita por tela e não herdada. Fechar os pais é outra conversa.
--
-- GRAVAR = poder ver. Hoje quem abre a conversa responde nela; exigir
--   'incluir' esbarraria no resíduo legado de acessos com só 'visualizar'
--   (ver memória permissoes-residuo-legado-visualizar).
-- APAGAR: só nos módulos do Jurídico (Processos/Patrimônios têm o botão), com
--   'excluir' na tela. A conversa de solicitação não tem botão de apagar —
--   fica sem policy de DELETE (ninguém apaga pela API).
-- SEM UPDATE: nenhuma tela edita comentário. As RPCs SECURITY DEFINER que
--   gravam aqui (demissao_cancelar, demissao_decidir_cancelamento,
--   demissao_efetivar_cancelamento, ferias_cancelar_pelo_rh) rodam como dono
--   da tabela e não passam pelo RLS — seguem funcionando.
--
-- DESEMPENHO (o banco caiu por memória esta semana): a ConversaSolicitacao
--   faz poll a cada 8 s. Cada has_screen_access vai embrulhado em (select …)
--   para virar initPlan (1 vez por query, não por linha), e o id da mãe é
--   convertido por CASE para bater no índice da PK — o CASE também impede o
--   ::bigint de estourar em entidade_id de processo (número CNJ, texto).
--
-- Idempotente. Aplicar no banco do app (fwmzeaztjxrxxzxzxmgc) — e anon perde
-- os GRANTs que nunca deveria ter tido.
-- =========================================================================

-- id numérico da entidade, ou NULL (processo usa o número CNJ em texto).
-- IMMUTABLE + SQL puro: o planner inlina e o índice da PK da mãe é usado.
-- Sem SET search_path DE PROPÓSITO: função com SET não é inlinada, e esta não
-- toca tabela nenhuma (não é SECURITY DEFINER), então não há o que sequestrar.
CREATE OR REPLACE FUNCTION public.sistema_coment_id_num(_entidade_id text)
RETURNS bigint
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT CASE WHEN _entidade_id ~ '^[0-9]{1,18}$' THEN _entidade_id::bigint END $$;

REVOKE ALL ON public."SISTEMA_COMENTARIOS" FROM anon;

-- portaria-ok: R3 — a policy aberta (USING true) é o vazamento; as 17 policies por módulo abaixo passam a proteger a tabela
DROP POLICY IF EXISTS "SISTEMA_COMENTARIOS_all_auth" ON public."SISTEMA_COMENTARIOS";

-- ── advertencia — herda o RLS da advertência ─────────────────────────────
DROP POLICY IF EXISTS sistema_coment_advertencia_select ON public."SISTEMA_COMENTARIOS";
CREATE POLICY sistema_coment_advertencia_select ON public."SISTEMA_COMENTARIOS" FOR SELECT TO authenticated
  USING (modulo = 'advertencia' AND EXISTS (
    SELECT 1 FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA" a
     WHERE a.id = public.sistema_coment_id_num(entidade_id)));
DROP POLICY IF EXISTS sistema_coment_advertencia_insert ON public."SISTEMA_COMENTARIOS";
CREATE POLICY sistema_coment_advertencia_insert ON public."SISTEMA_COMENTARIOS" FOR INSERT TO authenticated
  WITH CHECK (modulo = 'advertencia' AND EXISTS (
    SELECT 1 FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA" a
     WHERE a.id = public.sistema_coment_id_num(entidade_id)));

-- ── ferias ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS sistema_coment_ferias_select ON public."SISTEMA_COMENTARIOS";
CREATE POLICY sistema_coment_ferias_select ON public."SISTEMA_COMENTARIOS" FOR SELECT TO authenticated
  USING (modulo = 'ferias' AND (
    (SELECT public.has_screen_access(auth.uid(), 'rh_ferias', 'visualizar'))
    OR EXISTS (SELECT 1 FROM public."SISTEMA_SOLICITACOES_FERIAS" f
                WHERE f.id = public.sistema_coment_id_num(entidade_id)
                  AND lower(f.solicitante_email) = lower((SELECT auth.email())))));
DROP POLICY IF EXISTS sistema_coment_ferias_insert ON public."SISTEMA_COMENTARIOS";
CREATE POLICY sistema_coment_ferias_insert ON public."SISTEMA_COMENTARIOS" FOR INSERT TO authenticated
  WITH CHECK (modulo = 'ferias' AND (
    (SELECT public.has_screen_access(auth.uid(), 'rh_ferias', 'visualizar'))
    OR EXISTS (SELECT 1 FROM public."SISTEMA_SOLICITACOES_FERIAS" f
                WHERE f.id = public.sistema_coment_id_num(entidade_id)
                  AND lower(f.solicitante_email) = lower((SELECT auth.email())))));

-- ── demissao ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS sistema_coment_demissao_select ON public."SISTEMA_COMENTARIOS";
CREATE POLICY sistema_coment_demissao_select ON public."SISTEMA_COMENTARIOS" FOR SELECT TO authenticated
  USING (modulo = 'demissao' AND (
    (SELECT public.has_screen_access(auth.uid(), 'rh_demissoes', 'visualizar'))
    OR (SELECT public.has_screen_access(auth.uid(), 'operacional_demissoes', 'visualizar'))
    OR (SELECT public.has_screen_access(auth.uid(), 'diretoria_solicitacoes_demissao', 'visualizar'))
    OR (SELECT public.has_screen_access(auth.uid(), 'licitacoes_analistas_demissao', 'visualizar'))
    OR (SELECT public.has_screen_access(auth.uid(), 'sst_aso_demissional', 'visualizar'))
    OR EXISTS (SELECT 1 FROM public."SISTEMA_SOLICITACOES_DEMISSAO" d
                WHERE d.id = public.sistema_coment_id_num(entidade_id)
                  AND lower(d.solicitante_email) = lower((SELECT auth.email())))));
DROP POLICY IF EXISTS sistema_coment_demissao_insert ON public."SISTEMA_COMENTARIOS";
CREATE POLICY sistema_coment_demissao_insert ON public."SISTEMA_COMENTARIOS" FOR INSERT TO authenticated
  WITH CHECK (modulo = 'demissao' AND (
    (SELECT public.has_screen_access(auth.uid(), 'rh_demissoes', 'visualizar'))
    OR (SELECT public.has_screen_access(auth.uid(), 'operacional_demissoes', 'visualizar'))
    OR (SELECT public.has_screen_access(auth.uid(), 'diretoria_solicitacoes_demissao', 'visualizar'))
    OR (SELECT public.has_screen_access(auth.uid(), 'licitacoes_analistas_demissao', 'visualizar'))
    OR (SELECT public.has_screen_access(auth.uid(), 'sst_aso_demissional', 'visualizar'))
    OR EXISTS (SELECT 1 FROM public."SISTEMA_SOLICITACOES_DEMISSAO" d
                WHERE d.id = public.sistema_coment_id_num(entidade_id)
                  AND lower(d.solicitante_email) = lower((SELECT auth.email())))));

-- ── troca_funcao ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS sistema_coment_troca_funcao_select ON public."SISTEMA_COMENTARIOS";
CREATE POLICY sistema_coment_troca_funcao_select ON public."SISTEMA_COMENTARIOS" FOR SELECT TO authenticated
  USING (modulo = 'troca_funcao' AND (
    (SELECT public.has_screen_access(auth.uid(), 'rh_troca_funcao', 'visualizar'))
    OR (SELECT public.has_screen_access(auth.uid(), 'operacional_troca_funcao', 'visualizar'))
    OR (SELECT public.has_screen_access(auth.uid(), 'sst_troca_funcao', 'visualizar'))
    OR (SELECT public.has_screen_access(auth.uid(), 'escritorio_troca_funcao', 'visualizar'))
    OR (SELECT public.has_screen_access(auth.uid(), 'diretoria_troca_funcao', 'visualizar'))
    OR (SELECT public.has_screen_access(auth.uid(), 'licitacoes_analistas_troca_funcao', 'visualizar'))
    OR EXISTS (SELECT 1 FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" t
                WHERE t.id = public.sistema_coment_id_num(entidade_id)
                  AND lower(t.solicitante_email) = lower((SELECT auth.email())))));
DROP POLICY IF EXISTS sistema_coment_troca_funcao_insert ON public."SISTEMA_COMENTARIOS";
CREATE POLICY sistema_coment_troca_funcao_insert ON public."SISTEMA_COMENTARIOS" FOR INSERT TO authenticated
  WITH CHECK (modulo = 'troca_funcao' AND (
    (SELECT public.has_screen_access(auth.uid(), 'rh_troca_funcao', 'visualizar'))
    OR (SELECT public.has_screen_access(auth.uid(), 'operacional_troca_funcao', 'visualizar'))
    OR (SELECT public.has_screen_access(auth.uid(), 'sst_troca_funcao', 'visualizar'))
    OR (SELECT public.has_screen_access(auth.uid(), 'escritorio_troca_funcao', 'visualizar'))
    OR (SELECT public.has_screen_access(auth.uid(), 'diretoria_troca_funcao', 'visualizar'))
    OR (SELECT public.has_screen_access(auth.uid(), 'licitacoes_analistas_troca_funcao', 'visualizar'))
    OR EXISTS (SELECT 1 FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" t
                WHERE t.id = public.sistema_coment_id_num(entidade_id)
                  AND lower(t.solicitante_email) = lower((SELECT auth.email())))));

-- ── processo (Jurídico › Processos) ──────────────────────────────────────
DROP POLICY IF EXISTS sistema_coment_processo_select ON public."SISTEMA_COMENTARIOS";
CREATE POLICY sistema_coment_processo_select ON public."SISTEMA_COMENTARIOS" FOR SELECT TO authenticated
  USING (modulo = 'processo' AND (SELECT public.has_screen_access(auth.uid(), 'processos', 'visualizar')));
DROP POLICY IF EXISTS sistema_coment_processo_insert ON public."SISTEMA_COMENTARIOS";
CREATE POLICY sistema_coment_processo_insert ON public."SISTEMA_COMENTARIOS" FOR INSERT TO authenticated
  WITH CHECK (modulo = 'processo' AND (SELECT public.has_screen_access(auth.uid(), 'processos', 'visualizar')));
DROP POLICY IF EXISTS sistema_coment_processo_delete ON public."SISTEMA_COMENTARIOS";
CREATE POLICY sistema_coment_processo_delete ON public."SISTEMA_COMENTARIOS" FOR DELETE TO authenticated
  USING (modulo = 'processo' AND (SELECT public.has_screen_access(auth.uid(), 'processos', 'excluir')));

-- ── patrimonio (Jurídico › Gestão Patrimonial) ───────────────────────────
DROP POLICY IF EXISTS sistema_coment_patrimonio_select ON public."SISTEMA_COMENTARIOS";
CREATE POLICY sistema_coment_patrimonio_select ON public."SISTEMA_COMENTARIOS" FOR SELECT TO authenticated
  USING (modulo = 'patrimonio' AND (SELECT public.has_screen_access(auth.uid(), 'patrimonios', 'visualizar')));
DROP POLICY IF EXISTS sistema_coment_patrimonio_insert ON public."SISTEMA_COMENTARIOS";
CREATE POLICY sistema_coment_patrimonio_insert ON public."SISTEMA_COMENTARIOS" FOR INSERT TO authenticated
  WITH CHECK (modulo = 'patrimonio' AND (SELECT public.has_screen_access(auth.uid(), 'patrimonios', 'visualizar')));
DROP POLICY IF EXISTS sistema_coment_patrimonio_delete ON public."SISTEMA_COMENTARIOS";
CREATE POLICY sistema_coment_patrimonio_delete ON public."SISTEMA_COMENTARIOS" FOR DELETE TO authenticated
  USING (modulo = 'patrimonio' AND (SELECT public.has_screen_access(auth.uid(), 'patrimonios', 'excluir')));

-- ── notificacao (Jurídico › Controle de Notificações) ────────────────────
DROP POLICY IF EXISTS sistema_coment_notificacao_select ON public."SISTEMA_COMENTARIOS";
CREATE POLICY sistema_coment_notificacao_select ON public."SISTEMA_COMENTARIOS" FOR SELECT TO authenticated
  USING (modulo = 'notificacao' AND (SELECT public.has_screen_access(auth.uid(), 'juridico_notificacoes', 'visualizar')));
DROP POLICY IF EXISTS sistema_coment_notificacao_insert ON public."SISTEMA_COMENTARIOS";
CREATE POLICY sistema_coment_notificacao_insert ON public."SISTEMA_COMENTARIOS" FOR INSERT TO authenticated
  WITH CHECK (modulo = 'notificacao' AND (SELECT public.has_screen_access(auth.uid(), 'juridico_notificacoes', 'visualizar')));
DROP POLICY IF EXISTS sistema_coment_notificacao_delete ON public."SISTEMA_COMENTARIOS";
CREATE POLICY sistema_coment_notificacao_delete ON public."SISTEMA_COMENTARIOS" FOR DELETE TO authenticated
  USING (modulo = 'notificacao' AND (SELECT public.has_screen_access(auth.uid(), 'juridico_notificacoes', 'excluir')));

COMMENT ON TABLE public."SISTEMA_COMENTARIOS" IS
  'Feed único de comentários (modulo + entidade_id). RLS por módulo desde a mig 20261016000004 — módulo novo precisa de policy própria, senão ninguém lê.';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (volta ao feed aberto — só em emergência, reabre o vazamento)
-- DROP POLICY IF EXISTS sistema_coment_advertencia_select ON public."SISTEMA_COMENTARIOS";
-- DROP POLICY IF EXISTS sistema_coment_advertencia_insert ON public."SISTEMA_COMENTARIOS";
-- DROP POLICY IF EXISTS sistema_coment_ferias_select ON public."SISTEMA_COMENTARIOS";
-- DROP POLICY IF EXISTS sistema_coment_ferias_insert ON public."SISTEMA_COMENTARIOS";
-- DROP POLICY IF EXISTS sistema_coment_demissao_select ON public."SISTEMA_COMENTARIOS";
-- DROP POLICY IF EXISTS sistema_coment_demissao_insert ON public."SISTEMA_COMENTARIOS";
-- DROP POLICY IF EXISTS sistema_coment_troca_funcao_select ON public."SISTEMA_COMENTARIOS";
-- DROP POLICY IF EXISTS sistema_coment_troca_funcao_insert ON public."SISTEMA_COMENTARIOS";
-- DROP POLICY IF EXISTS sistema_coment_processo_select ON public."SISTEMA_COMENTARIOS";
-- DROP POLICY IF EXISTS sistema_coment_processo_insert ON public."SISTEMA_COMENTARIOS";
-- DROP POLICY IF EXISTS sistema_coment_processo_delete ON public."SISTEMA_COMENTARIOS";
-- DROP POLICY IF EXISTS sistema_coment_patrimonio_select ON public."SISTEMA_COMENTARIOS";
-- DROP POLICY IF EXISTS sistema_coment_patrimonio_insert ON public."SISTEMA_COMENTARIOS";
-- DROP POLICY IF EXISTS sistema_coment_patrimonio_delete ON public."SISTEMA_COMENTARIOS";
-- DROP POLICY IF EXISTS sistema_coment_notificacao_select ON public."SISTEMA_COMENTARIOS";
-- DROP POLICY IF EXISTS sistema_coment_notificacao_insert ON public."SISTEMA_COMENTARIOS";
-- DROP POLICY IF EXISTS sistema_coment_notificacao_delete ON public."SISTEMA_COMENTARIOS";
-- DROP POLICY IF EXISTS "SISTEMA_COMENTARIOS_all_auth" ON public."SISTEMA_COMENTARIOS";
-- CREATE POLICY "SISTEMA_COMENTARIOS_all_auth" ON public."SISTEMA_COMENTARIOS" FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- DROP FUNCTION IF EXISTS public.sistema_coment_id_num(text);
-- NOTIFY pgrst, 'reload schema';
