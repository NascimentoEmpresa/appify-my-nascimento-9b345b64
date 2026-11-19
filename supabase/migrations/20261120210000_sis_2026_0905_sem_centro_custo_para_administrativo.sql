-- SIS-2026-0905 (reaberto em 19/11/2026 pela Fernanda) — saídas do Fluxo de Caixa "sem centro de custo (—)" vão para o ADMINISTRATIVO da empresa
-- ============================================================================
-- Pedido: toda despesa sem centro de custo vira ADMINISTRATIVO - <empresa> (ex.: HAGG sem centro de custo → ADMINISTRATIVO - HAGG).
-- Decidido com o João na sessão (19/11/2026):
--   • correção PONTUAL do que já existe — nada de gatilho novo; daqui pra frente vale o que a 20261116180000 já faz (classificação administrativa
--     sem contrato recebe o ADMINISTRATIVO sozinha; classificação de contrato exige contrato na tela).
--   • só SAÍDAS, e só das origens que gravam o centro de custo: rateio do Malote e Débito Automático. Ficam de fora as entradas (recebimentos)
--     e a Conta Garantida (cheque especial). A importação histórica não entra: as linhas dela sem contrato vinculado já aparecem com o nome do
--     contrato da planilha (FARROUPILHA, ROSÁRIO DO SUL...), não com "—".
--   • o que dá pra identificar como do SÓCIO vai para o ADMINISTRATIVO SÓCIOS do sócio; o que é claramente de um contrato vai para o contrato.
--
-- Levantamento feito no banco em 19/11/2026 (o que aparecia com "—" no filtro Centro de Custo do Fluxo, só saídas):
--   Malote (13 linhas de rateio, todas HAGG, classificação do tipo "contrato" — as que a 20261116180000 não adivinhava de propósito):
--     DM-2026-0384 MANUTENÇÃO CARRO HELENA ............................. → ADMINISTRATIVO SÓCIOS - HELENA
--     DM-2026-1817, 2057, 2186 (materiais de construção), 2373 (carimbo),
--     2464, 2465, 2466, 2490 (ampliação do almoxarifado/pressurizador ADM),
--     2790 e 3024 (frota ADM), 3365 (cota sem contrato do rateio Senior) → ADMINISTRATIVO - HAGG
--     DM-2026-3023 MANUTENÇÃO HILUX CADU — NÃO MEXIDA: se for do sócio Carlos Eduardo, o ADMINISTRATIVO SÓCIOS dele é da NH e a despesa é
--       da HAGG (contrato de outra empresa; o próprio fluxo_caixa_trocar_contrato recusa). Fica para a Fernanda decidir.
--   Débito Automático (5):
--     SEM PARAR (HAGG ×2 / SN ×1) .......................... → ADMINISTRATIVO - HAGG / ADMINISTRATIVO - SN
--     SALARIO 09.26 UFRGS CARREGADORES (R$ 17.740,01) ...... → UFRGS - CARREGADORES - 095/2024
--     SALARIO UFGRS COPA E COZINHA (R$ 14.354,79) ........... → UFRGS - COPA E COZINHA - 025/2025
--
-- Cerca de estado: só grava onde o contrato AINDA está vazio (quem já corrigiu na mão não é sobrescrito) e só se o contrato de destino existir
-- na mesma empresa da linha. Cada troca deixa evento no histórico da despesa/débito, no mesmo texto do fluxo_caixa_trocar_contrato.
-- Os relatórios (Fluxo, Orçamento, Lucratividade) leem essas colunas, então passam a mostrar o centro de custo sem outra mudança.
--
-- Idempotente: reexecutar não acha mais linha vazia e não muda nada.
--
-- ROLLBACK (volta só o que esta migration preencheu, pelo evento que ela deixou):
--   UPDATE public.malote_despesa_rateio_linha SET contrato_id = NULL WHERE id IN (
--     '039caf42-2ce1-4654-a4bd-56396be695eb','c97a1b67-3e16-4c45-ac73-2d3da61fe654','d7f04075-78c2-438e-b862-767035483a5d',
--     'b959aff1-6b26-4119-b883-8b3ea935c7ea','8a48dd5e-1dd5-4d2f-817b-edd5b5c90da8','071588ca-5123-48e7-9dff-27c11aed1389',
--     'd63bfd39-48f7-492b-b43a-3ea687409c29','1947a15c-ed15-440f-be06-17af070f7f63','54d1931d-eb92-4b7d-a03d-b457d17180e3',
--     'ef977193-52b9-4d46-89a0-7daf2c0fab14','238eb19d-f417-45cb-b6e4-b4b6805f25e5','c22ba2bc-4039-48d3-ab67-d80a3fac8d0a',
--     'd72da7a4-f6c3-47e1-b1a3-8a2fa9d079b6');
--   -- (atenção: o gatilho malote_rateio_contrato_administrativo não age aqui — essas classificações são do tipo "contrato")
--   UPDATE public."DEBITO_AUTOMATICO" SET contrato_id = NULL WHERE id IN (
--     'b78d24fa-7cb3-4a0c-aaf8-7b4562808f81','3cba1570-72d4-43bd-96eb-0d5dc357c5c7','e2d8aab5-04e5-4c0c-a154-2e20391442bf',
--     '61af7130-11ad-4ae8-9d49-fc281a2cbf99','b830f50e-4e72-4863-b274-3e297cb8b47b');
--   DELETE FROM public.malote_despesa_evento WHERE descricao LIKE 'SIS-2026-0905:%';
--   DELETE FROM public."DEBITO_AUTOMATICO_EVENTO" WHERE descricao LIKE 'SIS-2026-0905:%';

