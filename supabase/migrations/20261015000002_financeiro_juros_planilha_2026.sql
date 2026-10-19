-- =========================================================================
-- FINANCEIRO › CONTROLE DE JUROS — importação da planilha de 2026 (15/10/2026)
--
-- Chamado: "Importar a planilha de juros em anexo para o sistema na rota
-- /app/financeiro/controle-juros" (RELATORIO_DE_JUROS_E_MULTAS_-_2026.xlsx,
-- aba "Controle de erros": 43 linhas, 13/01 a 24/09/2026, R$ 2.608,39 —
-- todas "NÃO DESCONTADO", sem responsável).
--
-- A tela lê v_controle_juros_malote, que só tem despesas/parcelas do MALOTE
-- pagas com juros (a primeira é de 02/10/2026 — sem sobreposição com a
-- planilha). Essas 43 não são despesas do Malote: virar despesa falsa lá
-- misturaria o histórico de pagamentos. Então:
--   1. "FIN_JUROS_IMPORTADO" guarda o que veio de planilha (origem + linha da
--      planilha = chave, reimportar não duplica);
--   2. a view soma esses registros (coluna nova `origem`: despesa/parcela/
--      planilha) — a classificação casa com o cadastro pelo nome; 3 da planilha
--      não existem lá (SEGURO VEICULO, MATERIAIS DE CONST., INSUMOS
--      JARDINAGEM) e ficam com o nome da planilha;
--   3. malote_juros_marcar_cobrado aceita origem 'planilha'.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."FIN_JUROS_IMPORTADO" (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origem             text NOT NULL,
  linha_planilha     integer NOT NULL,
  numero             text NOT NULL UNIQUE,
  data_pagamento     date NOT NULL,
  classificacao_id   uuid REFERENCES public.planejamento_orcamentario_classificacao(id) ON DELETE SET NULL,
  classificacao_nome text,
  historico          text NOT NULL,
  valor_juros        numeric(14,2) NOT NULL CHECK (valor_juros > 0),
  responsavel        text,
  juros_status       text NOT NULL DEFAULT 'pendente_cobrar' CHECK (juros_status IN ('pendente_cobrar', 'cobrado')),
  juros_cobrado_em   timestamptz,
  juros_cobrado_por  uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (origem, linha_planilha)
);
ALTER TABLE public."FIN_JUROS_IMPORTADO" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_juros_importado_select ON public."FIN_JUROS_IMPORTADO";
CREATE POLICY fin_juros_importado_select ON public."FIN_JUROS_IMPORTADO" FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-controle-juros', 'visualizar'::public.app_acao));
-- Sem INSERT/UPDATE/DELETE para o app: escrita só por migration e pela RPC de "cobrado".
REVOKE ALL ON public."FIN_JUROS_IMPORTADO" FROM anon;

