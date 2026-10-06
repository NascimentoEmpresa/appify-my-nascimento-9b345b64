-- SIS-2026-0612 — Plano de Ações: reatribuir o comitê das linhas "Reunião"
--
-- Contexto: o filtro de Comitê da tela /app/plano-acoes passou a usar um
-- vocabulário FIXO de 6 comitês (Administrativo, Controladoria, Diretivo,
-- Operacional, Gestor, Sistemas — ver COMITES_FILTRO em src/types/planoAcao.ts).
-- As formas longas ("Comitê Administrativo" etc.) colapsam no nome curto via
-- SINONIMOS em src/lib/chaveTextoPlanoAcao.ts, mas 21 ações estavam gravadas
-- com comitê = "Reunião Ordinária" / "Reunião Extraordinária", que não é
-- comitê nenhum — e cada uma pertence a um comitê DIFERENTE, então não dá pra
-- resolver por sinônimo de valor. A solicitante (Helena, presidência) indicou
-- o comitê correto de cada linha na planilha anexada ao chamado; este UPDATE
-- aplica esse de-para por id.
--
-- É migration de dados (não mexe em schema/função/policy). A guarda
-- `comite ILIKE 'reuni%'` torna o re-run idempotente: depois de aplicada, as
-- linhas não são mais "Reunião" e o UPDATE vira no-op; e protege contra
-- sobrescrever um comitê já corrigido à mão nesse meio-tempo.

-- 1) 12 linhas -> Operacional
UPDATE public.plano_acao SET comite = 'Operacional'
WHERE comite ILIKE 'reuni%' AND id IN (
  '904b1d2a-74b7-4c51-8e68-018224cbb4f3',
  '89e82077-576b-4f22-9258-411f4747b9bf',
  '24ad3b6d-0e99-42f9-b357-3bdb896d5354',
  'e442ea19-9a68-49af-b7bf-4bf87eb01841',
  'd8274dfd-47b3-4c41-ba9c-db4805e428fc',
  'e70d335e-737a-4a19-9574-94418dabe770',
  '05f3871d-5e99-4a24-80ec-5105732c04e0',
  '3fe18bf1-e566-490a-ae53-3be2d2db187f',
  '3bb5cc03-ad33-4f05-88a0-b46e4216ca3f',
  '0048ab75-7989-445d-bd6d-d9c04cff6425',
  '5aae7f0a-5b62-4943-a576-4482d0f788bd',
  '43ef5db2-bd5a-499a-9a62-6d04eae4d1c6'
);

-- 2) 3 linhas -> Diretivo
UPDATE public.plano_acao SET comite = 'Diretivo'
WHERE comite ILIKE 'reuni%' AND id IN (
  '1d1a86a9-dbb5-46d5-8d94-6e664da207cf',
  '61a40e14-7755-4a12-9440-3168cff8a4a4',
  'eb853af2-55e3-4c23-9089-990d7f237684'
);

-- 3) 3 linhas -> Sistemas
UPDATE public.plano_acao SET comite = 'Sistemas'
WHERE comite ILIKE 'reuni%' AND id IN (
  '6527d221-8d7d-4ba0-951e-1295d80a5068',
  '66c0a1cb-26fc-443f-b206-ad35b458fbe1',
  '0a32d8eb-d173-4dfd-afdf-669410601435'
);

-- 4) 2 linhas -> Controladoria
UPDATE public.plano_acao SET comite = 'Controladoria'
WHERE comite ILIKE 'reuni%' AND id IN (
  'acff6082-83d9-4d08-8a2d-4765b1abba2a',
  '8b2097eb-cd48-4ba2-8096-b455e5752918'
);

-- 5) 1 linha -> Administrativo
UPDATE public.plano_acao SET comite = 'Administrativo'
WHERE comite ILIKE 'reuni%' AND id = '259b3053-69e0-4f9a-9348-55d3ca1c43b7';

