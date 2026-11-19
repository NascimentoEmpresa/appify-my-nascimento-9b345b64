-- SIS-2026-0956: OSC Canaã — despesas de agosto e setembro/2026 vindas da
-- planilha (não há malote no ERP para esses meses).
--
-- ONDE ENTRA: no mesmo formato em que janeiro a julho já entraram na carga
-- da SIS-2026-0922 (20261117092200), sem tabela nova e sem mudança na tela:
--   * "OSC_LANCAMENTO" tipo 'historico', 1 linha por rubrica × mês, com a
--     célula de origem em origem_ref ('Planilha: Projeção!J8' ...);
--   * "OSC_COMPETENCIA" de ago/set com fonte_realizado = 'historico' e
--     situacao = 'fechada'.
--   Com a fonte 'historico' o realizado do mês vem destes lançamentos e o
--   que houver no Malote para o mês NÃO soma (só aparece na conciliação
--   "pago no Malote") — então não há como contar duas vezes. Se um dia o
--   Malote de ago/set for lançado, basta trocar a fonte do mês para Malote
--   na aba Competências.
--   Fechar o mês importa: aberto e atrasado, a tela usaria
--   max(realizado, previsto) por rubrica, misturando com a previsão antiga
--   (os valores de ago/set digitados na carga da 0922 continuam como
--   "previsto" do mês, só para comparação).
--   Efeito colateral esperado: com ago/set fechados, o custo de referência
--   de out–dez passa a usar setembro (critério "último realizado") e a
--   média de jan–set (critério "média") — é a regra da tela.
--
-- FONTE: Canaa_Previsao_Investimentos.xlsx, aba "Projeção", colunas J (Ago)
--   e K (Set), linhas 8 a 41. Célula vazia ou zero não vira lançamento (o
--   CHECK valor <> 0 não deixaria). 42 lançamentos 'historico' (24 em
--   agosto, 18 em setembro) + 1 resgate em agosto. Conferência no fim.
--
-- DECISÕES QUE PRECISAM DE CONFIRMAÇÃO (anotadas na entrega):
--   1. Agosto: a planilha tira Rescisão (J27, R$ 15.303,67) e FGTS rescisão
--      (J22, R$ 6.457,71) do total do mês (J43 = SUM(J8:J41) − J27 − J22).
--      Aqui as duas entram como despesa (são gasto real) e entra um RESGATE
--      da aplicação de R$ 21.761,38 no mesmo mês — o jeito que a tela tem de
--      dizer "pago com o dinheiro da reserva". Resultado: sobra de agosto
--      R$ 2.210,65, igual à planilha. Se não foi resgate, apagar a linha
--      origem_ref = 'Planilha: Projeção!J43 (resgate)'.
--   2. Células que são FÓRMULA na planilha, não valor digitado — agosto:
--      Aluguel (=$S12, custo de referência), Internet (=$S13), Férias
--      (=$S35, é a MÉDIA jan–jul, R$ 1.063,32 — provável estimativa) e
--      Aplicação (= julho); setembro: Aplicação (=$S41). Entraram como
--      estão (é o que a planilha soma); a descrição de cada uma avisa.
--   3. Repasse recebido de ago/set: a planilha assume o repasse mensal
--      (J44/K44 = $C$4 = R$ 91.883,96), como na carga de jan–jul. Só é
--      gravado se o mês ainda não tiver repasse recebido informado.
--   4. A aba "Planilha1" (rascunho: jovens aprendizes de OUTUBRO e uma lista
--      sem mês — aluguel 250, torta, flores...) não foi importada.
--
-- IDEMPOTENTE: lançamento só entra se não existir outro da mesma parceria
-- com a mesma competência + origem_ref; a competência usa ON CONFLICT.
-- Reaplicar não duplica nada. Lote fixo para achar/desfazer a carga:
-- lote_importacao = '09560956-0956-4956-8956-095609560956'.

DO $$
DECLARE
  v_par uuid;
  v_lote constant uuid := '09560956-0956-4956-8956-095609560956';
  v_faltando text;
