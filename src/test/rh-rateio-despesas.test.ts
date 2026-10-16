import { describe, expect, it } from "vitest";
import {
  acharContrato, calcularRateio, cpfValido, distribuirCentavos, extrairLinhasComCpf,
  extrairLinhasPorContrato, lerMoeda, lerPlanilhaJusBrasil, normContrato, resumirRateio,
  somarPorContrato, type ItemRateio,
} from "@/lib/rh/rateioDespesas";

const item = (nome: string, base: number, extra: Partial<ItemRateio> = {}): ItemRateio => ({
  contrato_id: nome, contrato_nome: nome, base, percentual: 0, valor: 0, ajustado: false, ...extra,
});

describe("distribuirCentavos", () => {
  it("soma sempre o total, pelo maior resto", () => {
    const r = distribuirCentavos(100, [1, 1, 1]);
    expect(r).toEqual([33.34, 33.33, 33.33]);
    expect(r.reduce((a, x) => a + x, 0)).toBeCloseTo(100, 10);
  });
  it("base zero ou negativa não recebe nada", () => {
    expect(distribuirCentavos(10, [0, 5, -3, 5])).toEqual([0, 5, 0, 5]);
  });
  it("todas as bases zeradas → tudo zero", () => {
    expect(distribuirCentavos(10, [0, 0])).toEqual([0, 0]);
  });
  it("muitos itens pequenos fecham o total", () => {
    const bases = Array.from({ length: 87 }, (_, i) => (i % 7) * 1234.56 + 0.01);
    const r = distribuirCentavos(1079.1, bases);
    expect(Math.round(r.reduce((a, x) => a + x, 0) * 100)).toBe(107910);
  });
});

describe("Jus Brasil — mesma conta da planilha", () => {
  // Trecho real da planilha Rateio_Atualizada.xlsx (valor H3 = 1.079,10 e
  // faturamento total C97 = 8.551.570,79). Na planilha, E = H3 × C / C97.
  const TOTAL_PLANILHA = 8551570.787333334;
  it("o contrato recebe valor × faturamento / faturamento total", () => {
    const itens = [
      item("UFRGS - LIMPEZA GERAL - 047/2022", 1288596.04),
      item("PREF POA SMS RECEPÇÃO - 98672/2025", 837238.77),
      item("RESTO", TOTAL_PLANILHA - 1288596.04 - 837238.77),
    ];
    const r = calcularRateio(1079.1, itens);
    expect(r[0].valor).toBe(162.6); // planilha: R$ 162,60
    expect(r[1].valor).toBe(105.65); // planilha: R$ 105,65
    expect(r[0].percentual).toBeCloseTo(0.1507, 4); // planilha: 15,07%
    expect(resumirRateio(1079.1, r).fecha).toBe(true);
  });
  it("lê a planilha pelo cabeçalho e ignora a linha de total", () => {
    const linhas = [
      [],
      [null, "CONTRATOS", "FATURAMENTO", null, "Rateio", "Consultas"],
      [null, "CANAA", 91883.96, 0.0107, 11.59, 0, null, 1079.1],
      [null, "TJRS - 023/2025", "518.403,45", null, null, 2],
      [null, 87, 8551570.79],
    ];
    expect(lerPlanilhaJusBrasil(linhas)).toEqual([
      { nome: "CANAA", faturamento: 91883.96, consultas: 0 },
      { nome: "TJRS - 023/2025", faturamento: 518403.45, consultas: 2 },
    ]);
  });
  it("planilha sem cabeçalho dá erro claro", () => {
    expect(() => lerPlanilhaJusBrasil([["a", "b"]])).toThrow(/CONTRATOS/);
  });
});

describe("Senior — por colaboradores", () => {
  it("divide pela quantidade de pessoas trabalhando", () => {
    const r = calcularRateio(1000, [item("A", 315), item("B", 85), item("C", 0)]);
    expect(r.map((x) => x.valor)).toEqual([787.5, 212.5, 0]);
  });
});

describe("ajuste manual", () => {
  it("item ajustado fica com o valor digitado e o resto é redividido", () => {
    const r = calcularRateio(100, [item("A", 1, { ajustado: true, valor: 10 }), item("B", 1), item("C", 2)]);
    expect(r.map((x) => x.valor)).toEqual([10, 30, 60]);
    expect(resumirRateio(100, r).diferenca).toBe(0);
  });
  it("ajuste acima do total aparece como diferença", () => {
    const r = calcularRateio(100, [item("A", 1, { ajustado: true, valor: 120 }), item("B", 1)]);
    expect(r[1].valor).toBe(0);
    expect(resumirRateio(100, r)).toEqual({ totalItens: 120, diferenca: -20, fecha: false });
  });
});

