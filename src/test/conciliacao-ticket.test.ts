import { describe, expect, it } from "vitest";
import {
  categoriaDoExtrato, compararPorMes, dataBRparaIso, extratoDaAba, filtrarErp, lerCsvTicket, lerValorBR, resumirComparativo, resumoOutros,
  type LinhaErp, type LinhaExtratoCsv,
} from "@/pages/financeiro/conciliacao-ticket/regras";

// SIS-2026-0825: Conciliação da Ticket — leitura do CSV da plataforma e o comparativo mês a mês com o ERP.

// Trecho real do extrato: o valor vem em formato BR SEM aspas, então a vírgula do decimal quebra a linha em 5 campos.
const CSV = [
  "transação,data,status,valor",
  "Pagamento de Boleto,23/10/2026,debitado,-123.103,48",
  "Pagamento de Boleto,21/10/2026,debitado,-21.822,48",
  "Tickets,15/10/2026,adicionado,23,06",
  "Tickets,15/10/2026,adicionado,2.038,73",
  "Tickets,15/10/2026,adicionado,4",
  "CREDIT,08/04/2026,adicionado,16.568,91",
  "",
].join("\r\n");

describe("valor no formato brasileiro", () => {
  it("lê milhar com ponto e decimal com vírgula, com sinal", () => {
    expect(lerValorBR("-123.103,48")).toBe(-123103.48);
    expect(lerValorBR("2.038,73")).toBe(2038.73);
    expect(lerValorBR("23,06")).toBe(23.06);
    expect(lerValorBR("4")).toBe(4);
    expect(lerValorBR("1.234")).toBe(1234); // sem vírgula, ponto + 3 dígitos = milhar
    expect(lerValorBR("0,5")).toBe(0.5);
    expect(lerValorBR('"-1.000,00"')).toBe(-1000);
  });
  it("recusa o que não é número", () => {
    expect(lerValorBR("")).toBeNull();
    expect(lerValorBR("abc")).toBeNull();
    expect(lerValorBR("1,2,3")).toBeNull();
  });
});

describe("data dd/mm/aaaa", () => {
  it("converte e recusa data que não existe", () => {
    expect(dataBRparaIso("23/10/2026")).toBe("2026-10-23");
    expect(dataBRparaIso("31/02/2026")).toBeNull();
    expect(dataBRparaIso("2026-10-23")).toBeNull();
  });
});

describe("leitura do CSV da Ticket", () => {
  const r = lerCsvTicket(CSV);

  it("junta o valor que a vírgula quebrou e lê todas as linhas", () => {
    expect(r.erros).toEqual([]);
    expect(r.linhas).toHaveLength(6);
    expect(r.linhas[0]).toEqual({ data: "2026-10-23", transacao: "Pagamento de Boleto", status: "debitado", valor: -123103.48 });
    expect(r.linhas[3]).toMatchObject({ transacao: "Tickets", valor: 2038.73 });
    expect(r.linhas[4].valor).toBe(4);
  });

  it("aceita o mesmo arquivo com o valor entre aspas e BOM no começo", () => {
    const aspas = lerCsvTicket('\uFEFFtransação,data,status,valor\nPagamento de Boleto,23/10/2026,debitado,"-123.103,48"\n');
    expect(aspas.erros).toEqual([]);
    expect(aspas.linhas[0].valor).toBe(-123103.48);
  });

  it("aponta a linha (do arquivo) que não deu para ler, sem derrubar as outras", () => {
    const ruim = lerCsvTicket("transação,data,status,valor\nTickets,32/13/2026,adicionado,10,00\nTickets,15/10/2026,adicionado,xx\nTickets,15/10/2026,adicionado,5,00\nso uma coluna\n");
    expect(ruim.linhas).toHaveLength(1);
    expect(ruim.erros.map((e) => e.linha)).toEqual([2, 3, 5]);
    expect(ruim.erros[0].motivo).toMatch(/Data/);
    expect(ruim.erros[1].motivo).toMatch(/Valor/);
  });
});

describe("categorias do extrato", () => {
  it("boleto, crédito por colaborador e o resto", () => {
    expect(categoriaDoExtrato({ transacao: "Pagamento de Boleto", status: "debitado" })).toBe("boleto");
    expect(categoriaDoExtrato({ transacao: "Tickets", status: "adicionado" })).toBe("credito");
    expect(categoriaDoExtrato({ transacao: "CREDIT", status: "adicionado" })).toBe("outro");
    expect(categoriaDoExtrato({ transacao: "Tickets", status: "debitado" })).toBe("outro");
  });

  it("cada aba pega a sua categoria, sempre em módulo; o que sobra aparece no resumo de 'outros'", () => {
    const linhas = lerCsvTicket(CSV).linhas;
    expect(extratoDaAba(linhas, "boletos").map((e) => e.valor)).toEqual([123103.48, 21822.48]);
    expect(extratoDaAba(linhas, "creditos").map((e) => e.valor)).toEqual([23.06, 2038.73, 4]);
    expect(resumoOutros(linhas)).toEqual({ qtd: 1, total: 16568.91 });
  });
});

