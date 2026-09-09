-- =========================================================================
-- Solicitação de vaga: EDITAR e APAGAR viram capacidades do painel de acesso
--
-- Pedido: "no gerenciamento por acesso, poder Editar e Apagar qualquer
-- informação de solicitação de vagas — sem criar gerenciamento novo".
--
-- Então nada de tela nova de permissão: entram dois MENUS FANTASMA
-- (`app_menu.rota = NULL`), que é o mecanismo que este módulo já usa para
-- capacidade que não é tela — ver `recrutamento_etapa_juridico` e
-- `recrutamento_vaga_administrativa`. Eles aparecem sozinhos em
-- Administração › Acesso por Usuário, dentro de Recrutamento e Seleção,
-- porque aquele painel lista o que está em app_menu e monta os switches a
-- partir de app_menu_acao.
--
-- POR QUE DOIS MENUS, E NÃO DUAS AÇÕES EM `recrutamento_gestao`
--   Porque `alterar` já é usada lá para outra coisa: é ela que decide quem
--   CONDUZ o processo seletivo (`podeRecrutar`, em Recrutamento.tsx). Pior,
--   `alterar` entra de brinde no toggle da tela (ACOES_DO_TOGGLE_PADRAO):
--   liberar o Recrutamento para alguém passaria a autorizar, no mesmo gesto,
--   reescrever qualquer solicitação de vaga. Capacidade separada é o que
--   deixa o admin dizer "conduz o processo, mas não reescreve o pedido".
--
-- ⚠ E UM BURACO QUE ESTAVA ABERTO
--   As duas policies da tabela eram `FOR ALL`, e num `FOR ALL` a cláusula
--   USING vale também para o DELETE. Ou seja: quem podia VER uma solicitação
--   podia APAGÁ-LA pela API. Não havia botão na tela, então ninguém tinha
--   feito — mas bastava um DELETE via PostgREST. Aqui as policies passam a
--   ser por comando, e o DELETE exige a capacidade nova.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── As duas capacidades ──────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, v.codigo, v.nome, NULL, v.ordem, true
  FROM public.app_modulo m
  CROSS JOIN (VALUES
    ('recrutamento_solicitacao_editar',  'Editar solicitação de vaga',  26),
    ('recrutamento_solicitacao_excluir', 'Apagar solicitação de vaga',  27)
  ) AS v(codigo, nome, ordem)
 WHERE m.codigo = 'recrutamento'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Quais switches o painel desenha para cada um. Um switch por menu, de
-- propósito: o nome do menu já diz o que ele libera.
INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES
  ('recrutamento_solicitacao_editar',  'alterar'::app_acao),
  ('recrutamento_solicitacao_excluir', 'excluir'::app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- ── RLS: as mesmas regras de antes, agora por comando ────────────────────
-- Trigger/policy nunca usa CREATE OR REPLACE: DROP + CREATE, para reexecutar
-- sem erro.

DROP POLICY IF EXISTS sistema_recrutamento_gate ON public."SISTEMA_RECRUTAMENTO";
DROP POLICY IF EXISTS sistema_recrutamento_operacional ON public."SISTEMA_RECRUTAMENTO";
DROP POLICY IF EXISTS sistema_recrutamento_select ON public."SISTEMA_RECRUTAMENTO";
DROP POLICY IF EXISTS sistema_recrutamento_insert ON public."SISTEMA_RECRUTAMENTO";
DROP POLICY IF EXISTS sistema_recrutamento_update ON public."SISTEMA_RECRUTAMENTO";
DROP POLICY IF EXISTS sistema_recrutamento_delete ON public."SISTEMA_RECRUTAMENTO";

-- Vaga do escritório continua escondida de quem não pode vê-la, em TODOS os
-- comandos — era assim antes e não muda aqui.
CREATE POLICY sistema_recrutamento_select ON public."SISTEMA_RECRUTAMENTO"
  FOR SELECT TO authenticated
  USING (
    (
      has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'visualizar'::app_acao)
    )
    AND ((NOT administrativa) OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao))
  );

