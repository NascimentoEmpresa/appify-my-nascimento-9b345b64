-- ============================================================================
-- SIS-2026-0952 — glosas/multas pós-emissão que a importação gravou como "antes"
-- ============================================================================
-- O importador do Relatório de Serviços (scripts/importar-relatorio-servicos.mjs,
-- SIS-2026-0540) lia as colunas "antes" e "depois da emissão" da planilha (AA/AB
-- multas, AC/AD glosas, AE/AF outros) e SOMAVA as duas no campo "antes"
-- (nf_emissao_item.multas / glosas / outros_descontos). Os campos *_pos_emissao
-- só nasceram depois (SIS-2026-0609, 20261008000004), então tudo ficou como
-- desconto anterior à nota — a solicitante achou isso nas glosas da UFRGS.
--
-- Efeito real além do rótulo: "Valor Pendente de Recebimento" (Relatório Geral)
-- e o "a receber" do Faturamento só abatem descontos_pos_emissao_total, então
-- essas notas apareciam com ~R$ 97,9 mil de pendência que é glosa/multa.
-- Bruto e líquido NÃO mudam: as notas importadas são legadas (bruto/líquido
-- vieram prontos da planilha), e pós-emissão nunca reduz o líquido.
--
-- Fonte: planilha oficial "Relatório de serviços Grupo Nascimento 2026.xlsx"
-- (S:\Gestão Financeira\Faturamento contratos\Relatório de Serviços  2026),
-- conferida em 19/11/2026: 92 linhas com valor "depois da emissão", todas com
-- a coluna "antes" zerada. Cruzadas com o banco por nº NF + mês de competência
-- + contrato (a NF 22/jan existe em DMAE e em HUSM — vale a do DMAE):
--   - 90 itens ainda exatamente como a importação deixou → corrigidos aqui;
--   - 2 já ajustados à mão pela tela (NF 185 UFRGS Limpeza Geral, NF 1240
--     SEMAE) → ficam de fora sozinhos pela cerca abaixo.
-- Esperado: 90 itens, R$ 97.925,37 (multas R$ 7.748,56 + glosas R$ 90.176,81).
--
-- Cerca de estado: só move onde o item AINDA tem o valor da planilha no campo
-- "antes" e zero nos pós-emissão. Reexecutar não faz nada; nota ajustada pela
-- tela depois da importação não é atropelada.
--
-- O guard nf_emissao_guard_enviada recusa alterar nota concluída fora dos
-- campos de pagamento; usa a exceção estreita que já existe pra isso
-- (nf.recalculo_pos_emissao, criada em 20261008000004 e mantida em
-- 20261113200000), ligada só dentro desta transação.
--
-- Histórico: as notas importadas não têm created_by/updated_by, e
-- nf_emissao_historico.user_id é NOT NULL (default auth.uid(), nulo no
-- pgAdmin) → cai no usuário de quem aplicou a correção (João).
-- ============================================================================

SET lock_timeout = '5s';

CREATE TEMP TABLE _sis0952 (item_id uuid PRIMARY KEY, linha_planilha int, numero_nf text, multas_dep numeric(14,2), glosas_dep numeric(14,2)) ON COMMIT DROP;