BEGIN
  SELECT id INTO v_par
    FROM public."OSC_PARCERIA"
   ORDER BY (nome = 'OSC Canaã — Escola Infantil') DESC, ativo DESC, created_at
   LIMIT 1;
  IF v_par IS NULL THEN
    RAISE NOTICE 'SIS-2026-0956: nenhuma parceria OSC cadastrada — nada a importar.';
    RETURN;
  END IF;

  CREATE TEMP TABLE _osc_0956 (
    mes int, rubrica text, categoria text, valor numeric(14,2), origem text, obs text
  ) ON COMMIT DROP;

  INSERT INTO _osc_0956 (mes, rubrica, categoria, valor, origem, obs) VALUES
      (8, 'Salários', 'Salários', 33686.19, 'Projeção!J8', NULL),
      (9, 'Salários', 'Salários', 34233.98, 'Projeção!K8', NULL),
      (8, 'FGTS mensal', 'FGTS MENSAL', 4181.62, 'Projeção!J9', NULL),
      (9, 'FGTS mensal', 'FGTS MENSAL', 4322.64, 'Projeção!K9', NULL),
      (8, 'INSS mensal', 'INSS MENSAL', 11583.73, 'Projeção!J10', NULL),
      (9, 'INSS mensal', 'INSS MENSAL', 8508.68, 'Projeção!K10', NULL),
      (8, 'Vale-transporte', 'Vale-transporte', 3225.20, 'Projeção!J11', NULL),
      (9, 'Vale-transporte', 'Vale-transporte', 2909.20, 'Projeção!K11', NULL),
      (8, 'Aluguel', 'Aluguel', 5113.73, 'Projeção!J12', 'célula com fórmula na planilha: =$S12'),
      (9, 'Aluguel', 'Aluguel', 6045.00, 'Projeção!K12', NULL),
      (8, 'Internet', 'Internet', 149.90, 'Projeção!J13', 'célula com fórmula na planilha: =$S13'),
      (9, 'Internet', 'Internet', 153.25, 'Projeção!K13', NULL),
      (8, 'Água', 'Água', 475.32, 'Projeção!J14', NULL),
      (9, 'Água', 'Água', 462.98, 'Projeção!K14', NULL),
      (8, 'Luz', 'Luz', 849.27, 'Projeção!J15', NULL),
      (9, 'Luz', 'Luz', 754.50, 'Projeção!K15', NULL),
      (8, 'Seguro de vida', 'SEGURO DE VIDA', 380.12, 'Projeção!J16', NULL),
      (8, 'Manutenção', 'Manutenção', 550.00, 'Projeção!J17', NULL),
      (9, 'Manutenção', 'Manutenção', 2055.90, 'Projeção!K17', NULL),
      (8, 'Tarifas bancárias', 'TARIFA', 192.84, 'Projeção!J19', NULL),
      (9, 'Tarifas bancárias', 'TARIFA', 187.21, 'Projeção!K19', NULL),
      (8, 'Tarifa Pix', 'TARIFA PIX', 401.80, 'Projeção!J20', NULL),
      (8, 'FGTS rescisão', 'FGTS RESCISAO', 6457.71, 'Projeção!J22', NULL),
      (9, 'FGTS rescisão', 'FGTS RESCISAO', 1983.80, 'Projeção!K22', NULL),
      (8, 'Avante', 'AVANTE', 884.98, 'Projeção!J24', NULL),
      (9, 'Avante', 'AVANTE', 842.95, 'Projeção!K24', NULL),
      (8, 'Material pedagógico', 'MATERIAL PEDAGOGICO', 4332.11, 'Projeção!J25', NULL),
      (9, 'Material pedagógico', 'MATERIAL PEDAGOGICO', 1601.23, 'Projeção!K25', NULL),
      (8, 'Rescisão', 'RESCISAO', 15303.67, 'Projeção!J27', NULL),
      (9, 'Rescisão', 'RESCISAO', 9433.10, 'Projeção!K27', NULL),
      (8, 'Serviço de nutrição', 'Nutrição', 1442.50, 'Projeção!J30', NULL),
      (8, 'Alimentação', 'ALIMENTACAO', 468.52, 'Projeção!J32', NULL),
      (9, 'Alimentação', 'ALIMENTACAO', 468.52, 'Projeção!K32', NULL),
      (8, 'Despesas diretas', 'DESPESAS DIRETAS', 2725.48, 'Projeção!J33', NULL),
      (9, 'Despesas diretas', 'DESPESAS DIRETAS', 6210.86, 'Projeção!K33', NULL),
      (8, 'Diárias', 'DIARIA', 2330.00, 'Projeção!J34', NULL),
      (9, 'Diárias', 'DIARIA', 200.00, 'Projeção!K34', NULL),
      (8, 'Férias', 'FERIAS', 1063.32, 'Projeção!J35', 'célula com fórmula na planilha: =$S35'),
      (8, 'Recolhimento de débito', 'RECOLHIMENTO DE DEBITO', 1316.94, 'Projeção!J36', NULL),
      (8, 'IPTU', 'IPTU', 19.74, 'Projeção!J37', NULL),
      (8, 'Aplicação para férias e 13º', 'Aplicação para férias e 13º', 14300.00, 'Projeção!J41', 'célula com fórmula na planilha: =SUMIFS(Base!$E$5:$E$143,Base!$B$5:$B$143,7,Base!$D$5:$D$143,$B41)'),
      (9, 'Aplicação para férias e 13º', 'Aplicação para férias e 13º', 14300.00, 'Projeção!K41', 'célula com fórmula na planilha: =$S41');

  -- Toda rubrica da planilha tem que existir (por nome, ignorando acento/
  -- caixa). Se alguém renomeou uma, a carga NÃO entra (nem pela metade) e
  -- avisa — WARNING e não EXCEPTION para não travar a fila de migrations do
  -- time (guardião M6); reaplicar à mão depois de corrigir o nome.
  SELECT string_agg(DISTINCT x.rubrica, ', ') INTO v_faltando
    FROM _osc_0956 x
   WHERE NOT EXISTS (SELECT 1 FROM public."OSC_RUBRICA" r
                      WHERE r.parceria_id = v_par
                        AND public.osc_normalizar(r.nome) = public.osc_normalizar(x.rubrica));
  IF v_faltando IS NOT NULL THEN
    RAISE WARNING 'SIS-2026-0956: rubrica(s) da planilha sem cadastro na OSC: % — nada importado.', v_faltando;
    RETURN;
  END IF;

  -- Competências: fechadas, realizado = histórico importado.
  INSERT INTO public."OSC_COMPETENCIA" AS c
         (parceria_id, competencia, repasse_recebido, situacao, fonte_realizado, observacao)
  SELECT v_par, make_date(2026, v.m, 1), 91883.96, 'fechada', 'historico',
         'SIS-2026-0956: realizado de ' || CASE v.m WHEN 8 THEN 'agosto' ELSE 'setembro' END
         || ' importado da planilha (aba Projeção) — não há malote no ERP para o mês.'
    FROM (VALUES (8), (9)) AS v(m)
  ON CONFLICT (parceria_id, competencia) DO UPDATE
     SET situacao = 'fechada',
         fonte_realizado = 'historico',
         repasse_recebido = COALESCE(c.repasse_recebido, EXCLUDED.repasse_recebido),
         observacao = COALESCE(c.observacao, EXCLUDED.observacao);

  -- Despesas e aplicação do mês.
  INSERT INTO public."OSC_LANCAMENTO"
         (parceria_id, competencia, rubrica_id, tipo, valor, descricao, origem_ref, lote_importacao)
  SELECT v_par, make_date(2026, x.mes, 1), r.id, 'historico', x.valor,
         x.categoria || COALESCE(' (' || x.obs || ')', ''),
         'Planilha: ' || x.origem, v_lote
    FROM _osc_0956 x
    JOIN public."OSC_RUBRICA" r
      ON r.parceria_id = v_par AND public.osc_normalizar(r.nome) = public.osc_normalizar(x.rubrica)
   WHERE NOT EXISTS (SELECT 1 FROM public."OSC_LANCAMENTO" l
                      WHERE l.parceria_id = v_par
                        AND l.competencia = make_date(2026, x.mes, 1)
                        AND l.origem_ref = 'Planilha: ' || x.origem);

  -- Agosto: rescisão + FGTS rescisão pagos com a reserva (ver decisão 1).
  INSERT INTO public."OSC_LANCAMENTO"
         (parceria_id, competencia, rubrica_id, tipo, valor, descricao, origem_ref, lote_importacao)
  SELECT v_par, DATE '2026-08-01', r.id, 'resgate', 21761.38,
         'Resgate da aplicação para Rescisão (R$ 15.303,67) e FGTS rescisão (R$ 6.457,71) de agosto — a planilha tira os dois do total do mês (J43 = soma − J27 − J22). Confirmar.',
         'Planilha: Projeção!J43 (resgate)', v_lote
    FROM public."OSC_RUBRICA" r
   WHERE r.parceria_id = v_par AND r.tipo = 'reserva'
     AND public.osc_normalizar(r.nome) = public.osc_normalizar('Aplicação para férias e 13º')
     AND NOT EXISTS (SELECT 1 FROM public."OSC_LANCAMENTO" l
                      WHERE l.parceria_id = v_par AND l.competencia = DATE '2026-08-01'
                        AND l.origem_ref = 'Planilha: Projeção!J43 (resgate)');
END $$;

-- Conferência (planilha × banco), por mês:
--   agosto   : 24 lançamentos 'historico' = R$ 111.434,69 (despesas 97.134,69
--              + aplicação 14.300,00) e 1 resgate de 21.761,38
--              → saídas − resgate = 89.673,31 = Projeção!J43
--              → sobra do mês 91.883,96 − 89.673,31 = 2.210,65 = Projeção!J45
--   setembro : 18 lançamentos 'historico' = R$ 94.673,80 (despesas 80.373,80
--              + aplicação 14.300,00) = Projeção!K43
--              → sobra −2.789,84 = Projeção!K45
--
-- Só dados, sem mudança de schema — não precisa de NOTIFY pgrst.
--
-- ROLLBACK
-- DELETE FROM public."OSC_LANCAMENTO" WHERE lote_importacao = '09560956-0956-4956-8956-095609560956';
-- UPDATE public."OSC_COMPETENCIA" SET situacao = 'aberta', fonte_realizado = 'malote'
--  WHERE competencia IN ('2026-08-01','2026-09-01');