describe("lerMoeda", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["R$ 1.234,56", 1234.56],
    ["91883.96", 91883.96],
    ["(10,00)", -10],
    [12.5, 12.5],
    ["", null],
    ["abc", null],
  ])("%s → %s", (v, esperado) => expect(lerMoeda(v)).toBe(esperado));
});

describe("acharContrato", () => {
  const contratos = [
    { id: "1", nome: "UFFS CHAPECO - 041/2021", status: "ativo" },
    { id: "2", nome: "UFFS ERECHIM - 041/2021", status: "ativo" },
    { id: "3", nome: "UFFS - 041/2021", status: "encerrado" },
    { id: "4", nome: "UFRGS - LIMPEZA GERAL - 047/2022", status: "ativo" },
    { id: "5", nome: "CAXIAS DO SUL - 2026/95", status: "ativo" },
    { id: "6", nome: "CAPÃO DA CANOA- 044/2020", status: "encerrado" },
  ];
  it("exato, sem acento e sem zeros à esquerda", () => {
    expect(acharContrato("UFFS CHAPECÓ - 041/2021", contratos)?.id).toBe("1");
    expect(acharContrato("CAPAO DA CANOA-  044/2020", contratos)?.id).toBe("6");
    expect(normContrato("UFRGS - LIMPEZA GERAL - 047/2022")).toBe(normContrato("UFRGS LIMPEZA GERAL 47/2022"));
  });
  it("pelo número quando ele é único", () => {
    expect(acharContrato("LIMPEZA GERAL 47.2022", contratos)?.id).toBe("4");
    expect(acharContrato("CAXIAS 2026/95", contratos)?.id).toBe("5");
  });
  it("número repetido desempata pela palavra; sem palavra, não arrisca", () => {
    expect(acharContrato("ERECHIM 041/2021", contratos)?.id).toBe("2");
    expect(acharContrato("041/2021", contratos)).toBeNull();
    expect(acharContrato("NADA A VER", contratos)).toBeNull();
  });
});

describe("leitura do PDF", () => {
  it("valida CPF pelos dígitos", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("529.982.247-24")).toBe(false);
    expect(cpfValido("111.111.111-11")).toBe(false);
  });
  it("pega o CPF e o último valor da linha; valor na linha de baixo também", () => {
    const linhas = [
      "RELAÇÃO DE TRABALHADORES  Competência 09/2026",
      "MARIA DA SILVA   529.982.247-25   Base 2.000,00   FGTS 160,00",
      "JOAO SOUZA       390.533.447-05",
      "                 Base 1.500,00   FGTS 120,00",
      "CPF inválido 123.456.789-00 10,00",
      "TOTAL 280,00",
    ];
    const r = extrairLinhasComCpf(linhas);
    expect(r.map((x) => [x.cpf, x.valor])).toEqual([
      ["52998224725", 160],
      ["39053344705", 120],
    ]);
  });
  it("fatura por contrato: casa o nome do contrato na linha", () => {
    const contratos = [
      { id: "4", nome: "UFRGS - LIMPEZA GERAL - 047/2022" },
      { id: "7", nome: "TJRS - 023/2025" },
    ];
    const r = extrairLinhasPorContrato(
      ["Centro de custo", "UFRGS - LIMPEZA GERAL - 047/2022    1.234,56", "TJRS 023/2025 100,00", "Outro 5,00"],
      contratos,
    );
    expect(r.map((x) => [x.contrato?.id, x.valor])).toEqual([["4", 1234.56], ["7", 100]]);
  });
  it("soma por contrato, com 'sem contrato' separado", () => {
    const s = somarPorContrato([
      { contrato_id: "a", contrato_nome: "A", valor: 10.1 },
      { contrato_id: null, contrato_nome: "?", valor: 5 },
      { contrato_id: "a", contrato_nome: "A", valor: 0.2 },
    ]);
    expect(s).toEqual([
      { contrato_id: "a", contrato_nome: "A", base: 10.3, qtd: 2 },
      { contrato_id: null, contrato_nome: "?", base: 5, qtd: 1 },
    ]);
  });
});

describe("montarLinhas (posição do pdf.js → linhas)", () => {
  it("agrupa pelo y, ordena pelo x e separa colunas", async () => {
    const { montarLinhas } = await import("@/lib/rh/rateioPdf");
    const l = montarLinhas([
      { str: "160,00", x: 450, y: 760, w: 25 },
      { str: "MARIA", x: 40, y: 760.8, w: 30 },
      { str: "529.982.247-25", x: 220, y: 760, w: 60 },
      { str: "Nome", x: 40, y: 780, w: 20 },
    ]);
    expect(l).toEqual(["Nome", "MARIA  529.982.247-25  160,00"]);
  });
});