INSERT INTO _sis0952 (item_id, linha_planilha, numero_nf, multas_dep, glosas_dep) VALUES
('8b476219-14c2-4293-9145-e954abef29c1', 63, '22', 1477.68, 0),
('aeec56cc-1679-48af-b394-4efb57d8a690', 195, '152', 0, 312.05),
('9283e03c-7620-451b-966c-b9b8710cf9a0', 229, '186', 0, 766.68),
('5cc8735e-fcd6-485d-bc5e-b8a5e0d6af6e', 238, '195', 0, 118.89),
('541beefa-fde2-409b-aab2-8f86613c8ad3', 251, '208', 0, 624.10),
('f23282c9-9c32-4e54-af6d-907a406a0001', 316, '248', 0, 981.66),
('f940191a-14fc-46cd-b276-096739d78f62', 327, '78', 1477.68, 0),
('481e4374-0115-4090-91fc-481d61e6e635', 498, '89', 1477.69, 0),
('a17ef722-c847-4aaa-934b-a082182fd41f', 503, '420', 0, 127.63),
('26944033-bc0e-4acd-bdc4-14f177b7457b', 504, '421', 0, 11265.90),
('bb30d4a2-9c78-4a61-abb1-5bbb773ddbfb', 505, '422', 0, 809.58),
('4c9b988c-9015-4321-8bf7-cc5d78af922f', 506, '423', 0, 1019.35),
('15b4f3ec-c6a7-4205-8c34-41da4f007ca5', 507, '424', 0, 493.34),
('b3d55489-b8ac-4d3e-9383-67efdaae9530', 513, '430', 0, 132.06),
('b7f7f168-837b-44f4-b58e-498d8cc34614', 514, '431', 0, 202.94),
('28a11c6d-367c-4594-a96a-39b7ed0b6c0b', 593, '495', 0, 689.37),
('4303287b-fb3a-420f-bd25-f6a9e46d7e34', 692, '117', 1660.70, 0),
('7cb7e442-fb66-42cd-8677-0ebd8a415d07', 697, '596', 0, 708.30),
('beb868b5-74bc-401e-811d-0c9f888750fa', 698, '597', 0, 1031.31),
('8494ec9f-4edc-45f3-86ca-012e01567f78', 700, '599', 0, 336.97),
('591b95c2-dd03-4833-845a-07015ba59950', 706, '602', 0, 289.30),
('3f404d1f-f7d0-4878-bb50-a21bf96829d5', 707, '603', 0, 232.00),
('4631a487-4158-49e8-bb03-8f801f8fd3a7', 708, '604', 0, 3097.98),
('55eb7452-89f9-4554-a7e9-e68d38a69560', 718, '614', 0, 118.85),
('f17a9511-ad6b-48d8-8c0d-b5a3e7fd2503', 748, '626', 0, 2996.03),
('9040f6b1-cef8-40f7-9f01-a228f31a78a0', 760, '638', 0, 144.65),
('63487623-a8e3-49f7-bee5-63fa7c494148', 762, '640', 0, 2924.78),
('f912c16b-0865-402d-8d7b-2fdac1085dbf', 861, '744', 0, 1148.52),
('860803bf-2e0f-42aa-9efc-5bbdcb0e0ede', 863, '746', 0, 375.00),
('926d7458-bdb5-4b48-b137-e3dea86c98f5', 869, '143', 1477.69, 0),
('cdea95f4-b41b-4708-8178-31e84880264d', 881, '768', 0, 969.68),
('b12371c9-0494-44c1-81ee-2a4574393dde', 887, '772', 0, 28.63),
('10fa4094-4ffe-4bbf-91a0-54690e412a76', 888, '773', 0, 28.63),
('3361cdc0-a791-4271-8578-19de255c5cd3', 889, '774', 0, 57.26),
('27b42a53-068d-4b10-95e7-faf6d728720d', 890, '775', 0, 1002.05),
('56b3ea41-310f-4400-9e7c-b52e4e1fc4b1', 891, '776', 0, 1044.67),
('d224960d-1d6d-4262-9bbb-4ed2ac9df18c', 892, '777', 0, 171.78),
('8a2c5129-04c6-4855-b813-e4346dc4007d', 893, '778', 0, 57.26),
('357ed143-7a19-481c-b312-ba93aae2d296', 894, '779', 0, 143.15),
('4f79c31b-8671-4dea-b407-eed904a601f2', 895, '780', 0, 28.63),
('7e2c4e04-0b5f-48e9-b06a-82be7829fcb6', 934, '802', 0, 1549.37),
('9de7a61d-bc0b-4efa-9988-b9f891a7122b', 989, '847', 0, 62.82),
('e1300507-18c9-472e-bf4d-74aa7d8a7539', 990, '848', 0, 31.41),
('bff05fe1-4d04-4ff4-8130-8a4ce026e9f9', 991, '849', 0, 219.87),
('e46bfa53-d14a-411f-aaff-fa9720d28f8d', 1047, '902', 0, 6461.35),
('ea9cfdc9-6328-4469-9ebe-e6178947263c', 1048, '903', 0, 39.59),
('4488ddbd-9b5f-40f1-b5b2-a4ade7768303', 1049, '904', 0, 424.31),
('8f81976f-8520-42ee-bc03-64212deb00b3', 1050, '905', 0, 126.72),
('ba35c27c-3ec1-4ff3-866f-94c080f730e7', 1051, '906', 0, 95.04),
('6b79b317-1d6c-4805-86f6-a9d638f5b723', 1052, '907', 0, 728.64),
('7e94fde7-66a3-440e-a745-e3cddf1f636c', 1053, '908', 0, 12131.15),
('200f254e-4ebb-4076-a418-3b764eeec590', 1054, '909', 0, 221.76),
('82777665-88b1-4b1e-86f8-7daaa91e5e59', 1055, '910', 0, 31.68),
('42a447a8-39a3-47a6-82dc-472f82c113b3', 1075, '930', 0, 1564.00),
('a6306bdf-1dac-4d7a-a8f8-aadf5d54b983', 1104, '955', 0, 230.96),
('20632fd4-b27e-4537-9415-d22c68c1436a', 1125, '962', 0, 266.26),
('8f3fb856-ed51-4068-8c1a-372ecab3ffde', 1126, '963', 0, 158.40),
('a462911d-65a1-4b31-ac7c-d908f8cb4b15', 1127, '964', 0, 728.64),
('4d1fb459-4fd3-4765-8859-f9c770950220', 1128, '965', 0, 11945.85),
('8a96708f-52dc-4090-9123-e40242421d3a', 1129, '966', 0, 221.76),
('9ea61aec-b407-4390-886b-bb3ef22fe536', 1130, '967', 0, 31.68),
('4f64170d-a4a1-4657-8cf7-503938b6c837', 1131, '968', 0, 57.26),
('0cdf1dcf-ad36-411f-b5e6-823c96e20291', 1132, '969', 0, 28.63),
('4fa7af9e-18b2-4920-958f-f5f1a265bc29', 1133, '970', 0, 57.26),
('ccb0c00a-bc78-46dd-b873-4137e5a08988', 1134, '971', 0, 944.79),
('5d69bd33-3541-4e91-9e5b-a83dfa693dba', 1135, '972', 0, 1060.78),
('903207ce-83ec-48d0-bce7-665838858bf6', 1136, '973', 0, 200.41),
('76885ed3-55ec-408b-b95d-e1da1b3a1046', 1137, '974', 0, 57.26),
('f195f554-c78c-4ca4-be2b-ee96253dba2c', 1138, '975', 0, 114.52),
('35306e6d-8bad-4284-af8b-b8c9ae297809', 1139, '976', 0, 57.26),
('0adca5aa-4343-4174-a922-977fd9fe6f4d', 1149, '980', 88.56, 0),
('6e8a9135-a32c-4f1e-b96b-c8ca07e84833', 1150, '981', 88.56, 0),
('8eef8b84-d921-4b5d-ad62-d4d49c08344a', 1163, '1015', 0, 596.43),
('311aac5f-aa04-460b-922c-6dbc2d7f1a4b', 1243, '1090', 0, 688.61),
('16e1f396-f723-4c5f-babb-af6db493a9f7', 1345, '1191', 0, 28.87),
('255fb202-2df3-405e-b327-2d2a5bae3a14', 1395, '1225', 0, 158.40),
('a3c30227-e4d9-43b7-8f56-6123b5e64b84', 1396, '1226', 0, 2248.99),
('3054d785-aec4-4ec9-9cf4-2f792eb11637', 1397, '1227', 0, 31.68),
('67b52a75-0035-4d8a-a895-78aacabbecf6', 1420, '1239', 0, 831.75),
('6aad18c3-8353-45b9-9945-371de9232550', 1467, '1279', 0, 134.48),
('397f5b05-88a9-4b8d-816d-57f459920146', 1476, '1286', 0, 346.41),
('d25d66da-0517-4b82-942c-d680dd04dd42', 1478, '1288', 0, 789.82),
('d54690c1-dd88-4d3e-a4ec-51cd83311793', 1479, '1289', 0, 343.77),
('4a934651-0574-4c84-b4d9-f47a06dc5acd', 1480, '1290', 0, 168.75),
('e543cdcb-d9fb-4029-9a2f-b77c887d725e', 1495, '1301', 0, 74.24),
('6a90e051-62c4-476a-a54b-0cea406b4c34', 1532, '1338', 0, 139.00),
('15b6180e-f52e-4f63-8c6f-5baecdbbc7f6', 1533, '1339', 0, 213.29),
('4cd4857a-bcd3-499e-84c9-eb612dd6eafd', 1534, '1340', 0, 28.63),
('cf26cf11-90db-4372-9a7a-4e69140e0bc2', 1542, '1347', 0, 2685.25),
('9b0a4c16-c27c-4d3b-bfb6-a212f5a08e9f', 1566, '1366', 0, 6340.03);

