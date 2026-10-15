-- SIS-2026-0657 (complemento): a conciliação bancária passa a guardar os TOTAIS do extrato (entradas e saídas).
--
-- PROBLEMA: a conciliação salva só gravava as linhas que a pessoa resolveu na mão (ajustar/criar/ignorar). As que
-- bateram sozinhas não eram gravadas. Numa conciliação em que tudo bateu (caso de setembro) não sobrava nenhuma linha
-- nem total — e o card 2 da Auditoria da Controladoria enxergava "extrato = R$ 0,00".
--
-- SOLUÇÃO:
--   BLOCO 1: duas colunas no cabeçalho (extrato_entradas, extrato_saidas), preenchidas pela tela de conciliação a partir
--            de agora (soma das transações do OFX dentro do período, igual ao que a conciliação compara).
--   BLOCO 2: carga das 24 conciliações que já existiam, recalculadas dos arquivos OFX que elas guardaram no storage,
--            usando o MESMO parser e o MESMO recorte de período da tela (parseOFX + transacoesNoPeriodo). Só preenche
--            quando a coluna ainda está vazia (não sobrescreve nada).
--
-- Migrations não se auto-aplicam: rodar no SQL Editor, um bloco por vez. Leves.

-- BLOCO 1
ALTER TABLE public.financeiro_conciliacao_fluxo_caixa
  ADD COLUMN IF NOT EXISTS extrato_entradas numeric,
  ADD COLUMN IF NOT EXISTS extrato_saidas numeric;

COMMENT ON COLUMN public.financeiro_conciliacao_fluxo_caixa.extrato_entradas IS
  'SIS-2026-0657: soma das ENTRADAS do extrato (OFX) dentro do período da conciliação.';
COMMENT ON COLUMN public.financeiro_conciliacao_fluxo_caixa.extrato_saidas IS
  'SIS-2026-0657: soma das SAÍDAS do extrato (OFX) dentro do período da conciliação.';

-- BLOCO 2 (carga das conciliações já salvas; valores recalculados dos OFX guardados)
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 87250.00, extrato_saidas = 87330.06 WHERE id = '16546a81-5233-43a8-82ab-e65ee85c67ec' AND extrato_entradas IS NULL; -- BANRI AGPS.ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 263674.34, extrato_saidas = 171989.48 WHERE id = 'f94a6304-b49c-4c62-ab5d-f15b8dfbd02e' AND extrato_entradas IS NULL; -- BANRI CANAA.ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 1000.00, extrato_saidas = 1265.95 WHERE id = 'a3fdf456-5a45-42fe-84b4-af489c9eddfd' AND extrato_entradas IS NULL; -- BANRI LF.ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 5092148.03, extrato_saidas = 5093197.79 WHERE id = '49434748-bead-42b4-a8fc-e2938e779b09' AND extrato_entradas IS NULL; -- BANRI SN.ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 8709206.64, extrato_saidas = 8709607.00 WHERE id = '6c325569-9446-4a42-89e1-ba159eecf871' AND extrato_entradas IS NULL; -- BANRI HAGG.ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 96996.20, extrato_saidas = 97475.42 WHERE id = 'd1e89fb2-c78f-48d5-919e-8bb17504e81e' AND extrato_entradas IS NULL; -- BANRI NH.ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 0.23, extrato_saidas = 177.05 WHERE id = 'd79666e1-7ffc-4a76-89e2-a9da6f7d54a4' AND extrato_entradas IS NULL; -- BRADESCO SN.OFX
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 0.23, extrato_saidas = 177.05 WHERE id = '5027f62e-1ff8-494d-82ca-5b9073655dbf' AND extrato_entradas IS NULL; -- BRADESCO SN.OFX
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 3561268.00, extrato_saidas = 3554937.61 WHERE id = '47ddb5e8-8880-4065-9e3e-6bd21817b091' AND extrato_entradas IS NULL; -- BB SN.ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 11742490.09, extrato_saidas = 11770167.51 WHERE id = '92a34872-b777-4a3b-871c-7ee5ef5259d0' AND extrato_entradas IS NULL; -- SICREDI 119.ofx, SICREDI 155.ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 19995.37, extrato_saidas = 19995.37 WHERE id = '6d7ad8c0-8946-43c8-ab8e-745f43fcb146' AND extrato_entradas IS NULL; -- MENTORE CANAA.ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 2446758.49, extrato_saidas = 2446758.49 WHERE id = 'c9806619-223e-472f-a695-fee50003460c' AND extrato_entradas IS NULL; -- MENTORE HAGG.ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 103763.00, extrato_saidas = 103763.00 WHERE id = '99a7c627-8f56-4625-a9a0-1ff26ebb869b' AND extrato_entradas IS NULL; -- MENTORE NH.ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 600559.03, extrato_saidas = 600559.03 WHERE id = '579b935f-8efd-435c-a22c-9009f8c3222e' AND extrato_entradas IS NULL; -- MENTORE SN.ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 162050.00, extrato_saidas = 162025.86 WHERE id = 'e9aec0a4-c4d6-4ff4-88cf-c02a8047ec6b' AND extrato_entradas IS NULL; -- BANRI AGPS.ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 3250.00, extrato_saidas = 95117.35 WHERE id = '8947e34a-4f36-4d2e-93ae-bc66a619bcbf' AND extrato_entradas IS NULL; -- BANRI CANAA..ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 0.00, extrato_saidas = 95.00 WHERE id = '6d68e14b-d695-4ff5-8a6d-ae8720ce8edf' AND extrato_entradas IS NULL; -- BANRI LF.ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 213316.20, extrato_saidas = 213557.75 WHERE id = '6c484c84-79fc-4c6f-80ad-d9d4f3db9bd0' AND extrato_entradas IS NULL; -- BANRI NH.ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 99148.54, extrato_saidas = 98864.22 WHERE id = 'e669e707-2a7f-4d97-b852-5c338890bb5e' AND extrato_entradas IS NULL; -- AGPS BANRI.ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 0.00, extrato_saidas = 121.61 WHERE id = '543a0b3a-5bcd-4221-b3d8-6cd098e459aa' AND extrato_entradas IS NULL; -- Extrato_20261013.ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 0.00, extrato_saidas = 95.21 WHERE id = 'e74bc62f-c8a5-4be5-9cc7-0e20389553b8' AND extrato_entradas IS NULL; -- LF BANRI.ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 8709206.64, extrato_saidas = 8709607.00 WHERE id = 'f0d6251d-f739-4556-925e-77e3f3fa544f' AND extrato_entradas IS NULL; -- BANRI HAGG.ofx
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 195001.34, extrato_saidas = 193036.41 WHERE id = 'e6710cba-aba8-4187-bab5-37efa889f814' AND extrato_entradas IS NULL; -- BRADESCO HAGG.OFX
UPDATE public.financeiro_conciliacao_fluxo_caixa SET extrato_entradas = 500.00, extrato_saidas = 377.27 WHERE id = 'f4688f37-b588-4891-ba97-833f12bb3935' AND extrato_entradas IS NULL; -- CAIXA SN.ofx

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   ALTER TABLE public.financeiro_conciliacao_fluxo_caixa DROP COLUMN IF EXISTS extrato_entradas, DROP COLUMN IF EXISTS extrato_saidas;
--   NOTIFY pgrst, 'reload schema';