SET lock_timeout = '5s';

CREATE TEMP TABLE _sis0905_alvo (
  origem text NOT NULL,          -- 'malote' (id = linha de rateio) | 'debito' (id = DEBITO_AUTOMATICO)
  id uuid NOT NULL,
  contrato_nome text NOT NULL    -- nome exato do contrato de destino, na mesma empresa da linha
) ON COMMIT DROP;

INSERT INTO _sis0905_alvo (origem, id, contrato_nome) VALUES
  ('malote', '039caf42-2ce1-4654-a4bd-56396be695eb', 'ADMINISTRATIVO SÓCIOS - HELENA'),  -- DM-2026-0384 carro Helena
  ('malote', 'c97a1b67-3e16-4c45-ac73-2d3da61fe654', 'ADMINISTRATIVO - HAGG'),           -- DM-2026-1817
  ('malote', 'd7f04075-78c2-438e-b862-767035483a5d', 'ADMINISTRATIVO - HAGG'),           -- DM-2026-1817
  ('malote', 'b959aff1-6b26-4119-b883-8b3ea935c7ea', 'ADMINISTRATIVO - HAGG'),           -- DM-2026-2057
  ('malote', '8a48dd5e-1dd5-4d2f-817b-edd5b5c90da8', 'ADMINISTRATIVO - HAGG'),           -- DM-2026-2186
  ('malote', '071588ca-5123-48e7-9dff-27c11aed1389', 'ADMINISTRATIVO - HAGG'),           -- DM-2026-2373
  ('malote', 'd63bfd39-48f7-492b-b43a-3ea687409c29', 'ADMINISTRATIVO - HAGG'),           -- DM-2026-2464
  ('malote', '1947a15c-ed15-440f-be06-17af070f7f63', 'ADMINISTRATIVO - HAGG'),           -- DM-2026-2465
  ('malote', '54d1931d-eb92-4b7d-a03d-b457d17180e3', 'ADMINISTRATIVO - HAGG'),           -- DM-2026-2466
  ('malote', 'ef977193-52b9-4d46-89a0-7daf2c0fab14', 'ADMINISTRATIVO - HAGG'),           -- DM-2026-2490
  ('malote', '238eb19d-f417-45cb-b6e4-b4b6805f25e5', 'ADMINISTRATIVO - HAGG'),           -- DM-2026-2790
  ('malote', 'c22ba2bc-4039-48d3-ab67-d80a3fac8d0a', 'ADMINISTRATIVO - HAGG'),           -- DM-2026-3024
  ('malote', 'd72da7a4-f6c3-47e1-b1a3-8a2fa9d079b6', 'ADMINISTRATIVO - HAGG'),           -- DM-2026-3365 (cota Senior)
  ('debito', 'b78d24fa-7cb3-4a0c-aaf8-7b4562808f81', 'ADMINISTRATIVO - SN'),             -- SEM PARAR
  ('debito', '3cba1570-72d4-43bd-96eb-0d5dc357c5c7', 'ADMINISTRATIVO - HAGG'),           -- SEM PARAR
  ('debito', 'e2d8aab5-04e5-4c0c-a154-2e20391442bf', 'ADMINISTRATIVO - HAGG'),           -- SEM PARAR
  ('debito', '61af7130-11ad-4ae8-9d49-fc281a2cbf99', 'UFRGS - CARREGADORES - 095/2024'), -- salário UFRGS carregadores
  ('debito', 'b830f50e-4e72-4863-b274-3e297cb8b47b', 'UFRGS - COPA E COZINHA - 025/2025'); -- salário UFRGS copa e cozinha

