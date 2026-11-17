import { describe, it, expect } from "vitest";
import {
  numeroOuNulo, somaOuNulo, componentesDaParcela, segurosDe, situacaoDa, valorPagoDa,
  resolverParcelas, resumoDoPeriodo, saldoDeReferencia, evolucaoDoSaldo, noPeriodo, fimDoPeriodo,
  opcoesDePeriodo, rotuloPeriodo, fatorDoIndice, rotuloIndice, calcularIncc, historicoIncc,
  campoDoDetalhe, lerImportacao, planejarImportacao, csvDasParcelas, dataOuNulo,
  type ParcelaFinanciamento,
} from "@/pages/juridico/patrimonio/financiamento";

// Caso do chamado SIS-2026-0909: CASA DO SENILTON, demonstrativo CAIXA,
// parcela 83 (06/03/2026). Números da imagem de referência.
const p83: ParcelaFinanciamento = {
  id: 83, numero: 83, vencimento: "2026-03-06", data_pagamento: "2026-03-06",
  valor: 2370.11, valor_pago: 2370.11,
  amortizacao: 601.06, juros: 1692.01, seguro_mip: 24.58, seguro_dfi: 27.46, seguros_fghab: 52.04,
  seguros_fghab_subtotal: true, taxas: 25, valor_fcvs: 0, fgts_utilizado: 0,
  encargo_liquido: 2370.11, valor_impontualidade: 0, diferenca_valor: 0,
  atualizacao_monetaria: 253.34, saldo_anterior: 206979.09, saldo_devedor: 206631.37,
  indice_correcao: 1.00122401, indice_tipo: "fator",
};
const p82: ParcelaFinanciamento = {
  id: 82, numero: 82, vencimento: "2026-02-06", valor: 2375.4, valor_pago: 2375.4,
  amortizacao: 600.1, juros: 1700.2, seguros_fghab: 50.1, taxas: 25,
  atualizacao_monetaria: 240.5, saldo_devedor: 206979.09,
};
const p84: ParcelaFinanciamento = { id: 84, numero: 84, vencimento: "2026-04-06", valor: 2360, projetado: true };

describe("números: não informado ≠ zero", () => {
  it("lê formatos pt-BR e de banco", () => {
    expect(numeroOuNulo("2.370,11")).toBe(2370.11);
    expect(numeroOuNulo("R$ -347,72")).toBe(-347.72);
    expect(numeroOuNulo("1,00122401")).toBe(1.00122401);
    expect(numeroOuNulo("2370.11")).toBe(2370.11);
    expect(numeroOuNulo("1.234.567")).toBe(1234567);
    expect(numeroOuNulo("(10,50)")).toBe(-10.5);
    expect(numeroOuNulo(0)).toBe(0);
  });
  it("vazio, traço e lixo são null, nunca 0", () => {
    for (const v of ["", " ", "—", "-", null, undefined, "abc"]) expect(numeroOuNulo(v)).toBeNull();
  });
  it("soma sem nenhum valor informado é null", () => {
    expect(somaOuNulo([null, undefined])).toBeNull();
    expect(somaOuNulo([null, 0])).toBe(0);
    expect(somaOuNulo([0.1, 0.2])).toBe(0.3);
  });
});

describe("composição da parcela", () => {
  it("Seguros / FGHAB como subtotal de MIP + DFI não é somado de novo", () => {
    expect(componentesDaParcela(p83).seguros).toBe(52.04);
    expect(segurosDe({ seguro_mip: 24.58, seguro_dfi: 27.46, seguros_fghab: null })).toBe(52.04);
    expect(segurosDe({ seguro_mip: 24.58, seguro_dfi: 27.46, seguros_fghab: 10 }, false)).toBe(62.04);
    expect(segurosDe({ seguro_mip: null, seguro_dfi: null, seguros_fghab: null })).toBeNull();
  });

  it("lê a composição das colunas soltas da planilha antiga", () => {
    const c = componentesDaParcela({ id: 1, valor: 18463.5, detalhes: { "JURO": 130.17, "INCC DO MÊS": 0.0058, "Tipo": "Ato" } });
    expect(c.juros).toBe(130.17);
    // Célula de % do Excel: 0,0058 = 0,58% (não "R$ 0,01").
    expect(c.indice_correcao).toBe(0.58);
    expect(c.indice_tipo).toBe("percentual");
    expect(c.daPlanilha).toBe(true);
  });

  it("o cadastro estruturado vence a planilha", () => {
    const c = componentesDaParcela({ id: 1, juros: 100, detalhes: { "JURO": 130.17 } });
    expect(c.juros).toBe(100);
    expect(c.daPlanilha).toBe(false);
  });

  it("classifica as colunas da planilha", () => {
    expect(campoDoDetalhe("JUROS DE MORA")).toBe("valor_impontualidade");
    expect(campoDoDetalhe("Juros")).toBe("juros");
    expect(campoDoDetalhe("TX ADM")).toBe("taxas");
    expect(campoDoDetalhe("Saldo anterior")).toBe("saldo_anterior");
    expect(campoDoDetalhe("SALDO DEVEDOR")).toBe("saldo_devedor");
    expect(campoDoDetalhe("MPI")).toBe("seguro_mip");
    expect(campoDoDetalhe("Valor FCVS")).toBe("valor_fcvs");
    expect(campoDoDetalhe("Tipo")).toBeNull();
  });
});

