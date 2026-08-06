-- =====================================================================
-- PATRIMÔNIO — carga completa, vinda do banco do legado
--
-- GERADO por scripts/gerar-migration-patrimonio.mjs a partir do dump das
-- tabelas `veiculos` e `equipamentos`. NÃO EDITE À MÃO.
--
--   129 itens · 15 veiculo · 114 equipamento
--   26 em manutenção · 13 sem contrato (frota da sede)
--
-- Substitui a 20260824000002, que vinha do export do Painel e só tinha os 26
-- parados. Rodar esta com aquela já aplicada apenas COMPLETA o que falta —
-- o casamento é por identificador, e por (categoria, nome, contrato, posto)
-- para quem não tem identificador.
--
-- NO LEGADO A COLUNA `descricao` É O IDENTIFICADOR. Não é descrição livre:
-- é o que os modais "Adicionar Veículo/Máquina" chamavam de "Identificador".
--
-- DE-PARA DE CONTRATO
--   CANOINHAS - EMBRAPA → EMBRAPA - CANOINHA - 47/2024
--   UFRGS - ASB - 033 2021 → UFRGS - AUXILIAR DE SAÚDE BUCAL - 033/2021
--   ADMINISTRATIVO ESCRITÓRIO → sem contrato; o posto vira lotação
--
-- DE-PARA DE POSTO
--   UFRGS-LITORAL-062 → CAMPUS LITORAL
--   UFRGS-CENTRO-062 → CAMPUS CENTRO
--   UFRGS-AGRONOMIA-062 → CAMPUS AGRONOMIA
--   UFRGS - AUXILIAR DE SAUDE BUCAL → AUXILIAR DE SAUDE BUCAL
--
-- ROLLBACK: DELETE FROM public.sup_patrimonio
--            WHERE observacoes LIKE 'Importado do%legado';
-- =====================================================================

DROP TABLE IF EXISTS public.sup_imp_patrimonio;
CREATE TABLE public.sup_imp_patrimonio (
  categoria     text,
  nome          text,
  identificador text,
  contrato_nome text,
  posto_nome    text,
  lotacao       text,
  em_manutencao boolean,
  data_inicio   date,
  data_fim      date
);

INSERT INTO public.sup_imp_patrimonio
  (categoria, nome, identificador, contrato_nome, posto_nome, lotacao,
   em_manutencao, data_inicio, data_fim)