const erp = (o: Partial<LinhaErp> & { data_pagamento: string; valor: number }): LinhaErp => ({
  despesa_id: Math.random().toString(36).slice(2), origem: "malote", id_malote: "DM-1", numero_parcela: null, descricao: "TICKET 10.2026 X",
  empresa_id: "e1", empresa_nome: "HAGG", classificacao_nome: "VA", ...o,
});

describe("comparativo por mês", () => {
  const extrato = [
    { data: "2026-10-15", transacao: "Tickets", valor: 60 }, { data: "2026-10-15", transacao: "Tickets", valor: 40 },
    { data: "2026-09-15", transacao: "Tickets", valor: 50 },
    { data: "2026-08-14", transacao: "Tickets", valor: 30 },
  ];

  it("soma cada lado por mês e classifica: confere, diferença, só no extrato, só no ERP", () => {
    const meses = compararPorMes(extrato, [
      erp({ data_pagamento: "2026-10-01", valor: 70 }), erp({ data_pagamento: "2026-10-20", valor: 30 }), // 100 = extrato de outubro
      erp({ data_pagamento: "2026-09-10", valor: 80 }), // 80 × 50
      erp({ data_pagamento: "2026-11-02", valor: 10 }), // só no ERP
    ]);
    expect(meses.map((m) => [m.mes, m.situacao])).toEqual([["2026-08", "so_extrato"], ["2026-09", "diferenca"], ["2026-10", "confere"], ["2026-11", "so_erp"]]);
    expect(meses.find((m) => m.mes === "2026-09")).toMatchObject({ extratoTotal: 50, erpTotal: 80, diferenca: 30, extratoQtd: 1, erpQtd: 1 });
    expect(meses.find((m) => m.mes === "2026-10")).toMatchObject({ extratoTotal: 100, erpTotal: 100, diferenca: 0, extratoQtd: 2, erpQtd: 2 });
  });

  it("resumo: totais, diferença (ERP − extrato) e quantos meses conferem", () => {
    const meses = compararPorMes(extrato, [erp({ data_pagamento: "2026-10-01", valor: 100 }), erp({ data_pagamento: "2026-09-10", valor: 80 })]);
    expect(resumirComparativo(meses)).toEqual({ extratoTotal: 180, erpTotal: 180, diferenca: 0, mesesQueConferem: 1, mesesComDiferenca: 2 });
  });

  it("1 centavo de diferença já não confere", () => {
    const m = compararPorMes([{ data: "2026-10-15", transacao: "Tickets", valor: 100 }], [erp({ data_pagamento: "2026-10-01", valor: 100.02 })]);
    expect(m[0].situacao).toBe("diferenca");
  });
});

describe("filtros do lado do ERP", () => {
  const base = [
    erp({ data_pagamento: "2026-10-01", valor: 10, empresa_nome: "HAGG", classificacao_nome: "VA", descricao: "TICKET 10.2026 UFRGS" }),
    erp({ data_pagamento: "2026-10-01", valor: 20, empresa_nome: "SN", classificacao_nome: "ADD ASSIDUIDADE", descricao: "TICKET 09.2026 - ASSIDUIDADE" }),
    erp({ data_pagamento: "2026-10-01", valor: 30, empresa_nome: "HAGG", classificacao_nome: "CESTA BÁSICA", descricao: "TICKET - CESTA BASICA" }),
  ];
  it("empresa, classificação e texto (sem acento nem caixa), combinados", () => {
    expect(filtrarErp(base, { empresas: [], classificacoes: [], texto: "" })).toHaveLength(3);
    expect(filtrarErp(base, { empresas: ["HAGG"], classificacoes: [], texto: "" }).map((l) => l.valor)).toEqual([10, 30]);
    expect(filtrarErp(base, { empresas: [], classificacoes: ["ADD ASSIDUIDADE"], texto: "" }).map((l) => l.valor)).toEqual([20]);
    expect(filtrarErp(base, { empresas: [], classificacoes: [], texto: "cesta básica" }).map((l) => l.valor)).toEqual([30]);
    expect(filtrarErp(base, { empresas: ["SN"], classificacoes: ["VA"], texto: "" })).toEqual([]);
  });
});

// o tipo de linha do extrato importado também é usado pela tela
const _tipo: LinhaExtratoCsv = { data: "2026-10-15", transacao: "Tickets", status: "adicionado", valor: 1 };
void _tipo;
