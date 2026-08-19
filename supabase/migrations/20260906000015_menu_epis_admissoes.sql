-- =========================================================================
-- SUPRIMENTOS — menu "EPIs — Admissoes"
--
-- Tela onde o COMPRAS aprova os materiais/EPIs do candidato em admissao,
-- espelhando a do SST (sst_aso). Precisa de menu proprio porque o controle
-- de acesso e por menu: quem entra aqui e o Compras, nao o RH.
--
-- O toggle de Acesso por Usuario libera as acoes de trabalho junto com a
-- tela (ver ACOES_POR_MENU no ModulosMenusTab): sem `alterar`, a pessoa
-- abriria a fila e nao conseguiria aprovar nada — o mesmo sintoma que
-- Patrimonio teve em 17/08/2026.
--
-- Idempotente.
-- ROLLBACK: DELETE FROM public.app_menu WHERE codigo = 'sup_epis_admissao';
-- =========================================================================

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sup_epis_admissao', 'EPIs — Admissões', '/app/suprimentos/epis-admissoes',
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 10,
       true
  FROM public.app_modulo m
 WHERE m.codigo = 'suprimentos'
ON CONFLICT (modulo_id, codigo) DO UPDATE
   SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

NOTIFY pgrst, 'reload schema';