CREATE TEMP TABLE _sis0952_movidos (item_id uuid, nf_emissao_id uuid, linha_planilha int, multas_dep numeric(14,2), glosas_dep numeric(14,2)) ON COMMIT DROP;

DO $$
DECLARE
  v_itens int;
  v_total numeric;
BEGIN
  -- Liga a exceção do guard só dentro deste bloco (mesma transação, garantido
  -- mesmo se o pgAdmin rodar cada comando em transação própria).
  PERFORM set_config('nf.recalculo_pos_emissao', 'on', true);

  -- 1. Move antes → pós, só onde o item ainda está como a importação deixou.
  WITH movidos AS (
    UPDATE public.nf_emissao_item i
       SET multas = i.multas - c.multas_dep,
           glosas = i.glosas - c.glosas_dep,
           multas_pos_emissao = c.multas_dep,
           glosas_pos_emissao = c.glosas_dep
      FROM _sis0952 c
     WHERE i.id = c.item_id
       AND i.multas = c.multas_dep
       AND i.glosas = c.glosas_dep
       AND COALESCE(i.multas_pos_emissao, 0) = 0
       AND COALESCE(i.glosas_pos_emissao, 0) = 0
       AND COALESCE(i.outros_descontos_pos_emissao, 0) = 0
    RETURNING i.id AS item_id, i.nf_emissao_id, c.linha_planilha, c.multas_dep, c.glosas_dep
  )
  INSERT INTO _sis0952_movidos SELECT * FROM movidos;

  -- 2. Total pós-emissão do cabeçalho (é dele que sai o "a receber").
  UPDATE public.nf_emissao n
     SET descontos_pos_emissao_total = s.total
    FROM (
      SELECT it.nf_emissao_id,
             SUM(COALESCE(it.multas_pos_emissao, 0) + COALESCE(it.glosas_pos_emissao, 0) + COALESCE(it.outros_descontos_pos_emissao, 0)) AS total
        FROM public.nf_emissao_item it
       WHERE it.nf_emissao_id IN (SELECT nf_emissao_id FROM _sis0952_movidos)
       GROUP BY it.nf_emissao_id
    ) s
   WHERE n.id = s.nf_emissao_id;

  -- 3. Histórico da nota (só as que mudaram de fato).
  INSERT INTO public.nf_emissao_historico (nf_emissao_id, user_id, acao, detalhe, dados)
  SELECT m.nf_emissao_id,
         COALESCE(auth.uid(), n.updated_by, n.created_by, 'e2c4faf6-289e-4f80-a235-628c2d674f46'::uuid),
         'descontos_reclassificados_pos_emissao',
         'SIS-2026-0952: desconto da importação do Relatório de Serviços reclassificado para APÓS a emissão (planilha 2026, linha '
           || m.linha_planilha || '): '
           || CASE WHEN m.multas_dep > 0 THEN 'multas R$ ' || to_char(m.multas_dep, 'FM999G999G990D00') ELSE '' END
           || CASE WHEN m.multas_dep > 0 AND m.glosas_dep > 0 THEN ', ' ELSE '' END
           || CASE WHEN m.glosas_dep > 0 THEN 'glosas R$ ' || to_char(m.glosas_dep, 'FM999G999G990D00') ELSE '' END
           || '. Bruto e líquido não mudam.',
         jsonb_build_object('chamado', 'SIS-2026-0952', 'linha_planilha', m.linha_planilha,
                            'multas_movidas_para_pos_emissao', m.multas_dep,
                            'glosas_movidas_para_pos_emissao', m.glosas_dep)
    FROM _sis0952_movidos m
    JOIN public.nf_emissao n ON n.id = m.nf_emissao_id;

  SELECT count(*), COALESCE(SUM(multas_dep + glosas_dep), 0) INTO v_itens, v_total FROM _sis0952_movidos;
  RAISE NOTICE 'SIS-2026-0952: % itens reclassificados, R$ % movidos para pós-emissão (esperado na 1a execução: 90 / 97925.37).', v_itens, v_total;

  PERFORM set_config('nf.recalculo_pos_emissao', 'off', true);