describe("pagamento e situação", () => {
  const hoje = "2026-11-16";
  it("parcela 83 paga em dia é PAGA", () => {
    expect(situacaoDa(p83, [], hoje)).toBe("PAGA");
  });
  it("vários pagamentos somam; abaixo do devido é PARCIAL", () => {
    const pags = [
      { parcela_id: 84, data_pagamento: "2026-04-06", valor: 1000 },
      { parcela_id: 84, data_pagamento: "2026-04-20", valor: 500 },
    ];
    const p = { ...p84, projetado: false };
    expect(valorPagoDa(p, pags)).toBe(1500);
    expect(situacaoDa(p, pags, hoje)).toBe("PARCIAL");
    expect(situacaoDa(p, [...pags, { parcela_id: 84, data_pagamento: "2026-05-01", valor: 860 }], hoje)).toBe("PAGA");
  });
  it("diferença de valor ou pago acima do devido vai para conferência", () => {
    expect(situacaoDa({ ...p83, diferenca_valor: -3.2 }, [], hoje)).toBe("A CONFERIR");
    expect(situacaoDa({ ...p83, valor_pago: 2400 }, [], hoje)).toBe("A CONFERIR");
  });
  it("sem pagamento: projetada, vencida ou em aberto", () => {
    expect(situacaoDa(p84, [], hoje)).toBe("PROJETADA");
    expect(situacaoDa({ ...p84, projetado: false }, [], hoje)).toBe("VENCIDA");
    expect(situacaoDa({ ...p84, projetado: false, vencimento: "2027-01-06" }, [], hoje)).toBe("EM ABERTO");
  });
  it("baixa pelas contas (Malote) sem valor pago conta o devido", () => {
    const p = { id: 9, valor: 4166.66, vencimento: "2026-09-30", baixa: "malote" };
    expect(valorPagoDa(p)).toBe(4166.66);
    expect(situacaoDa(p, [], hoje)).toBe("PAGA");
  });
});

describe("resumo do período", () => {
  const hoje = "2026-11-16";
  const todas = [p82, p83, p84];
  const linhas = resolverParcelas(todas, [], hoje);

  it("março/2026 bate com o demonstrativo", () => {
    const r = resumoDoPeriodo(linhas.filter(l => noPeriodo(l.p.vencimento, "2026-03")), hoje);
    expect(r.pago).toBe(2370.11);
    expect(r.amortizacao).toBe(601.06);
    expect(r.juros).toBe(1692.01);
    expect(r.segurosETaxas).toBe(77.04);   // 52,04 + 25,00
    expect(r.correcao).toBe(253.34);
  });

  it("componente que ninguém informou fica null (A apurar)", () => {
    const r = resumoDoPeriodo(resolverParcelas([{ id: 1, valor: 100, valor_pago: 100, vencimento: "2026-01-01" }], [], hoje), hoje);
    expect(r.pago).toBe(100);
    expect(r.amortizacao).toBeNull();
    expect(r.correcao).toBeNull();
  });

  it("separa vencido em aberto da projeção futura", () => {
    const ls = resolverParcelas([
      { id: 1, valor: 100, vencimento: "2026-10-01" },
      { id: 2, valor: 200, vencimento: "2026-12-01" },
      { id: 3, valor: 300, vencimento: "2026-09-01", valor_pago: 300 },
    ], [], hoje);
    const r = resumoDoPeriodo(ls, hoje);
    expect(r.vencidoEmAberto).toBe(100);
    expect(r.futuro).toBe(200);
  });
});