-- INSERT e UPDATE repetem, LINHA POR LINHA, o que as duas policies FOR ALL
-- já autorizavam — inclusive o que parece frouxo (o UPDATE só pedia
-- 'visualizar' no USING; quem grava é decidido no WITH CHECK). Apertar isso
-- de carona numa migration que veio para OUTRA coisa é como se tira o acesso
-- de alguém sem ninguém entender por quê. A única adição é a porta nova.
CREATE POLICY sistema_recrutamento_insert ON public."SISTEMA_RECRUTAMENTO"
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir'::app_acao)
      OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar'::app_acao)
      OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'incluir'::app_acao)
      OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'alterar'::app_acao)
      OR has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'incluir'::app_acao)
      OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'alterar'::app_acao)
      OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'aprovar'::app_acao)
    )
    AND ((NOT administrativa) OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao))
  );

-- UPDATE: quem conduz o processo (mover status, aprovar) continua igual; a
-- capacidade nova entra como mais uma porta, para quem só corrige o pedido.
CREATE POLICY sistema_recrutamento_update ON public."SISTEMA_RECRUTAMENTO"
  FOR UPDATE TO authenticated
  USING (
    (
      has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'visualizar'::app_acao)
    )
    AND ((NOT administrativa) OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao))
  )
  WITH CHECK (
    (
      has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir'::app_acao)
      OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar'::app_acao)
      OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'incluir'::app_acao)
      OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'alterar'::app_acao)
      OR has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'incluir'::app_acao)
      OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'alterar'::app_acao)
      OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'aprovar'::app_acao)
      OR has_screen_access(auth.uid(), 'recrutamento_solicitacao_editar', 'alterar'::app_acao)
    )
    AND ((NOT administrativa) OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao))
  );

-- DELETE: SÓ a capacidade nova. Antes bastava enxergar.
CREATE POLICY sistema_recrutamento_delete ON public."SISTEMA_RECRUTAMENTO"
  FOR DELETE TO authenticated
  USING (
    has_screen_access(auth.uid(), 'recrutamento_solicitacao_excluir', 'excluir'::app_acao)
    AND ((NOT administrativa) OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao))
  );

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP POLICY IF EXISTS sistema_recrutamento_select ON public."SISTEMA_RECRUTAMENTO";
-- DROP POLICY IF EXISTS sistema_recrutamento_insert ON public."SISTEMA_RECRUTAMENTO";
-- DROP POLICY IF EXISTS sistema_recrutamento_update ON public."SISTEMA_RECRUTAMENTO";
-- DROP POLICY IF EXISTS sistema_recrutamento_delete ON public."SISTEMA_RECRUTAMENTO";
--
-- CREATE POLICY sistema_recrutamento_gate ON public."SISTEMA_RECRUTAMENTO"
--   FOR ALL TO authenticated
--   USING (
--     (has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
--      OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao)
--      OR has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao))
--     AND ((NOT administrativa) OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao))
--   )
--   WITH CHECK (
--     (has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir'::app_acao)
--      OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar'::app_acao)
--      OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'incluir'::app_acao)
--      OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'alterar'::app_acao)
--      OR has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'incluir'::app_acao))
--     AND ((NOT administrativa) OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao))
--   );
--
-- CREATE POLICY sistema_recrutamento_operacional ON public."SISTEMA_RECRUTAMENTO"
--   FOR ALL TO authenticated
--   USING (
--     (has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'::app_acao)
--      OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'visualizar'::app_acao))
--     AND ((NOT administrativa) OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao))
--   )
--   WITH CHECK (
--     (has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'alterar'::app_acao)
--      OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'aprovar'::app_acao))
--     AND ((NOT administrativa) OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao))
--   );
--
-- DELETE FROM public.app_menu_acao WHERE menu_codigo IN ('recrutamento_solicitacao_editar','recrutamento_solicitacao_excluir');
-- DELETE FROM public.app_menu       WHERE codigo      IN ('recrutamento_solicitacao_editar','recrutamento_solicitacao_excluir');
-- NOTIFY pgrst, 'reload schema';
