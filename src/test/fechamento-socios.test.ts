import { describe, expect, it } from "vitest";
import { custosVazios, ehDespesaDeSocio, type LinhaFluxoCusto } from "@/pages/controladoria/faturamento/regras";
import { despesasDosSocios, montarFechamento, socioDoContrato, totalDoFechamento } from "@/pages/controladoria/fechamento/regras";

// SIS-2026-0709: despesas dos sócios saem do Resultado Final e entram no Resultado com Sócios (Lucro Líquido Final).
describe("sócio pelo nome do contrato", () => {
  it("ADMINISTRATIVO SÓCIOS - nome é sócio; o nome vira o rótulo da coluna (sem o prefixo)", () => {
    expect(socioDoContrato("ADMINISTRATIVO SÓCIOS - HELENA")).toBe("Helena");
    expect(socioDoContrato("ADMINISTRATIVO SÓCIOS - CARLOS EDUARDO")).toBe("Carlos Eduardo");
    expect(socioDoContrato("ADMINISTRATIVO SÓCIOS - ANTÔNIO")).toBe("Antônio");
    expect(socioDoContrato("administrativo socios - guiomar")).toBe("Guiomar");
  });

  it("também vale ADMINISTRATIVO + nome, sem o 'SÓCIOS -'", () => {
    expect(socioDoContrato("ADMINISTRATIVO SENILTON")).toBe("Senilton");
  });

  it("contrato administrativo da empresa (com hífen) e contrato de cliente não são sócio", () => {
    expect(socioDoContrato("ADMINISTRATIVO - HAGG")).toBeNull();
    expect(socioDoContrato("ADMINISTRATIVO – CANAA")).toBeNull();
    expect(socioDoContrato("ADMINISTRATIVO")).toBeNull();
    expect(socioDoContrato("UFRGS - AUXILIAR ADMINISTRATIVO")).toBeNull();
    expect(socioDoContrato("INVESTIMENTOS AGPS")).toBeNull();
    expect(socioDoContrato(null)).toBeNull();
  });
});

describe("o que conta como despesa de sócio", () => {
  const l = (classificacao_nome: string | null) => ({ tipo: "saida" as const, classificacao_id: null, classificacao_nome });
  it("conta a distribuição de lucros e gastos pessoais; não conta movimentação que só muda o dinheiro de lugar", () => {
    expect(ehDespesaDeSocio(l("DISTRIBUIÇÃO DE LUCROS ANT."))).toBe(true);
    expect(ehDespesaDeSocio(l("CARTÃO DE CRÉDITO"))).toBe(true);
    expect(ehDespesaDeSocio(l("TRANSF. ENTRE CONTAS"))).toBe(false);
    expect(ehDespesaDeSocio(l("APLICAÇÃO FINANCEIRA"))).toBe(false);
    expect(ehDespesaDeSocio(l(null))).toBe(false);
    expect(ehDespesaDeSocio({ tipo: "entrada", classificacao_id: null, classificacao_nome: "DISTRIBUIÇÃO" })).toBe(false);
  });

  it("a ligação manual 'não é custo' tira a classificação da conta do sócio", () => {
    expect(ehDespesaDeSocio({ tipo: "saida", classificacao_id: "x", classificacao_nome: "CARTÃO" }, new Map([["x", "nao_custo" as const]]))).toBe(false);
  });
});

describe("despesasDosSocios e o Lucro Líquido Final", () => {
  const linha = (contrato_id: string, valor: number, data: string, nome = "DISTRIBUIÇÃO DE LUCROS"): LinhaFluxoCusto =>
    ({ tipo: "saida", data_pagamento: data, contrato_id, classificacao_nome: nome, valor });
  const socioPorContrato = new Map([["cs", "Senilton"], ["ch", "Helena"]]);

  it("soma por sócio e mês e ignora contrato que não é de sócio", () => {
    const m = despesasDosSocios([linha("cs", 100, "2026-01-05"), linha("cs", 50, "2026-01-20"), linha("ch", 70, "2026-02-01"), linha("outro", 999, "2026-01-05")], socioPorContrato);
    expect(m.get("Senilton")?.get("2026-01")).toBe(150);
    expect(m.get("Helena")?.get("2026-02")).toBe(70);
    expect(m.has("outro")).toBe(false);
  });

  it("Lucro Líquido Final = Resultado Final − despesas dos sócios; o Resultado Final não muda", () => {
    const liquido = new Map([["2026-01", 1000]]);
    const base = { meses: ["2026-01"], mesAtual: "2026-02", liquidoPorMes: liquido, executavelPorMes: new Map<string, number>(), custosContratoPorMes: new Map([["2026-01", 200]]), admPorMes: new Map([["2026-01", { ...custosVazios(), outras: 100 }]]) };
    const sem = montarFechamento(base)[0];
    const com = montarFechamento({ ...base, sociosPorMes: new Map([["Senilton", new Map([["2026-01", 150]])], ["Helena", new Map([["2026-01", 50]])]]) })[0];
    expect(com.resultado).toBe(sem.resultado);
    expect(com.resultado).toBe(700);
    expect(com.totalSocios).toBe(200);
    expect(com.lucroLiquido).toBe(500);
    expect(sem.lucroLiquido).toBe(700);
    const t = totalDoFechamento([com]);
    expect(t.socios).toEqual({ Senilton: 150, Helena: 50 });
    expect(t.lucroLiquido).toBe(500);
  });

  it("mês projetado usa o lançado ou a média dos últimos meses, o maior", () => {
    const base = {
      meses: ["2026-01", "2026-02", "2026-03"], mesAtual: "2026-02",
      liquidoPorMes: new Map<string, number>(), executavelPorMes: new Map<string, number>(), custosContratoPorMes: new Map<string, number>(), admPorMes: new Map(),
      sociosPorMes: new Map([["Senilton", new Map([["2026-01", 100], ["2026-02", 200]])]]),
    };
    const [jan, , mar] = montarFechamento(base);
    expect(jan.socios.Senilton).toBe(100);
    expect(mar.projetado).toBe(true);
    expect(mar.socios.Senilton).toBe(100); // a média só olha meses anteriores ao atual: só jan (fev, o mês atual, está incompleto)
  });
});