describe("saldo devedor", () => {
  const todas = [p82, p83, p84];
  it("saldo de referência é o da última parcela do período, com data", () => {
    expect(saldoDeReferencia(todas, "2026-03")).toEqual({ valor: 206631.37, data: "2026-03-06", origem: "Após a parcela 83", projetado: false });
    expect(saldoDeReferencia(todas, "2026-02")?.valor).toBe(206979.09);
  });
  it("sem saldo nas parcelas, usa o informado no contrato", () => {
    expect(saldoDeReferencia([p84], "", { saldo_devedor_informado: 150000, saldo_devedor_data: "2026-10-27" }))
      .toEqual({ valor: 150000, data: "2026-10-27", origem: "Informado no contrato", projetado: false });
    expect(saldoDeReferencia([p84], "")).toBeNull();
  });
  it("evolução da parcela 83: redução líquida de R$ 347,72", () => {
    const e = evolucaoDoSaldo([p83], todas)!;
    expect(e.saldoAnterior).toBe(206979.09);
    expect(e.atualizacao).toBe(253.34);
    expect(e.amortizacao).toBe(601.06);
    expect(e.saldoApos).toBe(206631.37);
    expect(e.variacao).toBe(-347.72);
    expect(e.divergencia).toBeNull();
  });
  it("sem saldo anterior na linha, pega o saldo da parcela de antes", () => {
    const e = evolucaoDoSaldo([{ ...p83, saldo_anterior: null }], todas)!;
    expect(e.saldoAnterior).toBe(206979.09);
  });
  it("aponta divergência quando o saldo informado não fecha a conta", () => {
    const e = evolucaoDoSaldo([{ ...p83, saldo_devedor: 206700 }], todas)!;
    expect(e.divergencia).toBe(68.63);
  });
  it("calcula o saldo após quando o documento não o traz", () => {
    const e = evolucaoDoSaldo([{ ...p83, saldo_devedor: null }], todas)!;
    expect(e.saldoApos).toBe(206631.37);
  });
});

describe("período", () => {
  it("filtra por mês, ano ou contrato todo", () => {
    expect(noPeriodo("2026-03-06", "2026-03")).toBe(true);
    expect(noPeriodo("2026-03-06", "2026")).toBe(true);
    expect(noPeriodo("2026-03-06", "2025")).toBe(false);
    expect(noPeriodo(null, "")).toBe(true);
  });
  it("fim do período e rótulos", () => {
    expect(fimDoPeriodo("2026-02")).toBe("2026-02-28");
    expect(fimDoPeriodo("2024-02")).toBe("2024-02-29");
    expect(fimDoPeriodo("2026")).toBe("2026-12-31");
    expect(fimDoPeriodo("")).toBeNull();
    expect(rotuloPeriodo("2026-03")).toBe("Março/2026");
    expect(rotuloPeriodo("")).toBe("Contrato inteiro");
  });
  it("opções: cada ano seguido dos seus meses", () => {
    expect(opcoesDePeriodo([{ vencimento: "2026-02-06" }, { vencimento: "2025-12-06" }, { vencimento: "2026-03-06" }]))
      .toEqual(["2025", "2025-12", "2026", "2026-02", "2026-03"]);
  });
});

