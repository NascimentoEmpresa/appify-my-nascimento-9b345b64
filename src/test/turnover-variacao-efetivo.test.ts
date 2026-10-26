import { describe, expect, it } from "vitest";
import {
  filtrarEmpresas, leituraDoMes, linhasCsv, registro, resumo, rotuloMes, somar, taxaTurnover, todosContratos,
  type ContratoEfetivo, type VariacaoEfetivo,
} from "@/lib/diretoria/variacaoEfetivo";

const c = (nome: string, meses: [number, number, number, number][]): ContratoEfetivo => ({
  chave: nome, nome, no_erp: true,
  meses: meses.map(([previsto, trabalhando, admissoes, demissoes], i) => ({ mes: `2026-0${i + 1}`, previsto, trabalhando, admissoes, demissoes })),
});

const V: VariacaoEfetivo = {
  ano: 2026, meses: ["2026-01", "2026-02"],
  empresas: [
    { empresa: "HAGG", contratos: [c("UFRGS LIMPEZA", [[100, 95, 5, 4], [100, 98, 6, 3]]), c("UFRGS PORTARIA", [[20, 20, 0, 0], [22, 21, 1, 0]])] },
    { empresa: "SN", contratos: [c("TRE COPA", [[10, 8, 1, 2], [10, 9, 1, 0]])] },
  ],
};

describe("turnover e somas", () => {
  it("taxa = demissões ÷ efetivo trabalhando", () => {
    expect(taxaTurnover(4, 95)).toBe(4.21);
    expect(taxaTurnover(0, 0)).toBe(0);
    expect(taxaTurnover(2, 0)).toBeNull();
  });
  it("registro do contrato e mês ainda não começado", () => {
    const u = V.empresas[0].contratos[0];
    expect(registro(u, "2026-01")).toMatchObject({ previsto: 100, trabalhando: 95, demissoes: 4, turnover: 4.21, vazio: false });
    expect(registro(u, "2026-05").vazio).toBe(true);
  });
  it("soma da empresa recalcula a taxa sobre o total", () => {
    const s = somar(V.empresas[0].contratos, "2026-01");
    expect(s).toMatchObject({ previsto: 120, trabalhando: 115, admissoes: 5, demissoes: 4, turnover: 3.48 });
  });
});

describe("resumo e leitura", () => {
  it("cartões: quadro do último mês, média das taxas e movimentos do ano", () => {
    const r = resumo(todosContratos(V), V.meses);
    expect(r).toMatchObject({ mes: "2026-02", previsto: 132, trabalhando: 128, admissoes: 14, demissoes: 9 });
    // jan: 6/123 = 4,88%; fev: 3/128 = 2,34% → média 3,61%
    expect(r.turnoverMedio).toBe(3.61);
  });
  it("déficit, excedente e sem previsto", () => {
    expect(leituraDoMes({ previsto: 10, trabalhando: 8 })).toEqual({ tipo: "deficit", diferenca: 2 });
    expect(leituraDoMes({ previsto: 10, trabalhando: 12 })).toEqual({ tipo: "excedente", diferenca: 2 });
    expect(leituraDoMes({ previsto: 10, trabalhando: 10 })).toEqual({ tipo: "ok", diferenca: 0 });
    expect(leituraDoMes({ previsto: 0, trabalhando: 5 }).tipo).toBe("sem_previsto");
  });
});

describe("filtro e exportação", () => {
  it("busca por contrato ou empresa, sem acento", () => {
    expect(filtrarEmpresas(V, "portaria").map((e) => e.contratos.map((x) => x.nome))).toEqual([["UFRGS PORTARIA"]]);
    expect(filtrarEmpresas(V, "sn").map((e) => e.empresa)).toEqual(["SN"]);
  });
  it("CSV: cabeçalho + contrato × mês", () => {
    const l = linhasCsv(V);
    expect(l).toHaveLength(1 + 3 * 2);
    expect(l[1]).toEqual(["HAGG", "UFRGS LIMPEZA", "Jan/26", 100, 95, "4,21%", 4, 5]);
  });
  it("rótulo do mês", () => expect(rotuloMes("2026-10")).toBe("Out/26"));
});
