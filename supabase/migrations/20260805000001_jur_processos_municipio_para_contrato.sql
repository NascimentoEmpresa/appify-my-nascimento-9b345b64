-- =====================================================================
-- JUR_PROCESSOS — municipio_origem que na verdade era CONTRATO
--
-- O campo "Município de origem" acumulou duas coisas: cidade de verdade
-- ("PORTO ALEGRE") e descrição de posto ("UFRGS - JARDINAGEM CAMPUS SAUDE
-- TRI"). A segunda é contrato, e vinha de vincular o reclamante ao cadastro:
-- gravava "Descrição do Local" (que é o contrato) no campo de município.
--
-- Converte SÓ o que casa com UM contrato ativo sem ambiguidade, usando a
-- mesma regra da tela (sugerirContrato, em Processos.tsx). Deixa intactos:
--   • cidades com VÁRIOS contratos (RIO GRANDE, TRIUNFO, BENTO GONÇALVES,
--     CHARQUEADAS) — escolher o "mais parecido" ali é cara ou coroa;
--   • quem não casa com contrato nenhum (PORTO ALEGRE e afins);
--   • quem já tem `contrato` preenchido — nunca sobrescreve.
-- Gravar um chute cria erro silencioso, pior que o campo em branco: ninguém
-- desconfia de um valor preenchido.
--
-- JUR_PROCESSOS_MUNICIPIO_BACKUP guarda o valor anterior para desfazer:
--   UPDATE public."JUR_PROCESSOS" p
--      SET municipio_origem = b.municipio_origem_antigo, contrato = b.contrato_antigo
--     FROM public."JUR_PROCESSOS_MUNICIPIO_BACKUP" b WHERE p.id = b.id;
--
-- JÁ APLICADO no banco do app em 05/08/2026: 159 linhas / 38 processos.
-- Idempotente (o backup usa ON CONFLICT DO NOTHING e o UPDATE só pega quem
-- ainda tem o município antigo).
-- =====================================================================


CREATE TABLE IF NOT EXISTS public."JUR_PROCESSOS_MUNICIPIO_BACKUP" (
  id bigint PRIMARY KEY,
  numero_processo text,
  municipio_origem_antigo text,
  contrato_antigo text,
  movido_em timestamptz NOT NULL DEFAULT now()
);

WITH mapa(mun, ctr) AS (VALUES
  ('SANTA MARIA', 'HUSM SANTA MARIA - LAVANDERIA - 020/2021'),
  ('CAXIAS DO SUL', 'CAXIAS DO SUL - 95.2026'),
  ('VERANÓPOLIS', 'VERANOPOLIS - 001/2021'),
  ('CHAPECÓ', 'UFFS CHAPECO - 041/2021'),
  ('PASSO FUNDO', 'UFFS PASSO FUNDO - 041/2021'),
  ('SERVIÇO CAMARA RIO GRANDE/LIMPEZA', 'CAMARA DE RIO GRANDE-LIMPEZA - 001/2023'),
  ('SECRETARIA DE SAUDE BENTO GONCALVES', 'BENTO GONÇALVES - LIMPEZA - 048.2026'),
  ('ERECHIM', 'UFFS ERECHIM - 041/2021'),
  ('PELOTAS', 'FUNARBE PELOTAS - 58164/2025'),
  ('VIGIAS SALTO DO JACUI', 'SALTO DO JACUI - 722/2021'),
  ('CHAPECO', 'UFFS CHAPECO - 041/2021'),
  ('JARDINAGEM FURG', 'FURG JARDINAGEM  - 049/2022'),
  ('PREF BENTO GONCALVES AUXILIARES E COPEIR', 'BENTO GONÇALVES - LIMPEZA - 048.2026'),
  ('SALTO DO JACUI', 'SALTO DO JACUI - 722/2021'),
  ('SEMAE AUX DE LIMPEZA', 'SEMAE - 3038/2020'),
  ('UFRGS - JARDINAGEM CAMPUS CENTRO TRI', 'UFRGS - JARDINAGEM - 062/2025'),
  ('UFRGS - JARDINAGEM CAMPUS SAUDE TRI', 'UFRGS - JARDINAGEM - 062/2025'),
  ('UFRGS - JARDINAGEM CAMPUS VALE TEU', 'UFRGS - JARDINAGEM - 062/2025'),
  ('UFRGS - JARDINAGEM CAMPUS VALE TRI', 'UFRGS - JARDINAGEM - 062/2025')
),
alvo AS (
  SELECT p.id, p.numero_processo, p.municipio_origem, p.contrato, m.ctr
    FROM public."JUR_PROCESSOS" p JOIN mapa m ON btrim(p.municipio_origem) = m.mun
   WHERE nullif(btrim(p.contrato), '') IS NULL   -- nunca sobrescreve contrato ja preenchido
)
INSERT INTO public."JUR_PROCESSOS_MUNICIPIO_BACKUP" (id, numero_processo, municipio_origem_antigo, contrato_antigo)
SELECT id, numero_processo, municipio_origem, contrato FROM alvo
ON CONFLICT (id) DO NOTHING;

UPDATE public."JUR_PROCESSOS" p
   SET contrato = b.municipio_origem_antigo_convertido, municipio_origem = NULL
  FROM (SELECT bk.id, m.ctr AS municipio_origem_antigo_convertido
          FROM public."JUR_PROCESSOS_MUNICIPIO_BACKUP" bk
          JOIN (VALUES
            ('SANTA MARIA', 'HUSM SANTA MARIA - LAVANDERIA - 020/2021'),
            ('CAXIAS DO SUL', 'CAXIAS DO SUL - 95.2026'),
            ('VERANÓPOLIS', 'VERANOPOLIS - 001/2021'),
            ('CHAPECÓ', 'UFFS CHAPECO - 041/2021'),
            ('PASSO FUNDO', 'UFFS PASSO FUNDO - 041/2021'),
            ('SERVIÇO CAMARA RIO GRANDE/LIMPEZA', 'CAMARA DE RIO GRANDE-LIMPEZA - 001/2023'),
            ('SECRETARIA DE SAUDE BENTO GONCALVES', 'BENTO GONÇALVES - LIMPEZA - 048.2026'),
            ('ERECHIM', 'UFFS ERECHIM - 041/2021'),
            ('PELOTAS', 'FUNARBE PELOTAS - 58164/2025'),
            ('VIGIAS SALTO DO JACUI', 'SALTO DO JACUI - 722/2021'),
            ('CHAPECO', 'UFFS CHAPECO - 041/2021'),
            ('JARDINAGEM FURG', 'FURG JARDINAGEM  - 049/2022'),
            ('PREF BENTO GONCALVES AUXILIARES E COPEIR', 'BENTO GONÇALVES - LIMPEZA - 048.2026'),
            ('SALTO DO JACUI', 'SALTO DO JACUI - 722/2021'),
            ('SEMAE AUX DE LIMPEZA', 'SEMAE - 3038/2020'),
            ('UFRGS - JARDINAGEM CAMPUS CENTRO TRI', 'UFRGS - JARDINAGEM - 062/2025'),
            ('UFRGS - JARDINAGEM CAMPUS SAUDE TRI', 'UFRGS - JARDINAGEM - 062/2025'),
            ('UFRGS - JARDINAGEM CAMPUS VALE TEU', 'UFRGS - JARDINAGEM - 062/2025'),
            ('UFRGS - JARDINAGEM CAMPUS VALE TRI', 'UFRGS - JARDINAGEM - 062/2025')
          ) AS m(mun, ctr) ON btrim(bk.municipio_origem_antigo) = m.mun) b
 WHERE p.id = b.id;