-- A planilha (linha = número da linha no Excel).
INSERT INTO public."FIN_JUROS_IMPORTADO" (origem, linha_planilha, numero, data_pagamento, classificacao_nome, historico, valor_juros, responsavel, juros_status)
SELECT 'Planilha 2026', v.linha, v.numero, v.data, v.classif, v.hist, v.valor, v.resp, v.status
  FROM (VALUES
  (6, 'JUROS-2026-001', DATE '2026-01-13', 'COMBUSTÍVEL', 'SUPORTE ADMINISTRADORA DE CONDOMINIOS', 12.79, NULL, 'pendente_cobrar'),
  (7, 'JUROS-2026-002', DATE '2026-01-16', 'SEGURO VEICULO', 'ALLIANZ SEGUROS FROTA', 21.04, NULL, 'pendente_cobrar'),
  (8, 'JUROS-2026-003', DATE '2026-01-19', 'FINANCIAMENTOS', 'GAV RESORTS - COTAS - BL 01-632-25 e BL 01-636-22', 31.88, NULL, 'pendente_cobrar'),
  (9, 'JUROS-2026-004', DATE '2026-01-19', 'CONDOMINIO', 'GUARIDA – CONDOMINIO ENZO', 11.86, NULL, 'pendente_cobrar'),
  (10, 'JUROS-2026-005', DATE '2026-01-19', 'CONDOMINIO', 'GUARIDA IMOVEIS - CONDOMINIO MURANO', 42.73, NULL, 'pendente_cobrar'),
  (11, 'JUROS-2026-006', DATE '2026-01-21', 'EPI''S', 'CLOVIS ATACADO NF-27414 ESTOQUE PARC-1', 4.64, NULL, 'pendente_cobrar'),
  (12, 'JUROS-2026-007', DATE '2026-01-21', 'SEGURO VEICULO', 'HDI SEGUROS - RANGER SENILTON', 28.43, NULL, 'pendente_cobrar'),
  (13, 'JUROS-2026-008', DATE '2026-02-11', 'SEGURO VEICULO', 'ALLIANZ SEGUROS FROTA', 7.90, NULL, 'pendente_cobrar'),
  (14, 'JUROS-2026-009', DATE '2026-02-24', 'SEGURO VEICULO', 'HDI SEGUROS - RANGER SENILTON', 35.75, NULL, 'pendente_cobrar'),
  (15, 'JUROS-2026-010', DATE '2026-02-25', 'SEGURO GARANTIA', 'SEGURO GARANTIA', 1.54, NULL, 'pendente_cobrar'),
  (16, 'JUROS-2026-011', DATE '2026-03-05', 'SEGURO GARANTIA', 'SEGURO GARANTIA', 2.17, NULL, 'pendente_cobrar'),
  (17, 'JUROS-2026-012', DATE '2026-03-11', 'SINDICATO', 'BENEFICIO SOCIAL FAMILIAR MES 02.2026', 655.49, NULL, 'pendente_cobrar'),
  (18, 'JUROS-2026-013', DATE '2026-03-13', 'SEGURO VEICULO', 'ALLIANZ SEGUROS FROTA', 13.15, NULL, 'pendente_cobrar'),
  (19, 'JUROS-2026-014', DATE '2026-03-17', 'MATERIAIS DE CONST.', 'COMPENSADOS LAJEADO NF-200472', 44.40, NULL, 'pendente_cobrar'),
  (20, 'JUROS-2026-015', DATE '2026-03-18', 'EPI''S', 'SUPPLIER NF 20954', 1.68, NULL, 'pendente_cobrar'),
  (21, 'JUROS-2026-016', DATE '2026-03-20', 'CONDOMINIO', 'CONDOMINIO EDIFICIO GALERIA CENTRAL', 73.03, NULL, 'pendente_cobrar'),
  (22, 'JUROS-2026-017', DATE '2026-03-20', 'SEGURO RESIDENCIAL', 'SEGURO CASA 22', 0.24, NULL, 'pendente_cobrar'),
  (23, 'JUROS-2026-018', DATE '2026-03-20', 'CONDOMINIO', 'CONDOMINIO EDIFICIO GALERIA CENTRAL – PRÉDIO MONTENEGRO', 73.03, NULL, 'pendente_cobrar'),
  (24, 'JUROS-2026-019', DATE '2026-03-20', 'SEGURO GARANTIA', 'SEGURO GARANTIA', 22.54, NULL, 'pendente_cobrar'),
  (25, 'JUROS-2026-020', DATE '2026-03-24', 'SEGURO VEICULO', 'HDI SEGUROS - RANGER SENILTON', 16.26, NULL, 'pendente_cobrar'),
  (26, 'JUROS-2026-021', DATE '2026-03-24', 'SEGURO VEICULO', 'BRADESCO SEGUROS PARC 10 HILUX CARLOS EDUARDO', 0.72, NULL, 'pendente_cobrar'),
  (27, 'JUROS-2026-022', DATE '2026-03-24', 'SEGURO VEICULO', 'HDI SEGUROS - RANGER SENILTON', 18.68, NULL, 'pendente_cobrar'),
  (28, 'JUROS-2026-023', DATE '2026-03-27', 'INSUMOS JARDINAGEM', 'PLANALTINA COMERCIO DE MATERIAL NF 49692 UFFS PASSO FUNDO', 5.50, NULL, 'pendente_cobrar'),
  (29, 'JUROS-2026-024', DATE '2026-03-31', 'INSUMOS JARDINAGEM', 'BRISTOL NF 162689', 26.53, NULL, 'pendente_cobrar'),
  (30, 'JUROS-2026-025', DATE '2026-04-13', 'INSUMOS JARDINAGEM', 'PLANALTO COMERCIO DE COMBUSTIVEIS LTDA NF 295460', 8.66, NULL, 'pendente_cobrar'),
  (31, 'JUROS-2026-026', DATE '2026-05-06', 'EPI''S', 'SUPPLIER COMÉRCIO DE FERRAGENS LTDA NF 21432', 0.87, NULL, 'pendente_cobrar'),
  (32, 'JUROS-2026-027', DATE '2026-05-06', 'EPI''S', 'SUPPLIER COMÉRCIO DE FERRAGENS LTDA NF 21433 UFFS LARANJEIRAS', 2.63, NULL, 'pendente_cobrar'),
  (33, 'JUROS-2026-028', DATE '2026-05-12', 'COMBUSTÍVEL', 'DIPOL POSTOS DE COMBUSTIVEIS LTDA NF 173244 UFFS LARANJEIRAS', 32.47, NULL, 'pendente_cobrar'),
  (34, 'JUROS-2026-029', DATE '2026-05-12', 'INSUMOS JARDINAGEM', 'WESCHENFELDER MAQUINAS E PNEUS LTDA ERECHIM', 1.08, NULL, 'pendente_cobrar'),
  (35, 'JUROS-2026-030', DATE '2026-05-21', 'PONTOS ELETRONICOS', 'NEXTI DESENVOLVIMENTO DE SISTEMAS LTDA', 5.44, NULL, 'pendente_cobrar'),
  (36, 'JUROS-2026-031', DATE '2026-05-22', 'SEGURO VEICULO', 'HDI SEGUROS - RANGER SENILTON', 30.87, NULL, 'pendente_cobrar'),
  (37, 'JUROS-2026-032', DATE '2026-05-26', 'EPI''S', 'COMPRA CERTA (CLOVIS ATACADO) NF 28090', 0.18, NULL, 'pendente_cobrar'),
  (38, 'JUROS-2026-033', DATE '2026-05-29', 'SEGURO DE VIDA - OPERACIONAL', 'BOLETO SEGURO DE VIDA', 492.17, NULL, 'pendente_cobrar'),
  (39, 'JUROS-2026-034', DATE '2026-06-09', 'INSUMOS JARDINAGEM', 'DIPOL POSTOS DE COMBUSTIVEIS LTDA NF 175162 UFFS LARANJEIRAS', 20.81, NULL, 'pendente_cobrar'),
  (40, 'JUROS-2026-035', DATE '2026-06-16', 'MATERIAIS', 'CRVR RESIDUOS NF 554', 746.93, NULL, 'pendente_cobrar'),
  (41, 'JUROS-2026-036', DATE '2026-06-18', 'COMBUSTÍVEL', 'SANDER COMERCIO DE COMBUSTIVEIS NF-5765', 27.90, NULL, 'pendente_cobrar'),
  (42, 'JUROS-2026-037', DATE '2026-07-14', 'PATRIMONIOS', 'BANCO VOLKSWAGEN S.A', 46.71, NULL, 'pendente_cobrar'),
  (43, 'JUROS-2026-038', DATE '2026-07-16', 'MANUTENÇÃO VEICULAR', 'ERLI AUTO PEÇAS LTDA NF 3697 - PAGO.pdf', 12.12, NULL, 'pendente_cobrar'),
  (44, 'JUROS-2026-039', DATE '2026-08-21', 'PONTOS ELETRONICOS', 'NEXTI DESENVOLVIMENTO DE SISTEMAS LTDA - GESTÃO DE COLABORADORES', 5.96, NULL, 'pendente_cobrar'),
  (45, 'JUROS-2026-040', DATE '2026-08-21', 'PONTOS ELETRONICOS', 'NEXTI DESENVOLVIMENTO DE SISTEMAS LTDA - LOCAÇÃO DE TERMINAL', 4.16, NULL, 'pendente_cobrar'),
  (46, 'JUROS-2026-041', DATE '2026-08-21', 'PONTOS ELETRONICOS', 'NEXTI DESENVOLVIMENTO DE SISTEMAS LTDA - REPARO DO DISPLAY RELOGIO', 1.29, NULL, 'pendente_cobrar'),
  (47, 'JUROS-2026-042', DATE '2026-08-21', 'PONTOS ELETRONICOS', 'NEXTI DESENVOLVIMENTO DE SISTEMAS LTDA', 5.05, NULL, 'pendente_cobrar'),
  (48, 'JUROS-2026-043', DATE '2026-09-24', 'MANUTENÇÃO VEICULAR', 'ERLI AUTO PEÇAS LTDA NF 3752-MANUTENÇÃO SIENA', 11.11, NULL, 'pendente_cobrar')
  ) AS v(linha, numero, data, classif, hist, valor, resp, status)