// Relatório de movimentação do seguro (Prudential "VG Express"), primeiro PDF
// real recebido (16/10/2026) — linhas como o pdf.js devolve depois de
// montarLinhas. Nomes e CPFs FICTÍCIOS (CPFs de teste válidos); o layout,
// os cabeçalhos, os prêmios e a linha de TOTAL são os do arquivo real.
const SEGURO_FIXTURE = [
  "VG EXPRESS",
  "RELATÓRIO DE MOVIMENTAÇÃO",
  "Nº Contrato  Nº Subcontrato  Nº Apólice  Nº Aditamento  Ano/Mês Vigência",
  "403267  1  1099300045636  63  2026/09",
  "Estipulante:  CNPJ:",
  "Inicio de Vigência do Faturamento: 24hs do dia 13/09/2026  Fim de Vigência do Faturamento: 24hs do dia 12/10/2026",
  "Data de",
  "Matrícula Nome Segurado  CPF Segurado  Nascimento  Data Início  Movimentação  IS Segurado  Prêmio",
  "FULANA DE TAL  529.982.247-25  18/12/1997  13/07/2026  20.000,00  11,18",
  "BELTRANO SOUZA  390.533.447-05  06/02/1967  13/08/2025  50.000,00  27,95",
  "CICRANA LIMA  111.444.777-35  05/01/1982  13/09/2026  Inclusão  20.000,00  11,18",
  "JOAO EXEMPLO  123.456.789-09  16/11/1980  13/07/2026  Exclusão  0,00  0,00",
  "TOTAL:  90.000,00  50,31",
  "436-7 PRUDENTIAL DO BRASIL SEGUROS SA - CNPJ 21.986.074/0001-19  1/111",
];

describe("PDF do seguro (relatório de movimentação)", () => {
  it("reconhece o layout", async () => {
    const { identificarLayoutPdf } = await import("@/lib/rh/rateioDespesas");
    expect(identificarLayoutPdf(SEGURO_FIXTURE).layout).toBe("seguro_prudential");
    expect(identificarLayoutPdf(["FATURA", "CPF 529.982.247-25 10,00"]).layout).toBe("generico");
  });
  it("uma linha por segurado, valor = prêmio (último), exclusão com 0", () => {
    const r = extrairLinhasComCpf(SEGURO_FIXTURE);
    expect(r.map((x) => [x.cpf, x.valor])).toEqual([
      ["52998224725", 11.18],
      ["39053344705", 27.95],
      ["11144477735", 11.18],
      ["12345678909", 0],
    ]);
  });
  it("a soma das linhas bate com o TOTAL do PDF (prêmio, não IS)", async () => {
    const { totalDeclaradoNoPdf } = await import("@/lib/rh/rateioDespesas");
    const soma = extrairLinhasComCpf(SEGURO_FIXTURE).reduce((a, x) => a + x.valor, 0);
    expect(totalDeclaradoNoPdf(SEGURO_FIXTURE)).toBe(50.31);
    expect(Math.round(soma * 100) / 100).toBe(50.31);
    expect(totalDeclaradoNoPdf(["sem total aqui 10,00"])).toBeNull();
  });
  it("página girada 90° (matriz [0,s,-s,0,e,f]): cada x da página é uma linha", async () => {
    const { paraEixoDoTexto, montarLinhas } = await import("@/lib/rh/rateioPdf");
    // Como vem do pdf.js no PDF real: o texto corre no y; linha 1 em x=303, linha 2 em x=316,5.
    const t = (x: number, y: number) => [0, 8.2, -8.2, 0, x, y];
    const itens = [
      paraEixoDoTexto("FULANA DE TAL", t(303, 70.5), 117),
      paraEixoDoTexto("529.982.247-25", t(303, 353.8), 58),
      paraEixoDoTexto("11,18", t(303, 804.7), 21),
      paraEixoDoTexto("BELTRANO SOUZA", t(316.5, 70.5), 106),
      paraEixoDoTexto("390.533.447-05", t(316.5, 353.8), 58),
      paraEixoDoTexto("27,95", t(316.5, 804.7), 21),
    ];
    expect(montarLinhas(itens)).toEqual([
      "FULANA DE TAL  529.982.247-25  11,18",
      "BELTRANO SOUZA  390.533.447-05  27,95",
    ]);
    // Página normal continua igual.
    expect(paraEixoDoTexto("x", [1, 0, 0, 1, 40, 760], 5)).toEqual({ str: "x", x: 40, y: 760, w: 5 });
  });
});

