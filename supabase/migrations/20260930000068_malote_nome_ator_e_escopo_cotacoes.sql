-- [SEM-CHAMADO] (achado real, relatado pelo Iury em conversa) — 2 problemas
-- distintos encontrados revisando /app/malote/solicitacao/:id.

-- ── 1. Nome do solicitante/ator só aparece pra quem tem Administração/
-- Administrador Geral ────────────────────────────────────────────────────
-- useNomeUsuario() (várias telas: DespesaVisualizar "Histórico detalhado",
-- PagamentoMalote, Aprovacoes, JustificativaPendenteBadge,
-- FluxoAprovacaoVisual) faz `SELECT display_name, email FROM profiles WHERE
-- id = <ator_user_id>` direto na tabela. RLS de profiles
-- (profiles_self_select) é `id = auth.uid() OR can_access(administracao,
-- visualizar)` — resolver o nome de QUALQUER OUTRO usuário falha
-- silenciosamente pra quem não tem esse acesso, exatamente como o Iury
-- descreveu. Em vez de abrir a RLS de `profiles` (a tabela tem telefone,
-- bio, must_change_password — não dá pra abrir a linha toda pra qualquer
-- authenticated), uma RPC estreita que só devolve nome/email (não a linha
-- inteira) resolve sem esse risco.
CREATE OR REPLACE FUNCTION public.nome_usuario_ator(_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(display_name, email) FROM public.profiles WHERE id = _user_id;
$$;

REVOKE ALL ON FUNCTION public.nome_usuario_ator(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nome_usuario_ator(uuid) TO authenticated;

-- ── 2. sup_cotacoes_malote:visualizar deixa ver TODAS as despesas, não só
-- as que dependem de cotação ──────────────────────────────────────────────
-- Migration 20260901000003 adicionou esse ramo pro comprador enxergar a
-- solicitação que precisa cotar (achado real da época: CASSIO via 0 de 16
-- solicitações) — mas sem filtro de status, então quem tem essa permissão
-- vê despesa de QUALQUER setor/status, inclusive já pagas/de outro setor
-- que nada tem a ver com cotação (achado real do Iury). O client já limita
-- a tela de Cotações do Malote a exatamente esses 5 status
-- (STATUS_SUPRIMENTOS, useMaloteCotacao.ts) — a RLS passa a exigir o mesmo.
CREATE OR REPLACE FUNCTION public.malote_despesa_em_fase_cotacao(_status text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT _status = ANY (ARRAY['aguardando_cotacao', 'cotacao_realizada', 'cotacao_aprovada', 'solicitacao_reprovada', 'cancelada']);
$$;

DROP POLICY IF EXISTS malote_despesa_select ON public.malote_despesa;
CREATE POLICY malote_despesa_select ON public.malote_despesa
  FOR SELECT TO authenticated
  USING (
    (created_by = auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
    OR (public.user_pode_ver_empresa(auth.uid(), empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), classificacao_id))
    OR (can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao) AND public.malote_despesa_em_fase_cotacao(status))
    OR can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao)
    OR (excecao AND status = 'pendente_aprovacao'::text AND malote_gerente_financeiro(auth.uid()))
  );

DROP POLICY IF EXISTS malote_despesa_item_select ON public.malote_despesa_item;
CREATE POLICY malote_despesa_item_select ON public.malote_despesa_item
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_item.despesa_id
         AND (
           d.created_by = auth.uid()
           OR has_role(auth.uid(), 'admin'::app_role)
           OR malote_supervisor_por_cargo(auth.uid())
           OR (public.user_pode_ver_empresa(auth.uid(), d.empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
           OR (can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao) AND public.malote_despesa_em_fase_cotacao(d.status))
           OR can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao)
         )
    )
  );

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- NOTA (não aplicado nesta migration, decisão pendente já registrada em
-- memória de sessão): o ramo `can_access(..., 'malote_pagamento',
-- 'aprovar')` nas mesmas 2 policies (e em sup_compra_pedido/
-- sup_compra_pedido_item) tem o MESMO problema — vê despesa de qualquer
-- setor sem filtro de status/fase. Não escopado aqui porque afeta pessoas
-- reais diferentes e precisa de decisão própria (mesma ressalva já
-- levantada antes) — fica como próximo item a decidir, não esquecido.
--
-- ROLLBACK
--   DROP POLICY IF EXISTS malote_despesa_select ON public.malote_despesa;
--   CREATE POLICY malote_despesa_select ON public.malote_despesa
--     FOR SELECT TO authenticated
--     USING (
--       (created_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)
--       OR (user_pode_ver_empresa(auth.uid(), empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), classificacao_id))
--       OR can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao)
--       OR can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao)
--       OR (excecao AND status = 'pendente_aprovacao'::text AND malote_gerente_financeiro(auth.uid()))
--     );
--   DROP POLICY IF EXISTS malote_despesa_item_select ON public.malote_despesa_item;
--   CREATE POLICY malote_despesa_item_select ON public.malote_despesa_item
--     FOR SELECT TO authenticated
--     USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = malote_despesa_item.despesa_id
--       AND (d.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role) OR malote_supervisor_por_cargo(auth.uid())
--       OR (user_pode_ver_empresa(auth.uid(), d.empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
--       OR can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao)
--       OR can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao))));
--   DROP FUNCTION IF EXISTS public.malote_despesa_em_fase_cotacao(text);
--   REVOKE EXECUTE ON FUNCTION public.nome_usuario_ator(uuid) FROM authenticated;
--   DROP FUNCTION IF EXISTS public.nome_usuario_ator(uuid);
-- =====================================================================
