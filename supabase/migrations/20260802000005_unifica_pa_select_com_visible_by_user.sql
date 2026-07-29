-- Antes de garantir que as 3 opções de Visibilidade funcionam, reconferi a
-- pa_select linha por linha contra plano_acao_visible_by_user (a função já
-- corrigida, usada por UPDATE/anexo/comentário/histórico/visibilidade) e
-- achei mais uma divergência da mesma família dos bugs anteriores:
-- pa_select nunca considerou a hierarquia de líder/gestor de
-- setor-área-comitê (só visible_by_user tinha isso). Ou seja: um gestor de
-- setor conseguia EDITAR uma ação 'privado' do seu setor (via pa_update,
-- que usa visible_by_user), mas o UPDATE...RETURNING falharia do mesmo
-- jeito que o bug original, porque a checagem de SELECT (pa_select) não
-- reconhecia esse caso.
--
-- Em vez de corrigir esse gap manualmente também (e arriscar as duas
-- policies divergirem de novo no futuro), pa_select passa a chamar
-- diretamente plano_acao_visible_by_user — a MESMA função que já governa
-- UPDATE/anexo/comentário/histórico/visibilidade_usuario. Daqui pra frente
-- só existe UM lugar que decide "quem vê essa ação", eliminando de vez a
-- possibilidade de essas duas policies discordarem entre si.

DROP POLICY IF EXISTS pa_select ON public.plano_acao;
CREATE POLICY pa_select ON public.plano_acao
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.plano_acao_visible_by_user(auth.uid(), id)
  );
