-- =========================================================================
-- TV's — sai de dentro de Sistemas e vira MÓDULO PRÓPRIO (07/10/2026)
--
-- PEDIDO (Pablo): "não tá aparecendo o módulo TV nem no gerenciamento de
-- acesso". O menu sistemas_tvs (mig 20261007000012) existia, mas como item
-- de Sistemas (Sistemas › Gestão do ERP › TV's) — procurado como módulo, não
-- aparecia. Mesmo arranjo dos Relatórios (mig 20261007000010):
--   · app_modulo 'tvs' (TV's), logo depois de Sistemas;
--   · o menu MUDA DE MÓDULO mantendo código (sistemas_tvs) e rota
--     (/app/sistemas/tvs) — as liberações (por código) continuam valendo e a
--     tela publicada não perde a rota em momento nenhum.
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

INSERT INTO public.app_modulo (codigo, nome, descricao, icone, ordem, ativo)
VALUES ('tvs', 'TV''s', 'TVs da empresa: conexão, playlists, relatórios e avisos', 'MonitorPlay', 126, true)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, descricao = EXCLUDED.descricao, icone = EXCLUDED.icone, ativo = true;

UPDATE public.app_menu
   SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'tvs'), nome = 'TV''s — Gestão das TVs', ordem = 1
 WHERE codigo = 'sistemas_tvs'
   AND modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'sistemas');

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- UPDATE app_menu SET modulo_id = (SELECT id FROM app_modulo WHERE codigo = 'sistemas'), nome = 'TV''s', ordem = 60 WHERE codigo = 'sistemas_tvs';
-- DELETE FROM app_modulo WHERE codigo = 'tvs';