ON CONFLICT (origem, linha_planilha) DO NOTHING;

UPDATE public."FIN_JUROS_IMPORTADO" i
   SET classificacao_id = c.id
  FROM public.planejamento_orcamentario_classificacao c
 WHERE i.classificacao_id IS NULL AND upper(btrim(c.nome)) = upper(btrim(i.classificacao_nome));

-- A view da tela: o que já existia + a planilha. `origem` entra no FIM (CREATE OR REPLACE só aceita assim).
CREATE OR REPLACE VIEW public.v_controle_juros_malote WITH (security_invoker = true) AS
 SELECT d.id AS despesa_id, NULL::uuid AS parcela_id, d.numero, d.data_pagamento, d.classificacao_id,
        cl.nome AS classificacao_nome, d.nome AS nome_despesa, d.valor_juros, d.created_by AS solicitante_id,
        COALESCE(p.display_name, p.email) AS solicitante_nome, d.juros_status, d.juros_cobrado_em,
        NULL::integer AS numero_parcela, NULL::integer AS numero_parcelas, 'despesa'::text AS origem
   FROM public.malote_despesa d
   LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
   LEFT JOIN public.profiles p ON p.id = d.created_by
  WHERE d.valor_juros IS NOT NULL AND d.valor_juros > 0 AND NOT d.parcelado