END $$;

-- Aplicada à mão pelo pgAdmin: registra pra o aplicador do merge não reaplicar
-- (reaplicar seria inofensivo pela cerca de estado, mas fica o registro).
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261120180000', '20261120180000_sis_2026_0952_descontos_pos_emissao_importacao.sql')
ON CONFLICT DO NOTHING;

-- ROLLBACK (movimento inverso, mesma cerca — só desfaz o que ainda está como esta migration deixou):
--   SELECT set_config('nf.recalculo_pos_emissao', 'on', true);
--   UPDATE public.nf_emissao_item i
--      SET multas = i.multas + i.multas_pos_emissao, glosas = i.glosas + i.glosas_pos_emissao,
--          multas_pos_emissao = 0, glosas_pos_emissao = 0
--    WHERE i.nf_emissao_id IN (SELECT nf_emissao_id FROM public.nf_emissao_historico
--                               WHERE acao = 'descontos_reclassificados_pos_emissao');
--   UPDATE public.nf_emissao n SET descontos_pos_emissao_total = 0
--    WHERE n.id IN (SELECT nf_emissao_id FROM public.nf_emissao_historico
--                    WHERE acao = 'descontos_reclassificados_pos_emissao');
--   DELETE FROM public.nf_emissao_historico WHERE acao = 'descontos_reclassificados_pos_emissao';
--   SELECT set_config('nf.recalculo_pos_emissao', 'off', true);