// Guia do FGTS Digital (GFD + Detalhe da Guia), segundo PDF real (FGTS MENSAL
// 09/2026, 16/10/2026) — linhas como o pdf.js devolve. Nomes, matrículas e
// CPFs FICTÍCIOS; cabeçalhos, seções e a regra de totais são os do arquivo.
// O arquivo junta FGTS + CONSIGNADO (que também tem CPF e valor) + Relação
// de Eventos da Senior: só a primeira seção entra.
const FGTS_FIXTURE = [
  "GFD - Guia do FGTS Digital",
  "Competência  Trabalhadores  FGTS Mensal  FGTS Rescisório  Compensatória  Encargos FGTS  Total",
  "09/2026  2  359,58  0,00  0,00  0,00  359,58",
  "Total FGTS:  359,58  0,00  0,00  0,00  359,58",
  "Total Consignado:  834,59  0,00  834,59",
  "Total da Guia:  1.194,17",
  "Detalhe da Guia Emitida",
  "Empregador: 03.644.009  Nome Empregador: EMPRESA EXEMPLO LTDA  Qtd. Trabalhadores FGTS:  2  Origem: Gestão de Guias",
  "Relação de Trabalhadores",
  "Estabelecimento:  03.644.009/0001-23  Tomador:  00.058.163/0001-25",
  "Total",
  "SENASCIMEN000000000000000024",
  "09/2026  FULANA DE TAL  529.982.247-25  101 20/10/2026 Mensal  2.247,46  179,79  0,00  0,00  0,00  179,79",
  "44",
  "SENASCIMEN000000000000000025",
  "09/2026  BELTRANO SOUZA  390.533.447-05  101 20/10/2026 Mensal  2.247,46  179,79  0,00  0,00  0,00  179,79",
  "Total do Tomador  00.058.163/0001-25  4.494,92  359,58  0,00  0,00  0,00  359,58",
  "Total FGTS  4.494,92  359,58  0,00  0,00  0,00  359,58",
  "Empregador: 03.644.009  Nome Empregador: EMPRESA EXEMPLO LTDA  Qtd. Trabalhadores Consignado: 2  Origem: Gestão de Guias",
  "Relação de Trabalhadores",
  "09/2026  20/10/2026  FULANA DE TAL  SENASCIMEN000000000000000024  529.982.247-25  90719806  531  107,93",
  "09/2026  20/10/2026  CICRANA LIMA  SENASCIMEN000000000000000026  111.444.777-35  6059253338  626  726,66",
  "Total Consignado  834,59",
  "Relação de Eventos  UFFS CHAPECO 041.2021",
  "000008359 FULANA DE TAL  001  09/2026  07/10/2026  35,00  388,28",
  "Total de Colaboradores:  1  35,00  388,28",
];

describe("PDF do FGTS (Guia do FGTS Digital)", () => {
  it("reconhece o layout", async () => {
    const { identificarLayoutPdf } = await import("@/lib/rh/rateioDespesas");
    expect(identificarLayoutPdf(FGTS_FIXTURE).layout).toBe("fgts_digital");
  });
  it("lê só a relação do FGTS — o consignado (também com CPF) fica de fora", async () => {
    const { extrairLinhasDoPdf } = await import("@/lib/rh/rateioDespesas");
    const r = extrairLinhasDoPdf(FGTS_FIXTURE, "fgts_digital");
    expect(r.map((x) => [x.cpf, x.valor])).toEqual([
      ["52998224725", 179.79],
      ["39053344705", 179.79],
    ]);
    // A leitura genérica pegaria as linhas do consignado também.
    expect(extrairLinhasComCpf(FGTS_FIXTURE).length).toBe(4);
  });
  it("total = 'Total FGTS', não o da guia (FGTS + consignado) nem o da Relação de Eventos", async () => {
    const { totalDoPdf, totalDeclaradoNoPdf, extrairLinhasDoPdf } = await import("@/lib/rh/rateioDespesas");
    const soma = extrairLinhasDoPdf(FGTS_FIXTURE, "fgts_digital").reduce((a, x) => a + x.valor, 0);
    expect(totalDoPdf(FGTS_FIXTURE, "fgts_digital")).toBe(359.58);
    expect(Math.round(soma * 100) / 100).toBe(359.58);
    expect(totalDeclaradoNoPdf(FGTS_FIXTURE)).not.toBe(359.58); // o genérico pegaria o último TOTAL
  });
});
