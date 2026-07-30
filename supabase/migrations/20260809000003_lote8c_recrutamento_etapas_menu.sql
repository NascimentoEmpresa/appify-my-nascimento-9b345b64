-- Lote 8c: Recrutamento.tsx tinha 3 checagens de cargo bem específicas dentro
-- do kanban de candidatos — só quem tem cargo 'juridico' move um candidato pra
-- fora da etapa JURÍDICO, só 'sst' move EXAME SST, só 'comprador'/'almoxarife'
-- move COMPRAS. O acao enum (visualizar/incluir/alterar/excluir/aprovar/
-- exportar/executar_ia/alterar_dre) não distingue "esta ação só nesta etapa",
-- então cada etapa ganha seu próprio menu_codigo dentro do módulo
-- 'recrutamento' — dá pra atribuir cada um isoladamente em Acesso por Usuário,
-- preservando o comportamento de hoje (cada área só mexe na etapa dela).
--
-- Nota: a RLS de WA_CURRICULOS (20260717190008) já é um OR amplo entre
-- recrutamento_gestao/sst_aso/candidatos pra QUALQUER escrita na tabela — a
-- restrição por etapa nunca foi uma barreira de banco, sempre foi só regra de
-- UI (podeMoverCand). Isso não muda aqui; os 3 menus novos só reformulam essa
-- MESMA regra de UI pra não depender mais de cargo.
--
-- ROLLBACK: DELETE FROM app_menu WHERE codigo IN
--   ('recrutamento_etapa_juridico','recrutamento_etapa_sst','recrutamento_etapa_compras');

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, NULL, x.ordem, true
FROM public.app_modulo m, (VALUES
  ('recrutamento', 'recrutamento_etapa_juridico', 'Recrutamento — mover etapa Jurídico', 20),
  ('recrutamento', 'recrutamento_etapa_sst',      'Recrutamento — mover etapa SST',      21),
  ('recrutamento', 'recrutamento_etapa_compras',  'Recrutamento — mover etapa Compras',  22)
) AS x(modulo_codigo, codigo, nome, ordem)
WHERE m.codigo = x.modulo_codigo
ON CONFLICT (modulo_id, codigo) DO NOTHING;

NOTIFY pgrst, 'reload schema';
