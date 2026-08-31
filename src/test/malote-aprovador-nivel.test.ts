import { describe, expect, it } from "vitest";
import { nomesAprovadorNivel, MaloteDespesaRow } from "@/hooks/useMaloteDespesa";

// SIS-2026-0281 (Iury): "colocar os nomes pra eles conseguirem verificar
// rapidamente quais são deles" + "diferenciar quem é o N2 em questão (hoje
// só temos dois: Senilton e Fernanda)".
function despesaBase(overrides: Partial<MaloteDespesaRow> = {}): MaloteDespesaRow {
  return {
    id: "d1",
    classificacao_id: null,
    classificacao: null,
    ...overrides,
  } as MaloteDespesaRow;
}

describe("nomesAprovadorNivel", () => {
  it("despesa com classificação única: usa o aprovador2/3_nomes já vindo do join, sem depender do rateio", () => {
    const despesa = despesaBase({
      classificacao_id: "c1",
      classificacao: { id: "c1", nome: "X", aprovador2_nomes: ["Senilton"], aprovador3_nomes: ["Fernanda"] } as any,
    });
    expect(nomesAprovadorNivel(despesa, 2, undefined, new Map())).toEqual(["Senilton"]);
    expect(nomesAprovadorNivel(despesa, 3, undefined, new Map())).toEqual(["Fernanda"]);
  });

  it("despesa de rateio (classificacao_id nulo): une os nomes das classificações de todas as linhas", () => {
    const despesa = despesaBase({ classificacao_id: null, classificacao: null });
    const classificacaoPorId = new Map([
      ["c1", { aprovador2_nomes: ["Senilton"] }],
      ["c2", { aprovador2_nomes: ["Fernanda"] }],
    ]);
    const resultado = nomesAprovadorNivel(despesa, 2, new Set(["c1", "c2"]), classificacaoPorId);
    expect(new Set(resultado)).toEqual(new Set(["Senilton", "Fernanda"]));
  });

  it("despesa de rateio com as duas linhas apontando pro mesmo aprovador: não duplica o nome", () => {
    const despesa = despesaBase({ classificacao_id: null, classificacao: null });
    const classificacaoPorId = new Map([
      ["c1", { aprovador2_nomes: ["Senilton"] }],
      ["c2", { aprovador2_nomes: ["Senilton"] }],
    ]);
    const resultado = nomesAprovadorNivel(despesa, 2, new Set(["c1", "c2"]), classificacaoPorId);
    expect(resultado).toEqual(["Senilton"]);
  });

  it("sem aprovador configurado (nem classificação direta nem linhas de rateio): retorna vazio", () => {
    const despesa = despesaBase({ classificacao_id: null, classificacao: null });
    expect(nomesAprovadorNivel(despesa, 2, undefined, new Map())).toEqual([]);
    expect(nomesAprovadorNivel(despesa, 2, new Set(), new Map())).toEqual([]);
  });
});