DO $$
DECLARE
  v_malote integer;
  v_debito integer;
  v_valor numeric := 0;
  v_parcial numeric;
BEGIN
  -- Malote: linha de rateio ainda sem contrato → contrato de destino da MESMA empresa da linha
  WITH alvo AS (
    SELECT rl.id AS linha_id, rl.despesa_id, rl.valor, c.id AS contrato_id, c.nome AS contrato_nome
      FROM _sis0905_alvo a
      JOIN public.malote_despesa_rateio_linha rl ON rl.id = a.id
      JOIN public.malote_despesa d ON d.id = rl.despesa_id AND d.deleted_at IS NULL
      JOIN public.contratos c ON c.empresa_id = COALESCE(rl.empresa_id, d.empresa_id) AND c.nome = a.contrato_nome
     WHERE a.origem = 'malote' AND rl.contrato_id IS NULL
  ), atualiza AS (
    UPDATE public.malote_despesa_rateio_linha rl SET contrato_id = alvo.contrato_id
      FROM alvo WHERE rl.id = alvo.linha_id
    RETURNING alvo.despesa_id, alvo.valor, alvo.contrato_nome
  ), evento AS (
    INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, nivel, ator_user_id)
    SELECT despesa_id, 'edicao',
           format('SIS-2026-0905: centro de custo da linha de rateio (R$ %s) preenchido: "(sem contrato)" → "%s". Correção em lote das despesas que chegavam ao Fluxo de Caixa sem centro de custo.',
                  to_char(valor, 'FM999G999G990D00'), contrato_nome),
           NULL, auth.uid()
      FROM atualiza
    RETURNING 1
  )
  SELECT count(*), COALESCE(sum(valor), 0) INTO v_malote, v_parcial FROM atualiza;
  v_valor := v_valor + v_parcial;

  -- Débito Automático: débito ainda sem contrato → contrato de destino da MESMA empresa
  WITH alvo AS (
    SELECT da.id, da.valor, c.id AS contrato_id, c.nome AS contrato_nome
      FROM _sis0905_alvo a
      JOIN public."DEBITO_AUTOMATICO" da ON da.id = a.id AND da.deleted_at IS NULL
      JOIN public.contratos c ON c.empresa_id = da.empresa_id AND c.nome = a.contrato_nome
     WHERE a.origem = 'debito' AND da.contrato_id IS NULL
  ), atualiza AS (
    UPDATE public."DEBITO_AUTOMATICO" da SET contrato_id = alvo.contrato_id
      FROM alvo WHERE da.id = alvo.id
    RETURNING da.id, alvo.valor, alvo.contrato_nome
  ), evento AS (
    INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
    SELECT id, 'edicao', auth.uid(),
           format('SIS-2026-0905: centro de custo preenchido: "(sem contrato)" → "%s". Correção em lote das saídas que chegavam ao Fluxo de Caixa sem centro de custo.', contrato_nome)
      FROM atualiza
    RETURNING 1
  )
  SELECT count(*), COALESCE(sum(valor), 0) INTO v_debito, v_parcial FROM atualiza;
  v_valor := v_valor + v_parcial;

  RAISE NOTICE 'SIS-2026-0905: % linha(s) de rateio do Malote e % débito(s) automático(s) com centro de custo preenchido (R$ %). Esperado na 1ª execução: 13 e 5.',
    v_malote, v_debito, round(v_valor, 2);
END $$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261120210000', 'sis_2026_0905_sem_centro_custo_para_administrativo')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
