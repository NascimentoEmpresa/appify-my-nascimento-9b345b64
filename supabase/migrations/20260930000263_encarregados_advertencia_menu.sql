-- =====================================================================
-- SOLICITAR MEDIDA DISCIPLINAR NO MÓDULO ENCARREGADOS — menu próprio
-- (encarregados_advertencia)
--
-- O PROBLEMA (relatado em 29/09/2026, com print do Gerenciamento de Acesso):
-- no /app/administracao?tab=modulos, o bloco "Encarregados" não tinha chave
-- para "Solicitar Medida Disciplinar", embora a sidebar desenhe o item dentro
-- de Encarregados › Jurídico. Não havia chave porque não havia linha em
-- app_menu para /app/encarregados/advertencia — e matchMenuCode() casa por
-- prefixo mais longo, então a rota caía no menu raiz `minhas_solicitações`
-- (rota '/app/encarregados', o toggle "Encarregados" do topo do bloco).
-- Resultado: não dava para liberar/tirar a medida disciplinar sozinha; ela
-- andava junto com o acesso ao módulo inteiro. Mesmo desenho do caso das
-- Diárias (20260930000065).
--
-- A SOLUÇÃO: menu próprio com a rota exata. A chave passa a aparecer no bloco
-- Encarregados e governa só este item.
--
-- NINGUÉM GANHA NEM PERDE ACESSO NO DEPLOY: a partir desta linha a rota deixa
-- de herdar `minhas_solicitações`, então as regras de quem já tinha aquele
-- menu (liberadas E negadas) são copiadas para o menu novo, ação por ação.
--
-- O que NÃO muda: a decisão da medida continua no Jurídico (menu
-- `advertencias`, ação 'aprovar'). A policy adv_insert já é
-- `solicitante_email = auth.email() OR ...` — o gate de quem abre é a tela;
-- este arquivo não toca RLS de SISTEMA_SOLICITACOES_ADVERTENCIA.
-- =====================================================================

-- ── 1) Menu ──────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT mo.id, 'encarregados_advertencia', 'Solicitar Medida Disciplinar', '/app/encarregados/advertencia', 44
  FROM public.app_modulo mo
 WHERE mo.codigo = 'encarregados'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu am WHERE am.codigo = 'encarregados_advertencia');

-- can_access() devolve false para menu inativo antes de olhar perfil.
UPDATE public.app_menu SET ativo = true WHERE codigo = 'encarregados_advertencia';

-- ── 2) Herança das regras atuais ─────────────────────────────────────
-- Por usuário (fonte da verdade): copia allow=true e allow=false.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo, created_by)
SELECT s.user_id, 'encarregados_advertencia', s.acao, s.allow, s.empresa_id,
       'Herdado de minhas_solicitações (mig 20260930000263)', s.created_by
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'minhas_solicitações'
   AND NOT EXISTS (
     SELECT 1 FROM public.screen_permission_user x
      WHERE x.user_id = s.user_id
        AND x.menu_codigo = 'encarregados_advertencia'
        AND x.acao = s.acao
        AND x.empresa_id IS NOT DISTINCT FROM s.empresa_id
   );

-- Perfil de módulo "Encarregados": mesmo pacote que ele tem no menu raiz.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'encarregados_advertencia', v.acao::public.app_acao, true
  FROM public.perfil_acesso pa
  JOIN (VALUES ('visualizar'), ('incluir')) AS v(acao) ON true
 WHERE pa.nome = 'Encarregados' AND pa.ativo = true AND pa.concede_tudo = false
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- DELETE FROM public.screen_permission_user  WHERE menu_codigo = 'encarregados_advertencia';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'encarregados_advertencia';
-- DELETE FROM public.app_menu                WHERE codigo      = 'encarregados_advertencia';
-- NOTIFY pgrst, 'reload schema';