describe("índice e INCC", () => {
  it("percentual x fator", () => {
    expect(fatorDoIndice(0.58, "percentual")).toBeCloseTo(1.0058, 10);
    expect(fatorDoIndice(1.00122401, "fator")).toBe(1.00122401);
    expect(rotuloIndice(1.00122401, "fator")).toBe("1,00122401");
    expect(rotuloIndice(0.58, "percentual")).toBe("0,5800%");
    expect(rotuloIndice(null, "fator")).toBeNull();
  });
  it("correção do INCC sobre a base, pelo % ou pelo fator", () => {
    expect(calcularIncc(100000, { percentual: 0.58 })).toEqual({ fator: 1.0058, correcao: 580, corrigido: 100580 });
    expect(calcularIncc(206979.09, { fator: 1.00122401 })?.correcao).toBe(253.34);   // = demonstrativo
    expect(calcularIncc(null, { percentual: 1 })).toBeNull();
    expect(calcularIncc(1000, {})).toBeNull();
  });
  it("histórico em ordem de competência com acumulado", () => {
    const h = historicoIncc([
      { competencia: "2026-02-01", valor_anterior: 100580, valor_corrigido: 101083 },
      { competencia: "2026-01-01", base_calculo: 100000, percentual_aplicado: 0.58 },
      { competencia: "2026-03-01", correcao: 120.5 },
    ]);
    expect(h.map(x => x.competencia)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(h.map(x => x.correcaoValor)).toEqual([580, 503, 120.5]);
    expect(h.map(x => x.acumulado)).toEqual([580, 1083, 1203.5]);
  });
});

describe("importação colada do Excel / CSV", () => {
  it("lê tabulação com cabeçalho e números pt-BR", () => {
    const txt = [
      "Demonstrativo CAIXA",
      "Parcela\tVencimento\tValor devido\tAmortização\tJuros\tMPI\tDFI\tSeguros / FGHAB\tTaxas\tValor pago\tAtualização monetária\tSaldo devedor\tÍndice\tColuna estranha",
      "83\t06/03/2026\t2.370,11\t601,06\t1.692,01\t24,58\t27,46\t52,04\t25,00\t2.370,11\t253,34\t206.631,37\t1,00122401\tx",
      "",
    ].join("\n");
    const r = lerImportacao(txt);
    expect(r.erros).toEqual([]);
    expect(r.ignoradas).toEqual(["Coluna estranha"]);
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({
      numero: 83, vencimento: "2026-03-06", valor: 2370.11, amortizacao: 601.06, juros: 1692.01,
      seguro_mip: 24.58, seguro_dfi: 27.46, seguros_fghab: 52.04, taxas: 25, valor_pago: 2370.11,
      atualizacao_monetaria: 253.34, saldo_devedor: 206631.37, indice_correcao: 1.00122401,
    });
  });
  it("CSV com ponto e vírgula e aspas; data inválida vira erro, não lixo", () => {
    const r = lerImportacao('Nº;Vencimento;Juros\n1;"01/2026";"1.000,50"\n2;31/13/x;10');
    expect(r.linhas[0]).toMatchObject({ numero: 1, vencimento: "2026-01-01", juros: 1000.5 });
    expect(r.erros.some(e => e.includes("31/13/x"))).toBe(true);
  });
  it("sem cabeçalho reconhecível avisa", () => {
    expect(lerImportacao("a;b\n1;2").erros[0]).toMatch(/cabeçalho/);
  });
  it("datas aceitas", () => {
    expect(dataOuNulo("6/3/26")).toBe("2026-03-06");
    expect(dataOuNulo("2026-03-06T00:00")).toBe("2026-03-06");
    expect(dataOuNulo("x")).toBeNull();
  });
  it("casa por número, depois por mês; o resto vira parcela nova", () => {
    const existentes: ParcelaFinanciamento[] = [
      { id: 10, numero: 83, vencimento: "2026-03-06" },
      { id: 11, rotulo: "REFORÇO", vencimento: "2026-05-10" },
    ];
    const plano = planejarImportacao([
      { numero: 83, juros: 1692.01 },
      { vencimento: "2026-05-10", valor: 50000 },
      { numero: 84, vencimento: "2026-04-06", valor: 2360 },
    ], existentes);
    expect(plano.atualizar.map(a => a.id)).toEqual([10, 11]);
    expect(plano.atualizar[0].dados).toEqual({ numero: 83, juros: 1692.01 });
    expect(plano.inserir).toEqual([{ numero: 84, vencimento: "2026-04-06", valor: 2360 }]);
  });
});

describe("exportação", () => {
  it("CSV com ; e vírgula decimal, campos vazios em branco", () => {
    const csv = csvDasParcelas(resolverParcelas([p83, p84], [], "2026-11-16"));
    const [cab, l1, l2] = csv.split("\n");
    expect(cab.startsWith("Parcela;Vencimento;Valor devido;Amortização;Juros")).toBe(true);
    expect(l1.startsWith("83ª;2026-03-06;2370,11;601,06;1692,01")).toBe(true);
    expect(l1).toContain("1,00122401");
    expect(l2).toContain("PROJETADA;Projetado");
    expect(l2.split(";")[3]).toBe("");   // amortização não informada: vazio, não 0
  });
});
