-- =====================================================================
-- AGENDAMENTO DE VEÍCULOS — carga do histórico do sistema anterior
--
-- 96 das 123 reservas do sistema antigo. O que ficou de fora, e por quê,
-- está na seção "O QUE NÃO VEIO" no fim deste comentário.
--
-- DECISÕES
--
--   1. OS GATILHOS SÃO DESLIGADOS DURANTE A CARGA. O trigger de validação
--      recusa data no passado e choque de reserva — regras corretas para
--      quem agenda hoje, e erradas para histórico: todo o passado é passado,
--      e o legado tem conflitos reais (as linhas 106 e 107 são o mesmo Jeep
--      no mesmo dia). Histórico entra como foi, não como deveria ter sido.
--
--   2. NOME DO VEÍCULO É O DO CADASTRO ATUAL, não o do legado. O legado
--      chamava "JAC J6" o carro que hoje está cadastrado como "JBY-7G73"
--      (placa JBZ-4D93). Gravar o nome antigo faria o histórico divergir da
--      frota na mesma tela. O nome legado fica no campo observacoes.
--
--   3. CONTRATO SEM PAR ENTRA MESMO ASSIM. Só 24 dos 43 nomes de contrato
--      do legado existem em `contratos`. A tabela filha guarda contrato_nome
--      (obrigatório) e contrato_id (opcional) — foi desenhada para isso.
--      Os 19 sem par entram com o nome preservado e id nulo, em vez de
--      sumirem.
--
--   4. legado_id TORNA A CARGA REPETÍVEL. Coluna única: rodar de novo não
--      duplica (ON CONFLICT DO NOTHING) e o rollback é um DELETE por ela.
--
-- O QUE NÃO VEIO (27 linhas, decidido com o Pablo)
--   AFRANIO AMARAL FRANKE (19) e LUIZ ENRIQUE FALEIRO TEIXEIRA (8) não têm
--   login no ERP — procurei variações de grafia, não existem. Como
--   solicitante_id é NOT NULL e referencia auth.users, essas reservas não
--   têm como ser gravadas com dono verdadeiro, e inventar um dono seria
--   gravar mentira. Ficam de fora até os logins existirem; o CSV original
--   segue sendo a fonte se um dia entrarem.
--
-- ROLLBACK:
--   DELETE FROM public.cs_veiculo_agendamento WHERE legado_id IS NOT NULL;
--   ALTER TABLE public.cs_veiculo_agendamento DROP COLUMN legado_id;
-- =====================================================================

-- ── 1. Rastro da origem ──────────────────────────────────────────────
ALTER TABLE public.cs_veiculo_agendamento
  ADD COLUMN IF NOT EXISTS legado_id integer;

COMMENT ON COLUMN public.cs_veiculo_agendamento.legado_id IS
  'Id da reserva no sistema anterior. Nulo = nasceu aqui. Torna a carga repetível.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_cs_veic_legado_id
  ON public.cs_veiculo_agendamento(legado_id) WHERE legado_id IS NOT NULL;

-- ── 2. Área de trabalho com o CSV cru ────────────────────────────────
DROP TABLE IF EXISTS public.tmp_carga_veiculos_legado;
CREATE TABLE public.tmp_carga_veiculos_legado (
  legado_id     integer PRIMARY KEY,
  veiculo_nome  text,
  condutor_nome text,
  data          date,
  turno         text,
  contratos     jsonb,
  criado_em     timestamptz,
  cancelado     boolean
);

INSERT INTO public.tmp_carga_veiculos_legado
  (legado_id, veiculo_nome, condutor_nome, data, turno, contratos, criado_em, cancelado)
