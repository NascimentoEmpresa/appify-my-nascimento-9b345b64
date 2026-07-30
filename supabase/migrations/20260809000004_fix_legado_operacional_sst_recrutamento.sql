-- Fix descoberto testando o Lote 8c: os perfis "Legado: operacional" e
-- "Legado: sst" (criados no backfill da Fase 1) nunca cobriram as telas reais
-- de recrutamento_gestao/sst_aso — "Legado: operacional" tinha uma permissão
-- pro menu_codigo "recrutamento" (código antigo/inexistente, não
-- "recrutamento_gestao", o código real criado depois em
-- 20260717190008_hotfix_recrutamento_sst_encarregados_catalogo.sql), e
-- "Legado: sst" não tinha nenhuma linha para sst_aso. Isso nunca deu problema
-- porque Recrutamento.tsx/AsoCandidatos.tsx ainda checavam cargo direto — ao
-- migrar essas telas pra can_access (Lote 8c), o buraco apareceu.
--
-- ROLLBACK:
--   DELETE FROM perfil_acesso_permissao WHERE perfil_id = '8401a74e-d2ab-4536-a717-e6450d09634c' AND menu_codigo = 'recrutamento_gestao';
--   DELETE FROM perfil_acesso_permissao WHERE perfil_id = '7578a7c7-4301-48f3-b4e5-60d153c7e153' AND menu_codigo = 'sst_aso';

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT '8401a74e-d2ab-4536-a717-e6450d09634c', 'recrutamento_gestao', 'visualizar', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.perfil_acesso_permissao
  WHERE perfil_id = '8401a74e-d2ab-4536-a717-e6450d09634c' AND menu_codigo = 'recrutamento_gestao' AND acao = 'visualizar'
);

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT '8401a74e-d2ab-4536-a717-e6450d09634c', 'recrutamento_gestao', 'aprovar', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.perfil_acesso_permissao
  WHERE perfil_id = '8401a74e-d2ab-4536-a717-e6450d09634c' AND menu_codigo = 'recrutamento_gestao' AND acao = 'aprovar'
);

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT '7578a7c7-4301-48f3-b4e5-60d153c7e153', 'sst_aso', 'visualizar', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.perfil_acesso_permissao
  WHERE perfil_id = '7578a7c7-4301-48f3-b4e5-60d153c7e153' AND menu_codigo = 'sst_aso' AND acao = 'visualizar'
);

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT '7578a7c7-4301-48f3-b4e5-60d153c7e153', 'sst_aso', 'alterar', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.perfil_acesso_permissao
  WHERE perfil_id = '7578a7c7-4301-48f3-b4e5-60d153c7e153' AND menu_codigo = 'sst_aso' AND acao = 'alterar'
);