VALUES
  ('veiculo', 'RANGER', '1234567', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, false, NULL::date, NULL::date),
  ('veiculo', 'KWID', NULL, 'UFRGS - AUXILIAR DE SAÚDE BUCAL - 033/2021', 'AUXILIAR DE SAUDE BUCAL', NULL, false, NULL::date, NULL::date),
  ('veiculo', 'SOPRADOR A BATERIA STHIL BGA 50.0', 'NUMERO DE SERIE-450660232', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS CENTRO', NULL, false, NULL::date, NULL::date),
  ('veiculo', 'JEEP COMPAS', NULL, NULL, NULL, 'ADM', false, NULL::date, NULL::date),
  ('veiculo', 'SIENA', 'ILU-6C52', NULL, NULL, 'ADM', false, NULL::date, NULL::date),
  ('veiculo', 'HILUX', 'JAA-5D04', NULL, NULL, 'ADM', false, NULL::date, NULL::date),
  ('veiculo', 'VOLVO XC 40', 'JBY-7G73', NULL, NULL, 'ADM', false, NULL::date, NULL::date),
  ('veiculo', 'JBY-7G73', 'JBZ-4D93', NULL, NULL, 'ADM', false, NULL::date, NULL::date),
  ('veiculo', 'S10 BIGODE', 'JCH-9B69', NULL, NULL, 'ADM', false, NULL::date, NULL::date),
  ('veiculo', 'TRAILBLAZER', 'JAG-6C85', NULL, NULL, 'ADM', false, NULL::date, NULL::date),
  ('veiculo', 'RANGER SENILTON', 'QZC-6F79', NULL, NULL, 'ADM', false, NULL::date, NULL::date),
  ('veiculo', 'MERCEDES VITO', 'IXF-7G06', NULL, NULL, 'ADM', false, NULL::date, NULL::date),
  ('veiculo', 'MONTANA', NULL, NULL, NULL, 'ADM', false, NULL::date, NULL::date),
  ('veiculo', 'KWID PRETO', NULL, NULL, NULL, 'ADM', false, NULL::date, NULL::date),
  ('veiculo', 'ONIX', NULL, NULL, NULL, 'ADM', false, NULL::date, NULL::date),
  ('equipamento', 'PULVERISADOR MANUAL', 'PULVERISADOR12352', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'FS 220 - STIHL', 's14466551', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS AGRONOMIA', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 160', 'NUMERO DE SERIE-370885499', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 220', 'NUMERO DE SERIE - 370652233', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'Roçadeira FS 220 Sthil', 'NUMERO DE SERIE-368541106', 'UFFS - 041.2021', 'UFFS - PASSO FUNDO 041 2021', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'Lavajato Electrolux - Power Wash Plus +', 'Lavajato Electrolux-1234', 'UFFS - 041.2021', 'UFFS - PASSO FUNDO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'Maquina Buffalo - BFG-4T-6', 'NUMERO DE SERIE-52103B0049', 'UFFS - 041.2021', 'UFFS - PASSO FUNDO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'Maquina Trapp autotracionada', 'P707V-3B 22051067', 'UFFS - 041.2021', 'UFFS - PASSO FUNDO 041 2021', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 220', 'NUMERO DE SERIE-370885513', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'TRATOR CORTADOR DE GRAMA VONDER TGM 175', 'VONDER12353', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'Roçadeira FS 220 Stihl', 'NUMERO DE SERIE-365972397', 'UFFS - 041.2021', 'UFFS - PASSO FUNDO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'Soprador Sthil', '42417010606 A', 'UFFS - 041.2021', 'UFFS - PASSO FUNDO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'Moto Poda Stihl', '3709033445 S', 'UFFS - 041.2021', 'UFFS - PASSO FUNDO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'MOTOPODA STHIL HT 75', 'NUMERO DE SERIE-370903386', 'UFFS - 041.2021', 'UFFS - LARANJEIRAS 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ASPIRADOR DE PÓ ELETROLUX GT3000 PRO', 'ELETROLUX12347', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ASPIRADOR DE PÓ ELETROLUX GT3000 PRO', 'ELETROLUX12348', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'CORTADOR DE GRAMA TRACIONADO STHIL RM 253.3T', 'N° 451652936', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ENCERADEIRA - MARCA DESCONHECIDA', 'ENCERADEIRA12354', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ENCERADEIRA ROMHER', 'ROMHER12349', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'LAVAJATO ELETROLUX ULTRAWASH 2200 PSI', 'ELETROLUX12350', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'LAVAJATO STHIL RE108', 'STHIL12351', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 221', 'NUMERO DE SERIE-274426484', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 221', 'NUMERO DE SERIE-374520999', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'SOPRADOR STHIL SH-56', 'NUMERO DE SERIE-525864474', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'SOPRADOR STHIL SH-56', 'NUMERO DE SERIE-529780264', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'CORTADOR DE GRAMA TRACIONADO BUFFALO 6.5 BFGT53 SLR', 'BUFFALO12345', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'CORTADOR DE GRAMA TRACIONADO BUFFALO 6.5 BFGT53 SLR', 'BUFFALO12346', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'MOTOSSERA STHIL MS 382', 'NUMERO DE SERIE-370664301', 'UFFS - 041.2021', 'UFFS - LARANJEIRAS 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 220', 'NUMERO DE SERIE-367859057', 'UFFS - 041.2021', 'UFFS - LARANJEIRAS 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 220', 'NUMERO DE SERIE-370652186', 'UFFS - 041.2021', 'UFFS - LARANJEIRAS 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 220', 'NUMERO DE SERIE-370996676', 'UFFS - 041.2021', 'UFFS - LARANJEIRAS 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 221', 'NUMERO DE SERIE-374272018', 'UFFS - 041.2021', 'UFFS - LARANJEIRAS 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 221', 'NUMERO DE SERIE-374272102', 'UFFS - 041.2021', 'UFFS - LARANJEIRAS 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 290', 'NUMERO DE SERIE-370204709', 'UFFS - 041.2021', 'UFFS - LARANJEIRAS 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'Enceradeira Crismar', 'Enceradeira Crismar-1234', 'UFFS - 041.2021', 'UFFS - PASSO FUNDO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'TRATOR VONDER TGM 175', 'NUMERO DE SERIE-TGM175200722140', 'UFFS - 041.2021', 'UFFS - LARANJEIRAS 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'LAVA-JATO STHIL RE 100', 'NSERIE - 375007777 PATRIMONIO 14506', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'MOTOPODA STHIL HT 75', 'NSERIE - 413702G-03H PATRIMONIO 14522', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA BATERIA STHIL FSA 135', 'NSERIE - 540515606 SEM PATRIMONIO', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA GASOLINA STHIL FS 221', 'NSERIE - 4147140603A SEM PATRIMONIO', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'SOPRADOR BATERIA STHIL BGS 50.0', 'NSERIE - 450660246 PATRIMONIO 14503', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'SOPRADOR GASOLINA STHIL BG 50', 'NSERIE - 547044135 PATRIMONIO 14520', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'BATERIA STHIL AP30.0', 'NSERIE - 545949945 SEM PATRIMONIO', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'CEIFADEIRA STHIL RM 2 R', 'NSERIE - T323025020131723 PATRIMONIO 14507', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'BATERIA STHIL AP30.0', 'NSERIE - 545950085 SEM PATRIMONIO', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'CEFADEIRA STHIL RM 2.2 R', 'NSERIE - 451629222 PATRIMONIO 14508', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ASPIRADOR DE PÓ ELETROLUX GT3000', 'NUMERO DE PATRIMONIO-000054', 'UFFS - 041.2021', 'UFFS - CERRO LARGO 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'SOPRADOR GARTHEN EB-340', 'NUMERO DE SERIE-23090110003A0006', 'UFFS - 041.2021', 'UFFS - LARANJEIRAS 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FSA 135', 'NSERIE - 540515528 PATRIMONIO 14510', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'SOPRADOR BGA 50.0', 'NSERIE - 450833811 PATRIMONIO 014509', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'SOPRADOR A COMBUSTÃO STHIL BG50', 'NUMERO DE SERIE-538094903', 'EMBRAPA - CANOINHA - 47/2024', 'CANOINHAS - EMBRAPA', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'MÁQUINA GASOLINA STHIL RM 2.2 R', 'NSERIE -T32300425020131947 PATRIMONIO 14515', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'MAQUINA PODAR NAGANO AP2600G', 'NSERIE-191606060028 SEM PATRIMONIO', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'MOTO PODA STHIL HT 75', 'NSERIE-374833976 SEM PATRIMONIO', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'MOTO PODA STHIL HT 75', 'NSERIE-374833987 PATRIMONIO 14516', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'MOTOSERRA STHIL MS 382', 'NSERIE-111979110003 SEM PATRIMONIO', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'PODADOR CERCA VIVA STHIL HS 45', 'NSERIE -840211006 SEM PATRIMONIO', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 221', 'NSERIE-374789831 SEM PATRIMONIO', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 221', 'NSERIE -374789803 PATRIMONIO 14517', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'SOPRADOR BATERIA STHIL BGS 50.0', 'NSERIE -BA059671815A PATRIMONIO 14513', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 221', 'NSERIE-374789840 PATRIMONIO 14521', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'SOPRADOR GASOLINA STHIL BG 50', 'NSERIE -547044175 SEM PATRIMONIO', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'SOPRADOR GASOLINA STHIL BG 50', 'NSERIE -547044176 SEM PATRIMONIO', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'SOPRADOR GASOLINA STHIL BG 50', 'NSERIE -42297010609 PATRIMONIO 14514', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'BATERIA STHIL AK20', 'NSERIE - 45209671855A SEM PATRIMONIO', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'CORTADOR DE GRAMA BRANCO', 'NUMERO DE SERIE-T3500024030041772', 'EMBRAPA - CANOINHA - 47/2024', 'CANOINHAS - EMBRAPA', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'LAVADORA DE ALTA PRESSÃO RE90', 'NUMERO DE SERIE-932363503', 'EMBRAPA - CANOINHA - 47/2024', 'CANOINHAS - EMBRAPA', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'PODADOR STHIL HS-45', 'NUMERO DE SERIE-835653840', 'EMBRAPA - CANOINHA - 47/2024', 'CANOINHAS - EMBRAPA', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA TOYAMA TBC63', 'NUMERO DE SERIE-30100624040035', 'EMBRAPA - CANOINHA - 47/2024', 'CANOINHAS - EMBRAPA', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA TOYAMA TBC63', 'NUMERO DE SERIE-30100624070407', 'EMBRAPA - CANOINHA - 47/2024', 'CANOINHAS - EMBRAPA', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'BOBCAT S450', 'NUMERO DE SERIE-B1ED11826', 'FURG JARDINAGEM 049 2022', 'FURG RIO GRANDE', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'ASPIRADOR DE PÓ ELECTROLUX GT 3000', NULL, 'UFFS - 041.2021', 'UFFS - ERECHIM 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 220', 'NUMERO DE SERIE-367859054', 'UFFS - 041.2021', 'UFFS - REALEZA 041 2021', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 221', 'PATRIMONIO-014518', 'UFFS - 041.2021', 'UFFS - REALEZA 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ASPIRADOR DE AGUA E PÓ WAP GTW INOX 12', 'NUMERO DE SERIE-FW00504201311122024', 'EMBRAPA - CANOINHA - 47/2024', 'CANOINHAS - EMBRAPA', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'MOTO PODA STHIL HT 75', 'NUMERO DE SERIE-374833775', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS CENTRO', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ASPIRADOR DE PÓ GTW INOX 12', NULL, 'UFFS - 041.2021', 'UFFS - ERECHIM 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'CORTADOR DE GRAMA TRACIONADO TRAPP MC-600G', 'NUMERO DE SERIE-CG009602124', 'UFFS - 041.2021', 'UFFS - ERECHIM 041 2021', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 220', 'NUMERO DE SERIE-368541110', 'UFFS - 041.2021', 'UFFS - ERECHIM 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 221', 'NSERIE-374789796 PATRIMONIO 14519', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 220', 'NUMERO DE SERIE-370542335', 'UFFS - 041.2021', 'UFFS - ERECHIM 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 220', 'NUMERO DE SERIE-370885477', 'UFFS - 041.2021', 'UFFS - ERECHIM 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 220', 'NUMERO DE SERIE-368541109', 'UFFS - 041.2021', 'UFFS - REALEZA 041 2021', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 220', 'NUMERO DE SERIE-370885275', 'UFFS - 041.2021', 'UFFS - REALEZA 041 2021', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'MOTOSERA STHIL MS382', 'NUMERO DE SERIE-374865289', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS CENTRO', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'PODADOR DE CERCA VIVA HS 45', 'NUMERO DE SERIE-840211011', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS CENTRO', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA A BATERIA STHIL FSA 135', 'NUMERO DE SERIE-540515559', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS CENTRO', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA A COMBUSTÃO STHIL FS 221', 'NUMERO DE SERIE-374789766', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS CENTRO', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA A COMBUSTÃO STHIL FS 221', 'NUMERO DE SERIE-374865287', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS CENTRO', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'LAVA-JATO STHIL RE-100', 'NSERIE -375007778 SEM PATRIMONIO', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'CORTADOR DE GRAMA TRACIONADO TRAPP MC-600G', NULL, 'UFFS - 041.2021', 'UFFS - ERECHIM 041 2021', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 220', 'NUMERO DE SERIE-370996782', 'UFFS - 041.2021', 'UFFS - ERECHIM 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'LAVA-JATO STHIL RE 100', 'NSERIE - 374471627 PATRIMONIO 14504', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA STHIL FS 221', 'NUMERO DE SERIE-41479674003A', 'UFFS - 041.2021', 'UFFS - ERECHIM 041 2021', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'ROÇADEIRA', '370885275', 'UFFS - 041.2021', 'UFFS - REALEZA 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'MAQUINA DE CORTAR GRAMA TRAPP', NULL, 'UFFS - 041.2021', 'UFFS - PASSO FUNDO 041 2021', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'TRATOR VONDER TGM 175', NULL, 'UFFS - 041.2021', 'UFFS - REALEZA 041 2021', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'CEIFADEIRA', 'T3230425020131947', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'CEIFADEIRA', 'T3230425020131735', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS LITORAL', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'BOB CAT', 'BOB-8189', NULL, NULL, 'ADM', false, NULL::date, NULL::date),
  ('equipamento', 'MAQUINA DE LAVAR CONSUL 12KG', 'NUMERO DE SERIE-CG1161196', 'UFFS - 041.2021', 'UFFS - CHAPECÓ 041 2021', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'TARTOR VALTRA 585', 'NUMERO DE SERIE-AAAT2001ABM000148', 'FURG JARDINAGEM 049 2022', 'FURG RIO GRANDE', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'MAQUINA DE LAVAR CONSUL 12 KG', 'NUMERO DE SERIE - CG1176950', 'UFFS - 041.2021', 'UFFS - PASSO FUNDO 041 2021', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'MAQUINA DE LAVAR CONSUL 12KG', 'NUMERO DE SERIE - CWH12BBBNACE3153897EQ', 'UFFS - 041.2021', 'UFFS - REALEZA 041 2021', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'SOPRADOR A BATERIA BGA 50.0', 'NUMERO DE SERIE-450833808', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS CENTRO', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'SOPRADOR A BATERIA STHIL BGA 50.0', 'NUMERO DE SERIE-450660217', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS CENTRO', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'SOPRADOR A COMBUSTÃO STHIL BG 50', 'NUMERO DE SERIE-547016392', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS CENTRO', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'LAVAJATO STHIL RE 100', 'NUMERO DE SERIE-374471629', 'UFRGS - JARDINAGEM - 062 2025', 'CAMPUS CENTRO', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'ENCERADEIRA HIGH SPEED', NULL, 'UFFS - 041.2021', 'UFFS - ERECHIM 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ENCERADEIRA CERTEC', NULL, 'UFFS - 041.2021', 'UFFS - ERECHIM 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'ENCERADEIRA CLEANER', NULL, 'UFFS - 041.2021', 'UFFS - ERECHIM 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'CARRINHO DE MÃO', NULL, 'UFFS - 041.2021', 'UFFS - REALEZA 041 2021', NULL, true, NULL::date, NULL::date),
  ('equipamento', 'SOPRADOR', NULL, 'UFFS - 041.2021', 'UFFS - REALEZA 041 2021', NULL, false, NULL::date, NULL::date),
  ('equipamento', 'SOPRADOR -número de serie 525864609 -', NULL, 'UFFS - 041.2021', 'UFFS - REALEZA 041 2021', NULL, true, NULL::date, NULL::date);

-- ── Higiene do que já entrou ─────────────────────────────────────────
-- A carga anterior (20260824000002) gravou como identificador textos que não
-- identificam nada — "ALMOXARIFADO" no SOPRADOR, por exemplo, que é o texto
-- de EXEMPLO do modal do legado. Zerar aqui faz duas coisas: corrige o dado e
-- permite o casamento abaixo reconhecer a linha, em vez de inserir de novo.
UPDATE public.sup_patrimonio p
   SET identificador = NULL
 WHERE p.identificador IS NOT NULL
   AND (
     trim(p.identificador) = ''
     OR upper(trim(p.identificador)) IN
        ('VEICULO','VEÍCULO','CARRO','CAMINHONETE','EQUIPAMENTO','MAQUINA','MÁQUINA',
         'ALMOXARIFADO','MANUTENCAO','MANUTENÇÃO')
     OR upper(trim(p.identificador)) ~ '^(SEM|NAO TEM|NÃO TEM).*(NUMERO|NÚMERO|NSERIE)'
   );

-- ── Carga ────────────────────────────────────────────────────────────
-- A empresa vem do contrato quando há; sem contrato, cai na empresa do
-- almoxarifado matriz (a frota da sede pertence à empresa, não a um contrato).
WITH resolvido AS (
  SELECT i.*,
         c.id  AS contrato_id,
         sp.id AS posto_id,
         COALESCE(c.empresa_id,
                  (SELECT a.empresa_id FROM public.almoxarifado a
                    WHERE a.is_matriz ORDER BY a.created_at LIMIT 1)) AS empresa_id
    FROM public.sup_imp_patrimonio i
    LEFT JOIN public.contratos c
      ON i.contrato_nome IS NOT NULL
     AND public.sup_norm_nome(c.nome) = public.sup_norm_nome(i.contrato_nome)
    LEFT JOIN public.sup_posto sp
      ON sp.contrato_id = c.id
     AND public.sup_norm_nome(sp.nome) = public.sup_norm_nome(i.posto_nome)
)
INSERT INTO public.sup_patrimonio
  (empresa_id, categoria, nome, identificador, contrato_id, posto_id, lotacao,
   em_manutencao, data_inicio_manutencao, data_previsao_fim, observacoes)
SELECT r.empresa_id, r.categoria, r.nome, r.identificador, r.contrato_id, r.posto_id, r.lotacao,
       r.em_manutencao, r.data_inicio, r.data_fim,
       'Importado do banco do legado'
  FROM resolvido r
 WHERE r.empresa_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.sup_patrimonio p
      WHERE p.empresa_id = r.empresa_id
        AND (
          (r.identificador IS NOT NULL
           AND upper(trim(p.identificador)) = upper(trim(r.identificador)))
          OR (r.identificador IS NULL AND p.identificador IS NULL
              AND p.categoria = r.categoria
              AND upper(trim(p.nome)) = upper(trim(r.nome))
              AND p.contrato_id IS NOT DISTINCT FROM r.contrato_id
              AND p.posto_id    IS NOT DISTINCT FROM r.posto_id)
        )
   );

-- ── Conferência ──────────────────────────────────────────────────────
-- 1) Contratos do legado sem correspondente (fora os que viram lotação).
SELECT DISTINCT i.contrato_nome AS contrato_sem_correspondente
  FROM public.sup_imp_patrimonio i
 WHERE i.contrato_nome IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.contratos c
                    WHERE public.sup_norm_nome(c.nome) = public.sup_norm_nome(i.contrato_nome))
 ORDER BY 1;