-- Conferência pós-aplicação (deve voltar 0 linhas):
--   SELECT id, comite FROM public.plano_acao WHERE comite ILIKE 'reuni%';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (restaura a grafia original exata de cada linha):
-- UPDATE public.plano_acao SET comite = 'Reunião Ordinária'    WHERE id = '904b1d2a-74b7-4c51-8e68-018224cbb4f3';
-- UPDATE public.plano_acao SET comite = 'Reunião Extraordinária' WHERE id = '89e82077-576b-4f22-9258-411f4747b9bf';
-- UPDATE public.plano_acao SET comite = 'Reunião Extraordinaria' WHERE id = '24ad3b6d-0e99-42f9-b357-3bdb896d5354';
-- UPDATE public.plano_acao SET comite = 'Reunião Extraordinária' WHERE id = 'e442ea19-9a68-49af-b7bf-4bf87eb01841';
-- UPDATE public.plano_acao SET comite = 'Reunião Extraordinária' WHERE id = '1d1a86a9-dbb5-46d5-8d94-6e664da207cf';
-- UPDATE public.plano_acao SET comite = 'Reunião Ordinária'    WHERE id = 'd8274dfd-47b3-4c41-ba9c-db4805e428fc';
-- UPDATE public.plano_acao SET comite = 'Reunião Extraordinaria' WHERE id = 'e70d335e-737a-4a19-9574-94418dabe770';
-- UPDATE public.plano_acao SET comite = 'Reunião Extraordinaria' WHERE id = '05f3871d-5e99-4a24-80ec-5105732c04e0';
-- UPDATE public.plano_acao SET comite = 'Reunião Extraordinaria' WHERE id = '3fe18bf1-e566-490a-ae53-3be2d2db187f';
-- UPDATE public.plano_acao SET comite = 'Reunião Extraordinária' WHERE id = '3bb5cc03-ad33-4f05-88a0-b46e4216ca3f';
-- UPDATE public.plano_acao SET comite = 'Reunião Extraordinária' WHERE id = '259b3053-69e0-4f9a-9348-55d3ca1c43b7';
-- UPDATE public.plano_acao SET comite = 'Reunião Extraordinaria' WHERE id = '0048ab75-7989-445d-bd6d-d9c04cff6425';
-- UPDATE public.plano_acao SET comite = 'Reunião Extraordinaria' WHERE id = '5aae7f0a-5b62-4943-a576-4482d0f788bd';
-- UPDATE public.plano_acao SET comite = 'Reunião Extraordinaria' WHERE id = '43ef5db2-bd5a-499a-9a62-6d04eae4d1c6';
-- UPDATE public.plano_acao SET comite = 'Reunião Extraordinária' WHERE id = '6527d221-8d7d-4ba0-951e-1295d80a5068';
-- UPDATE public.plano_acao SET comite = 'Reunião Extraordinária' WHERE id = '66c0a1cb-26fc-443f-b206-ad35b458fbe1';
-- UPDATE public.plano_acao SET comite = 'Reunião Extraordinária' WHERE id = '0a32d8eb-d173-4dfd-afdf-669410601435';
-- UPDATE public.plano_acao SET comite = 'Reunião Extraordinaria' WHERE id = 'acff6082-83d9-4d08-8a2d-4765b1abba2a';
-- UPDATE public.plano_acao SET comite = 'Reunião Extraordinaria' WHERE id = '61a40e14-7755-4a12-9440-3168cff8a4a4';
-- UPDATE public.plano_acao SET comite = 'Reunião Extraordinaria' WHERE id = 'eb853af2-55e3-4c23-9089-990d7f237684';
-- UPDATE public.plano_acao SET comite = 'Reunião Extraordinária' WHERE id = '8b2097eb-cd48-4ba2-8096-b455e5752918';
-- NOTIFY pgrst, 'reload schema';
-- ============================================================================