UNION ALL
 SELECT d.id, mp.id, d.numero, mp.data_pagamento_real, d.classificacao_id,
        cl.nome, d.nome, mp.valor_juros, d.created_by,
        COALESCE(p.display_name, p.email), mp.juros_status, mp.juros_cobrado_em,
        mp.numero_parcela, d.numero_parcelas, 'parcela'::text
   FROM public.malote_despesa_parcela mp
   JOIN public.malote_despesa d ON d.id = mp.despesa_id
   LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
   LEFT JOIN public.profiles p ON p.id = d.created_by
  WHERE mp.valor_juros IS NOT NULL AND mp.valor_juros > 0
UNION ALL
 SELECT i.id, NULL::uuid, i.numero, i.data_pagamento, i.classificacao_id,
        COALESCE(cl.nome, i.classificacao_nome), i.historico, i.valor_juros, NULL::uuid,
        i.responsavel, i.juros_status, i.juros_cobrado_em,
        NULL::integer, NULL::integer, 'planilha'::text
   FROM public."FIN_JUROS_IMPORTADO" i
   LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = i.classificacao_id;

CREATE OR REPLACE FUNCTION public.malote_juros_marcar_cobrado(_origem text, _id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-controle-juros', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o Controle de Juros.';
  END IF;
  IF _origem NOT IN ('despesa', 'parcela', 'planilha') THEN
    RAISE EXCEPTION 'Origem inválida: %', _origem;
  END IF;

  IF _origem = 'despesa' THEN
    UPDATE public.malote_despesa
    SET juros_status = 'cobrado', juros_cobrado_em = now(), juros_cobrado_por = auth.uid()
    WHERE id = _id AND juros_status = 'pendente_cobrar';
  ELSIF _origem = 'parcela' THEN
    UPDATE public.malote_despesa_parcela
    SET juros_status = 'cobrado', juros_cobrado_em = now(), juros_cobrado_por = auth.uid()
    WHERE id = _id AND juros_status = 'pendente_cobrar';
  ELSE
    -- 15/10/2026: juros importados de planilha (FIN_JUROS_IMPORTADO).
    UPDATE public."FIN_JUROS_IMPORTADO"
    SET juros_status = 'cobrado', juros_cobrado_em = now(), juros_cobrado_por = auth.uid()
    WHERE id = _id AND juros_status = 'pendente_cobrar';
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro não encontrado ou já cobrado.';
  END IF;
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (recriar v_controle_juros_malote sem o 3º bloco: DROP VIEW + CREATE — a coluna origem não sai com CREATE OR REPLACE)
-- (reaplicar malote_juros_marcar_cobrado só com 'despesa'/'parcela')
-- DROP TABLE IF EXISTS public."FIN_JUROS_IMPORTADO";
-- NOTIFY pgrst, 'reload schema';