VALUES
  (6, 'MONTANA', 'DAIANE MARTINS DE SOUZA', '2026-05-12', 'dia_todo', '["CHARQUEADAS - 249/2020","CHARQUEADAS - 168/2021","CHARQUEADAS - 005.2021"]'::jsonb, '2026-05-12 11:02:50.487536+00', false),
  (7, 'JAC J6', 'PABLO FLORES SANTAREM', '2026-05-13', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-05-12 19:23:47.241181+00', true),
  (8, 'JAC J6', 'GUSTAVO GARCIA RONSANI', '2026-05-13', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-05-12 19:26:58.673939+00', false),
  (14, 'ONIX', 'STEFANE DE AZEVEDO SOUZA', '2026-05-15', 'dia_todo', '["PREF POA SMS RECEPÇÃO - 98672/2025","SEMAE - 3038/2020","SEC. DA CULTURA POA - PORTARIA - 88123","SAMU TELEFONISTAS - 96397/2025"]'::jsonb, '2026-05-15 11:23:17.645543+00', false),
  (17, 'Jeep Compass', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-05-19', 'dia_todo', '["GUAPORÉ LIMP SMED EMERGENCIAL - 063.2026"]'::jsonb, '2026-05-15 20:23:12.35948+00', false),
  (18, 'Jeep Compass', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-05-20', 'dia_todo', '["BENTO GONÇALVES - AUX ADM - 002/2021","BENTO GONÇALVES - LIMPEZA - 048.2026"]'::jsonb, '2026-05-15 20:24:00.025399+00', false),
  (19, 'Jeep Compass', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-05-21', 'dia_todo', '["CAXIAS DO SUL - 95.2026","VERANOPOLIS - 001/2021"]'::jsonb, '2026-05-15 20:24:46.849947+00', false),
  (20, 'JAC J6', 'GUSTAVO GARCIA RONSANI', '2026-05-20', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-05-19 16:24:47.664501+00', true),
  (21, 'ONIX', 'JOAO VITOR DA CUNHA CASTRO', '2026-05-20', 'dia_todo', '["UFRGS - CARREGADORES - 095/2024"]'::jsonb, '2026-05-19 16:49:28.855911+00', false),
  (22, 'MONTANA', 'GUSTAVO BARCELOS BRAGA', '2026-05-20', 'dia_todo', '["SEMAE - 3038/2020","PREF POA SMS RECEPÇÃO - 98672/2025","SAMU TELEFONISTAS - 96397/2025"]'::jsonb, '2026-05-19 20:04:44.031532+00', false),
  (26, 'Jeep Compass', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-05-25', 'dia_todo', '["HOSPITAL SÃO CAMILO - 50163.2025"]'::jsonb, '2026-05-22 20:16:10.272919+00', false),
  (27, 'JAC J6', 'PABLO FLORES SANTAREM', '2030-01-26', 'dia_todo', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-05-25 16:02:50.430695+00', false),
  (29, 'JAC J6', 'PABLO FLORES SANTAREM', '2026-05-28', 'dia_todo', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-05-25 16:53:51.700039+00', true),
  (30, 'JAC J6', 'PABLO FLORES SANTAREM', '2026-05-28', 'dia_todo', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-05-25 17:38:04.568429+00', true),
  (31, 'Jeep Compass', 'GUSTAVO GARCIA RONSANI', '2026-05-27', 'dia_todo', '["ADM E ESTAGIARIOS - NH"]'::jsonb, '2026-05-26 16:23:56.022147+00', false),
  (32, 'Jeep Compass', 'GUSTAVO GARCIA RONSANI', '2026-05-26', 'tarde', '["ADM E ESTAGIARIOS - NH"]'::jsonb, '2026-05-26 16:39:33.98443+00', false),
  (34, 'Jeep Compass', 'PABLO FLORES SANTAREM', '2026-05-30', 'dia_todo', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-05-28 17:16:16.93238+00', true),
  (35, 'MONTANA', 'ISMAEL KUHL LOPES', '2026-06-02', 'dia_todo', '["UFRGS - AUX DE SAÚDE BUCAL - 033/2021","UFRGS - CARREGADORES - 095/2024","UFRGS - COPA E COZINHA - 025/2025","UFRGS - INTERPRETE DE LIBRAS - 009.2026","UFRGS - JARDINAGEM - 062/2025","UFRGS - LIMPEZA - 020/2022","UFRGS - LIMPEZA GERAL - 047/2022","UFRGS - MOTORISTAS - 034/2022","TJRS - 023/2025"]'::jsonb, '2026-06-01 14:32:48.507306+00', true),
  (36, 'ONIX', 'GUSTAVO GARCIA RONSANI', '2026-06-02', 'dia_todo', '["CAMARA DE RIO GRANDE-LIMPEZA - 001/2023"]'::jsonb, '2026-06-01 18:18:13.979264+00', false),
  (37, 'MONTANA', 'ISMAEL KUHL LOPES', '2026-06-03', 'dia_todo', '["TJRS - 023/2025","UFRGS - AUX DE SAÚDE BUCAL - 033/2021","UFRGS - CARREGADORES - 095/2024","UFRGS - COPA E COZINHA - 025/2025","UFRGS - INTERPRETE DE LIBRAS - 009.2026","UFRGS - JARDINAGEM - 062/2025","UFRGS - LIMPEZA - 020/2022","UFRGS - LIMPEZA GERAL - 047/2022","UFRGS - MOTORISTAS - 034/2022"]'::jsonb, '2026-06-01 18:27:28.256882+00', false),
  (38, 'KWID', 'DAIANE MARTINS DE SOUZA', '2026-06-02', 'dia_todo', '["CHARQUEADAS - 249/2020"]'::jsonb, '2026-06-02 11:19:59.452712+00', false),
  (39, 'KWID', 'DAIANE MARTINS DE SOUZA', '2026-06-03', 'tarde', '["TRIUNFO COLETA DE LIXO 89.2026"]'::jsonb, '2026-06-03 15:53:32.519539+00', false),
  (40, 'ONIX', 'GUSTAVO BARCELOS BRAGA', '2026-06-09', 'dia_todo', '["POLICIA CIVIL RS LIMPEZA 066.2026"]'::jsonb, '2026-06-08 13:59:40.889018+00', false),
  (41, 'ONIX', 'GUSTAVO GARCIA RONSANI', '2026-06-10', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-06-08 17:24:22.718707+00', false),
  (43, 'ONIX', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-06-18', 'dia_todo', '["BENTO GONÇALVES - LIMPEZA - 048.2026"]'::jsonb, '2026-06-08 19:52:00.225654+00', false),
  (45, 'MERCEDES', 'IURY DE JESUS SILVA', '2026-12-18', 'dia_todo', '["ADM E ESTAGIARIOS - NH"]'::jsonb, '2026-06-10 10:52:21.460654+00', false),
  (46, 'ONIX', 'GUSTAVO BARCELOS BRAGA', '2026-06-11', 'tarde', '["SEMAE - 3038/2020"]'::jsonb, '2026-06-11 15:24:49.246929+00', false),
  (48, 'ONIX', 'GUSTAVO BARCELOS BRAGA', '2026-06-15', 'dia_todo', '["POLICIA CIVIL RS LIMPEZA 066.2026","PREF POA SMS RECEPÇÃO - 98672/2025","SAMU TELEFONISTAS - 96397/2025"]'::jsonb, '2026-06-15 12:02:13.305079+00', false),
  (49, 'KWID', 'DAIANE MARTINS DE SOUZA', '2026-06-16', 'tarde', '["TRIUNFO VIGIAS - 33/2024"]'::jsonb, '2026-06-16 16:29:04.685282+00', false),
  (50, 'MONTANA', 'DAIANE MARTINS DE SOUZA', '2026-06-16', 'tarde', '["TRIUNFO VIGIAS - 33/2024"]'::jsonb, '2026-06-16 16:47:29.590438+00', false),
  (51, 'JAC J6', 'GUSTAVO GARCIA RONSANI', '2026-06-18', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-06-17 18:28:56.720341+00', false),
  (53, 'Jeep Compass', 'ISMAEL KUHL LOPES', '2026-06-23', 'dia_todo', '["LIMPEZA HUSM"]'::jsonb, '2026-06-22 14:51:47.750557+00', false),
  (54, 'ONIX', 'GUSTAVO GARCIA RONSANI', '2026-06-24', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-06-22 17:10:00.256696+00', false),
  (55, 'ONIX', 'GUSTAVO GARCIA RONSANI', '2026-06-25', 'dia_todo', '["TJRS - 023/2025"]'::jsonb, '2026-06-22 17:49:10.906661+00', false),
  (56, 'ONIX', 'DAIANE MARTINS DE SOUZA', '2026-06-23', 'tarde', '["TRIUNFO COLETA DE LIXO 89.2026"]'::jsonb, '2026-06-23 12:30:32.605306+00', false),
  (58, 'ONIX', 'ISADORA PRISCO SILVEIRA', '2026-06-29', 'manha', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-06-29 12:05:53.933529+00', false),
  (61, 'ONIX', 'DAIANE MARTINS DE SOUZA', '2026-06-30', 'dia_todo', '["CHARQUEADAS - 249/2020","CHARQUEADAS - 168/2021","CHARQUEADAS - 005.2021"]'::jsonb, '2026-06-29 19:34:09.39621+00', false),
  (62, 'Jeep Compass', 'GUSTAVO BARCELOS BRAGA', '2026-06-30', 'manha', '["PREF POA SMS RECEPÇÃO - 98672/2025","SAMU TELEFONISTAS - 96397/2025","SEC. DA CULTURA POA - PORTARIA - 88123","HOSPITAL SÃO CAMILO - 50163.2025"]'::jsonb, '2026-06-30 09:55:56.548999+00', false),
  (65, 'JAC J6', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-07-02', 'dia_todo', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-07-01 17:26:15.937892+00', false),
  (66, 'Jeep Compass', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-07-08', 'dia_todo', '["BENTO GONÇALVES - AUX ADM - 002/2021","BENTO GONÇALVES - LIMPEZA - 048.2026"]'::jsonb, '2026-07-01 17:27:42.289218+00', true),
  (67, 'JAC J6', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-07-09', 'dia_todo', '["BENTO GONÇALVES - LIMPEZA - 048.2026","CAXIAS DO SUL - 95.2026"]'::jsonb, '2026-07-01 17:29:40.949573+00', true),
  (68, 'Jeep Compass', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-07-09', 'dia_todo', '["CAXIAS DO SUL - 95.2026"]'::jsonb, '2026-07-01 17:31:14.52333+00', false),
  (71, 'ONIX', 'ISADORA PRISCO SILVEIRA', '2026-07-02', 'tarde', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-07-02 16:34:59.915227+00', true),
  (72, 'ONIX', 'ISADORA PRISCO SILVEIRA', '2026-07-03', 'manha', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-07-02 16:38:21.196535+00', false),
  (73, 'Jeep Compass', 'ISMAEL KUHL LOPES', '2026-07-06', 'dia_todo', '["UFRGS - AUX DE SAÚDE BUCAL - 033/2021","UFRGS - CARREGADORES - 095/2024","UFRGS - COPA E COZINHA - 025/2025","UFRGS - INTERPRETE DE LIBRAS - 009.2026","UFRGS - JARDINAGEM - 062/2025","UFRGS - LIMPEZA - 020/2022","UFRGS - LIMPEZA GERAL - 047/2022","UFRGS - MOTORISTAS - 034/2022","UFRGS ALMOXARIFES","TJRS - 023/2025"]'::jsonb, '2026-07-03 16:14:17.646225+00', false),
  (74, 'Jeep Compass', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-07-07', 'dia_todo', '["BENTO GONÇALVES - AUX ADM - 002/2021","BENTO GONÇALVES - LIMPEZA - 048.2026"]'::jsonb, '2026-07-06 17:28:12.617779+00', false),
  (75, 'MONTANA', 'ISMAEL KUHL LOPES', '2026-07-08', 'dia_todo', '["DMAE - 895/0","UFRGS - AUX DE SAÚDE BUCAL - 033/2021"]'::jsonb, '2026-07-07 11:09:19.183094+00', false),
  (76, 'MONTANA', 'ISMAEL KUHL LOPES', '2026-07-07', 'dia_todo', '["UFRGS - MOTORISTAS - 034/2022","UFRGS - LIMPEZA GERAL - 047/2022","UFRGS - LIMPEZA - 020/2022","UFRGS - JARDINAGEM - 062/2025","UFRGS - INTERPRETE DE LIBRAS - 009.2026","UFRGS - COPA E COZINHA - 025/2025","UFRGS - CARREGADORES - 095/2024","TJRS - 023/2025"]'::jsonb, '2026-07-07 11:16:00.604498+00', false),
  (77, 'Jeep Compass', 'GUSTAVO GARCIA RONSANI', '2026-07-13', 'dia_todo', '["PREF POA SMS RECEPÇÃO - 98672/2025"]'::jsonb, '2026-07-07 12:09:53.029318+00', true),
  (78, 'KWID', 'ISADORA PRISCO SILVEIRA', '2026-07-07', 'tarde', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-07-07 14:29:32.623521+00', false),
  (79, 'MONTANA', 'DAIANE MARTINS DE SOUZA', '2026-07-09', 'dia_todo', '["CHARQUEADAS - 005.2021","CHARQUEADAS - 168/2021","CHARQUEADAS - 249/2020"]'::jsonb, '2026-07-08 11:59:28.606965+00', false),
  (80, 'KWID', 'DAISON TAVARES RODRIGUES', '2026-07-09', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022","UFRGS - LIMPEZA - 020/2022"]'::jsonb, '2026-07-08 11:59:42.002504+00', false),
  (81, 'MONTANA', 'DAISON TAVARES RODRIGUES', '2026-07-10', 'dia_todo', '["UFRGS - COPA E COZINHA - 025/2025"]'::jsonb, '2026-07-08 12:01:01.742374+00', false),
  (82, 'JAC J6', 'GUSTAVO GARCIA RONSANI', '2026-07-13', 'dia_todo', '["PREF POA SMS RECEPÇÃO - 98672/2025"]'::jsonb, '2026-07-08 12:25:24.04851+00', false),
  (83, 'Jeep Compass', 'GUSTAVO GARCIA RONSANI', '2026-07-10', 'dia_todo', '["UFRGS - AUX DE SAÚDE BUCAL - 033/2021"]'::jsonb, '2026-07-08 12:25:43.028161+00', false),
  (84, 'Jeep Compass', 'ISMAEL KUHL LOPES', '2026-07-14', 'dia_todo', '["UFFS CERRO LARGO - 041/2021"]'::jsonb, '2026-07-08 14:02:59.992218+00', false),
  (85, 'Jeep Compass', 'ISMAEL KUHL LOPES', '2026-07-15', 'dia_todo', '["UFFS CERRO LARGO - 041/2021"]'::jsonb, '2026-07-08 14:04:01.253659+00', false),
  (86, 'KWID', 'ISADORA PRISCO SILVEIRA', '2026-07-10', 'manha', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-07-10 13:58:36.16298+00', false),
  (87, 'JAC J6', 'GUSTAVO BARCELOS BRAGA', '2026-07-14', 'dia_todo', '["POLICIA CIVIL RS LIMPEZA 066.2026","PREF POA SMS RECEPÇÃO - 98672/2025","SAMU TELEFONISTAS - 96397/2025","SEMAE - 3038/2020"]'::jsonb, '2026-07-13 18:53:21.651102+00', false),
  (88, 'ONIX', 'DAISON TAVARES RODRIGUES', '2026-07-15', 'dia_todo', '["CAMARA DE RIO GRANDE-LIMPEZA - 001/2023","CAMARA DE RIO GRANDE-PORTARIA - 002/2023","EMBRAPA - 2021/93","FURG HU - 006/2023","FURG JARDINAGEM  - 049/2022","FURG PORTARIA - 055/2023"]'::jsonb, '2026-07-14 13:06:36.446545+00', false),
  (89, 'Jeep Compass', 'DICKSON SCHUBERT FLORES', '2026-07-22', 'dia_todo', '["CAXIAS DO SUL - 95.2026","BENTO GONÇALVES - AUX ADM - 002/2021","BENTO GONÇALVES - LIMPEZA - 048.2026"]'::jsonb, '2026-07-14 13:11:45.284178+00', true),
  (90, 'ONIX', 'DAISON TAVARES RODRIGUES', '2026-07-16', 'dia_todo', '["UFRGS - AUX DE SAÚDE BUCAL - 033/2021","UFRGS - CARREGADORES - 095/2024","UFRGS - COPA E COZINHA - 025/2025","UFRGS - INTERPRETE DE LIBRAS - 009.2026","UFRGS - JARDINAGEM - 062/2025","UFRGS - LIMPEZA - 020/2022","UFRGS - LIMPEZA GERAL - 047/2022","UFRGS - MOTORISTAS - 034/2022","UFRGS ALMOXARIFES"]'::jsonb, '2026-07-14 13:13:58.946789+00', false),
  (91, 'KWID', 'GUSTAVO GARCIA RONSANI', '2026-07-14', 'tarde', '["UFRGS - JARDINAGEM - 062/2025"]'::jsonb, '2026-07-14 13:55:08.358904+00', false),
  (94, 'KWID', 'DAIANE MARTINS DE SOUZA', '2026-07-15', 'dia_todo', '["CHARQUEADAS - 249/2020","CHARQUEADAS - 168/2021","CHARQUEADAS - 005.2021"]'::jsonb, '2026-07-14 18:38:05.884351+00', true),
  (95, 'MONTANA', 'DAIANE MARTINS DE SOUZA', '2026-07-16', 'dia_todo', '["CHARQUEADAS - 005.2021","CHARQUEADAS - 168/2021","CHARQUEADAS - 249/2020"]'::jsonb, '2026-07-15 11:15:51.296673+00', false),
  (97, 'Jeep Compass', 'CARLOS JOSE FERGUTZ NETO', '2026-07-16', 'dia_todo', '["UFRGS - AUX DE SAÚDE BUCAL - 033/2021","UFRGS - CARREGADORES - 095/2024","UFRGS - COPA E COZINHA - 025/2025","UFRGS - INTERPRETE DE LIBRAS - 009.2026","UFRGS - JARDINAGEM - 062/2025","UFRGS - LIMPEZA - 020/2022","UFRGS - LIMPEZA GERAL - 047/2022","UFRGS - MOTORISTAS - 034/2022","UFRGS ALMOXARIFES","TJRS - 023/2025"]'::jsonb, '2026-07-15 19:00:42.172682+00', false),
  (98, 'Jeep Compass', 'DICKSON SCHUBERT FLORES', '2026-07-23', 'dia_todo', '["VERANOPOLIS - 001/2021","BENTO GONÇALVES - AUX ADM - 002/2021","BENTO GONÇALVES - LIMPEZA - 048.2026"]'::jsonb, '2026-07-16 18:35:34.000967+00', true),
  (99, 'ONIX', 'CARLOS JOSE FERGUTZ NETO', '2026-07-17', 'dia_todo', '["UFRGS - INTERPRETE DE LIBRAS - 009.2026"]'::jsonb, '2026-07-17 11:10:13.858584+00', false),
  (101, 'ONIX', 'ISADORA PRISCO SILVEIRA', '2026-07-20', 'tarde', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-07-20 11:31:14.751051+00', false),
  (102, 'ONIX', 'ISADORA PRISCO SILVEIRA', '2026-07-20', 'manha', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-07-20 11:31:49.911653+00', false),
  (103, 'Jeep Compass', 'GUSTAVO GARCIA RONSANI', '2026-07-21', 'dia_todo', '["UFRGS - LIMPEZA - 020/2022"]'::jsonb, '2026-07-20 18:10:52.675953+00', false),
  (104, 'ONIX', 'GUSTAVO BARCELOS BRAGA', '2026-07-21', 'dia_todo', '["SAMU TELEFONISTAS - 96397/2025","SEC. DA CULTURA POA - PORTARIA - 88123","PREF POA SMS RECEPÇÃO - 98672/2025","POLICIA CIVIL RS LIMPEZA 066.2026","HOSPITAL SÃO CAMILO - 50163.2025"]'::jsonb, '2026-07-20 19:40:38.681075+00', false),
  (105, 'Jeep Compass', 'GUSTAVO BARCELOS BRAGA', '2026-07-22', 'dia_todo', '["POLICIA CIVIL RS LIMPEZA 066.2026","PREF POA SMS RECEPÇÃO - 98672/2025","SEMAE - 3038/2020","SEC. DA CULTURA POA - PORTARIA - 88123","SAMU TELEFONISTAS - 96397/2025","HOSPITAL SÃO CAMILO - 50163.2025"]'::jsonb, '2026-07-22 11:32:10.469094+00', false),
  (106, 'Jeep Compass', 'DICKSON SCHUBERT FLORES', '2026-07-27', 'dia_todo', '["BENTO GONÇALVES - LIMPEZA - 048.2026","BENTO GONÇALVES - AUX ADM - 002/2021","CAXIAS DO SUL - 95.2026","VERANOPOLIS - 001/2021"]'::jsonb, '2026-07-22 11:48:47.10424+00', true),
  (107, 'Jeep Compass', 'DICKSON SCHUBERT FLORES', '2026-07-27', 'dia_todo', '["VERANOPOLIS - 001/2021","BENTO GONÇALVES - AUX ADM - 002/2021","BENTO GONÇALVES - LIMPEZA - 048.2026","CAXIAS DO SUL - 95.2026"]'::jsonb, '2026-07-22 11:50:29.496793+00', false),
  (108, 'Jeep Compass', 'DICKSON SCHUBERT FLORES', '2026-07-28', 'dia_todo', '["CAXIAS DO SUL - 95.2026","BENTO GONÇALVES - LIMPEZA - 048.2026","BENTO GONÇALVES - AUX ADM - 002/2021","VERANOPOLIS - 001/2021"]'::jsonb, '2026-07-22 11:52:15.948284+00', false),
  (109, 'Jeep Compass', 'DICKSON SCHUBERT FLORES', '2026-07-29', 'dia_todo', '["BENTO GONÇALVES - AUX ADM - 002/2021","BENTO GONÇALVES - LIMPEZA - 048.2026","CAXIAS DO SUL - 95.2026","VERANOPOLIS - 001/2021"]'::jsonb, '2026-07-22 11:57:20.394895+00', false),
  (110, 'ONIX', 'DAIANE MARTINS DE SOUZA', '2026-07-22', 'manha', '["TRIUNFO COLETA DE LIXO 89.2026"]'::jsonb, '2026-07-22 12:04:40.40759+00', false),
  (111, 'Jeep Compass', 'DAIANE MARTINS DE SOUZA', '2026-08-05', 'dia_todo', '["SALTO DO JACUI - 722/2021"]'::jsonb, '2026-07-22 17:08:22.723796+00', false),
  (112, 'JAC J6', 'GUSTAVO GARCIA RONSANI', '2026-07-27', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-07-24 11:57:26.481111+00', false),
  (113, 'Jeep Compass', 'GUSTAVO BARCELOS BRAGA', '2026-07-25', 'dia_todo', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-07-24 14:29:07.765308+00', false),
  (114, 'MONTANA', 'CARLOS JOSE FERGUTZ NETO', '2026-07-25', 'dia_todo', '["UFRGS - AUX DE SAÚDE BUCAL - 033/2021","UFRGS - CARREGADORES - 095/2024","UFRGS - COPA E COZINHA - 025/2025","UFRGS - INTERPRETE DE LIBRAS - 009.2026","UFRGS - JARDINAGEM - 062/2025","UFRGS - LIMPEZA - 020/2022","UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-07-24 14:47:00.188756+00', false),
  (115, 'Jeep Compass', 'DICKSON SCHUBERT FLORES', '2026-08-19', 'dia_todo', '["EMBRAPA CANOINHAS - 47/2024","FURG JARDINAGEM  - 049/2022","FURG HU - 006/2023","FURG PORTARIA - 055/2023"]'::jsonb, '2026-07-24 17:42:14.915732+00', false),
  (116, 'Jeep Compass', 'DICKSON SCHUBERT FLORES', '2026-08-20', 'dia_todo', '["FURG HU - 006/2023","FURG JARDINAGEM  - 049/2022","FURG PORTARIA - 055/2023","EMBRAPA - 2021/93"]'::jsonb, '2026-07-24 17:43:36.241991+00', false),
  (117, 'KWID', 'CARLOS JOSE FERGUTZ NETO', '2026-07-27', 'tarde', '["UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-07-27 14:11:58.873337+00', false),
  (118, 'Jeep Compass', 'GUSTAVO BARCELOS BRAGA', '2026-07-30', 'dia_todo', '["SAMU TELEFONISTAS - 96397/2025","SEC. DA CULTURA POA - PORTARIA - 88123","SEMAE - 3038/2020","PREF POA SMS RECEPÇÃO - 98672/2025","POLICIA CIVIL RS LIMPEZA 066.2026"]'::jsonb, '2026-07-29 19:26:50.708483+00', false),
  (119, 'KWID', 'CARLOS JOSE FERGUTZ NETO', '2026-07-31', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022","UFRGS - LIMPEZA - 020/2022","UFRGS - AUX DE SAÚDE BUCAL - 033/2021"]'::jsonb, '2026-07-31 13:50:10.149926+00', false),
  (120, 'Jeep Compass', 'JOEL DOS SANTOS', '2026-07-31', 'tarde', '["TRIUNFO COLETA DE LIXO 89.2026"]'::jsonb, '2026-07-31 15:02:33.544578+00', true),
  (121, 'KWID', 'CARLOS JOSE FERGUTZ NETO', '2026-08-04', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-08-03 19:05:46.435444+00', false),
  (122, 'Jeep Compass', 'ISMAEL KUHL LOPES', '2026-08-10', 'dia_todo', '["UFFS PASSO FUNDO - 041/2021","UFFS ERECHIM - 041/2021"]'::jsonb, '2026-08-03 19:20:23.506392+00', false),
  (123, 'Jeep Compass', 'ISMAEL KUHL LOPES', '2026-08-11', 'dia_todo', '["UFFS CHAPECO - 041/2021"]'::jsonb, '2026-08-03 19:23:04.573405+00', false),
  (124, 'Jeep Compass', 'ISMAEL KUHL LOPES', '2026-08-12', 'dia_todo', '["EMBRAPA CANOINHAS - 47/2024"]'::jsonb, '2026-08-03 19:25:35.935055+00', false),
  (125, 'Jeep Compass', 'ISMAEL KUHL LOPES', '2026-08-13', 'dia_todo', '["PENHA LIMPEZA - 039/2025"]'::jsonb, '2026-08-03 19:39:29.29337+00', false),
  (126, 'ONIX', 'DAISON TAVARES RODRIGUES', '2026-08-13', 'dia_todo', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-08-05 14:13:19.230542+00', false),
  (127, 'MERCEDES', 'GUSTAVO BARCELOS BRAGA', '2026-08-06', 'dia_todo', '["SAMU TELEFONISTAS - 96397/2025","TJRS - 023/2025","POLICIA CIVIL RS LIMPEZA 066.2026","PREF POA SMS RECEPÇÃO - 98672/2025","UFRGS - LIMPEZA GERAL - 047/2022","UFRGS - LIMPEZA - 020/2022","UFRGS - JARDINAGEM - 062/2025"]'::jsonb, '2026-08-05 14:52:46.089195+00', false),
  (128, 'ONIX', 'JOSE CARLOS FERREIRA EBERT', '2026-08-11', 'tarde', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-08-10 11:50:32.710445+00', false);

-- ── 3. De/para dos veículos ──────────────────────────────────────────
-- Duas placas casaram sozinhas (MERCEDES→MERCEDES VITO, JAC J6→JBY-7G73);
-- o resto casou por nome. KWID era ambíguo entre "KWID" e "KWID PRETO",
-- nenhum com placa cadastrada — o Pablo confirmou que é o "KWID".
DROP TABLE IF EXISTS public.tmp_carga_veiculos_depara;
CREATE TABLE public.tmp_carga_veiculos_depara (legado text PRIMARY KEY, atual text NOT NULL);
INSERT INTO public.tmp_carga_veiculos_depara VALUES
  ('ONIX',         'ONIX'),
  ('JAC J6',       'JBY-7G73'),
  ('MONTANA',      'MONTANA'),
  ('Jeep Compass', 'JEEP COMPAS'),
  ('MERCEDES',     'MERCEDES VITO'),
  ('KWID',         'KWID');

-- Se algum de/para não achar o veículo, a carga para aqui em vez de
-- importar reserva órfã.
DO $$
DECLARE v_faltando text;
BEGIN
  SELECT string_agg(d.atual, ', ') INTO v_faltando
    FROM public.tmp_carga_veiculos_depara d
   WHERE NOT EXISTS (SELECT 1 FROM public.sup_patrimonio p
                      WHERE p.categoria = 'veiculo' AND p.ativo AND p.nome = d.atual);
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'Veículo(s) do de/para não encontrados no Patrimônio: %', v_faltando;
  END IF;
END $$;

-- ── 4. A carga ───────────────────────────────────────────────────────
ALTER TABLE public.cs_veiculo_agendamento DISABLE TRIGGER USER;

INSERT INTO public.cs_veiculo_agendamento (
  legado_id, empresa_id, patrimonio_id, veiculo_nome, veiculo_identificador,
  data_inicio, data_fim, turno, observacoes,
  status, motivo_cancelamento, solicitante_id, solicitante_nome, created_at
)
SELECT t.legado_id, p.empresa_id, p.id, p.nome, p.identificador,
       t.data, t.data, t.turno,
       'Importado do sistema anterior (registro nº ' || t.legado_id
         || ', veículo "' || t.veiculo_nome || '").',
       CASE WHEN t.cancelado THEN 'cancelado' ELSE 'confirmado' END,
       CASE WHEN t.cancelado
            THEN 'Cancelado no sistema anterior (importação do histórico).' END,
       pr.id, pr.display_name, t.criado_em
  FROM public.tmp_carga_veiculos_legado t
  JOIN public.tmp_carga_veiculos_depara d ON d.legado = t.veiculo_nome
  JOIN public.sup_patrimonio p ON p.nome = d.atual AND p.categoria = 'veiculo' AND p.ativo
  JOIN public.profiles pr ON upper(btrim(pr.display_name)) = upper(btrim(t.condutor_nome))
-- O predicado tem de ser repetido: o índice é parcial, e sem ele o Postgres
-- não reconhece o árbitro do ON CONFLICT.
ON CONFLICT (legado_id) WHERE legado_id IS NOT NULL DO NOTHING;

-- Contratos: id quando existe, nome sempre.
INSERT INTO public.cs_veiculo_agendamento_contrato (agendamento_id, contrato_id, contrato_nome)
SELECT a.id,
       (SELECT c.id FROM public.contratos c
         WHERE upper(btrim(c.nome)) = upper(btrim(nome_legado)) LIMIT 1),
       nome_legado
  FROM public.tmp_carga_veiculos_legado t
  JOIN public.cs_veiculo_agendamento a ON a.legado_id = t.legado_id
 CROSS JOIN LATERAL jsonb_array_elements_text(t.contratos) AS x(nome_legado)
ON CONFLICT DO NOTHING;

ALTER TABLE public.cs_veiculo_agendamento ENABLE TRIGGER USER;

DROP TABLE public.tmp_carga_veiculos_legado;
DROP TABLE public.tmp_carga_veiculos_depara;

-- ── 5. Conferência ───────────────────────────────────────────────────
SELECT count(*) FILTER (WHERE legado_id IS NOT NULL)                          AS importados,
       count(*) FILTER (WHERE legado_id IS NOT NULL AND status = 'cancelado') AS cancelados,
       count(*) FILTER (WHERE legado_id IS NULL)                              AS nascidos_aqui
  FROM public.cs_veiculo_agendamento;

SELECT count(*)                                AS vinculos_de_contrato,
       count(*) FILTER (WHERE contrato_id IS NULL) AS sem_par_em_contratos
  FROM public.cs_veiculo_agendamento_contrato ct
  JOIN public.cs_veiculo_agendamento a ON a.id = ct.agendamento_id
 WHERE a.legado_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
