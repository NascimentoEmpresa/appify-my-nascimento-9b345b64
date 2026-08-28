-- =====================================================================
-- CHAMADOS DE SISTEMAS — abrir chamado volta a ser decidido pela
-- capacidade `chamados_sistemas_abrir`, como todo o resto do ERP.
--
-- O QUE ESTA MIGRATION DESFAZ
--
--   A 20260930000013 ("quem alcança a tela pode abrir") reescreveu
--   `chamado_pode_abrir()` para olhar o acesso às TELAS do módulo
--   (central_servicos_chamados / chamados_sistemas / encarregados_chamados)
--   em vez da capacidade. Ela já foi aplicada no banco do app e já está na
--   `main` (PR #460), então a correção vem como migration nova — migration
--   mergeada é append-only (R4), mesmo quando o que ela fez estava errado.
--
-- POR QUE DESFAZER
--
--   Aquilo criou um SEGUNDO lugar onde acesso é decidido: uma lista de
--   menus embutida no corpo da função (e no useChamadoPerms). Neste ERP
--   acesso é 100% por usuário, gerido em Administração › Acesso por
--   Usuário — quem administra desliga o toggle da pessoa e espera que isso
--   valha. Com a regra por tela, desligar `chamados_sistemas_abrir` não
--   surtia efeito nenhum: a pessoa continuava abrindo chamado por ter a
--   tela. Toggle que não desliga nada é pior do que toggle nenhum, e a
--   regra ficava invisível para quem administra — só lendo o SQL dava para
--   saber quem podia abrir chamado.
--
--   O sintoma que originou aquela mudança (gente com a tela liberada e sem
--   o botão) tem solução dentro do padrão, e ela já existe: a
--   20260901000007 concede `chamados_sistemas_abrir` a todos os perfis
--   ativos, mais override para quem não tem perfil. Quem ficar de fora se
--   resolve na tela de Acesso por Usuário, ou reexecutando aquela migration
--   (é idempotente) — não mexendo na regra.
--
-- RESULTADO: a definição volta a ser exatamente a de 20260802000002.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.chamado_pode_abrir()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.tem_acesso_menu('chamados_sistemas_abrir')
      OR NOT EXISTS (SELECT 1 FROM public.list_configured_menu_codes()
                     WHERE menu_codigo = 'chamados_sistemas_abrir');
$$;
-- `anon` explícito: REVOKE FROM PUBLIC não alcança o grant que o papel
-- carrega por si, e função SECURITY DEFINER exposta a anon é RPC aberta.
REVOKE ALL ON FUNCTION public.chamado_pode_abrir() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_pode_abrir() TO authenticated;

-- Rótulo de volta ao original: a liberação individual VOLTA a ser o que
-- decide, então a tela de acesso não pode dizer que já está liberada.
UPDATE public.app_menu
   SET nome = 'Chamados — Abrir chamado (solicitar)'
 WHERE codigo = 'chamados_sistemas_abrir';

NOTIFY pgrst, 'reload schema';

-- Conferência: quantos voltam a ficar sem o botão. Se o número surpreender,
-- o caminho é a tela de Acesso por Usuário (ou reexecutar a 20260901000007),
-- nunca mexer nesta função.
SELECT count(*) FILTER (WHERE NOT pode) AS usuarios_sem_abrir,
       count(*)                         AS total
  FROM (
    SELECT COALESCE(
             (SELECT s.allow FROM public.screen_permission_user s
               WHERE s.user_id = p.id AND s.menu_codigo = 'chamados_sistemas_abrir'
                 AND s.acao = 'visualizar'::public.app_acao
               ORDER BY s.updated_at DESC LIMIT 1),
             EXISTS (SELECT 1 FROM public.usuario_perfil_acesso upa
                       JOIN public.perfil_acesso pf ON pf.id = upa.perfil_id AND pf.ativo
                      WHERE upa.user_id = p.id AND pf.concede_tudo)
             OR EXISTS (SELECT 1 FROM public.usuario_perfil_acesso upa
                          JOIN public.perfil_acesso pf ON pf.id = upa.perfil_id AND pf.ativo
                          JOIN public.perfil_acesso_permissao pp
                            ON pp.perfil_id = pf.id AND pp.allow
                           AND pp.menu_codigo = 'chamados_sistemas_abrir'
                           AND pp.acao = 'visualizar'::public.app_acao
                         WHERE upa.user_id = p.id)
           ) AS pode
      FROM public.profiles p
  ) r;

-- =====================================================================
-- ROLLBACK (volta à regra por tela da 20260930000013)
--   CREATE OR REPLACE FUNCTION public.chamado_pode_abrir()
--   RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
--   SET search_path = public, pg_temp
--   AS $$
--     SELECT public.tem_acesso_menu('central_servicos_chamados')
--         OR public.tem_acesso_menu('chamados_sistemas')
--         OR public.tem_acesso_menu('encarregados_chamados')
--         OR public.chamado_sistema_gestor()
--         OR public.tem_acesso_menu('chamados_sistemas_abrir');
--   $$;
--   UPDATE public.app_menu
--      SET nome = 'Chamados — Abrir chamado (já liberado por quem vê a tela)'
--    WHERE codigo = 'chamados_sistemas_abrir';
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