-- 2) Postos que não casaram (o item entra, mas sem posto).
SELECT DISTINCT i.contrato_nome, i.posto_nome AS posto_sem_correspondente
  FROM public.sup_imp_patrimonio i
  JOIN public.contratos c ON public.sup_norm_nome(c.nome) = public.sup_norm_nome(i.contrato_nome)
 WHERE NOT EXISTS (SELECT 1 FROM public.sup_posto sp
                    WHERE sp.contrato_id = c.id
                      AND public.sup_norm_nome(sp.nome) = public.sup_norm_nome(i.posto_nome))
 ORDER BY 1, 2;

-- 3) O que existe agora.
SELECT count(*)::int AS total,
       count(*) FILTER (WHERE categoria = 'veiculo')::int      AS veiculos,
       count(*) FILTER (WHERE categoria = 'equipamento')::int  AS equipamentos,
       count(*) FILTER (WHERE em_manutencao)::int              AS em_manutencao,
       count(*) FILTER (WHERE contrato_id IS NULL)::int        AS sem_contrato,
       count(*) FILTER (WHERE contrato_id IS NOT NULL
                          AND posto_id IS NULL)::int           AS sem_posto
  FROM public.sup_patrimonio;

DROP TABLE IF EXISTS public.sup_imp_patrimonio;

NOTIFY pgrst, 'reload schema';
