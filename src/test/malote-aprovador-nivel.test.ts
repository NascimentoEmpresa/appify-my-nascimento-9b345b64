import { describe, expect, it } from "vitest";
import {
  nomesAprovadorNivel,
  souAprovadorDoNivelComRateio,
  souAprovadorConfiguradoComRateio,
  MaloteDespesaRow,
} from "@/hooks/useMaloteDespesa";

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

// [SEM-CHAMADO] (achado do usuário, 22/09/2026 — DM-2026-0895 travada em
// "nenhum aprovador configurado"): mesma lógica de união de nomesAprovadorNivel
// acima, só que decidindo permissão de fato (é O aprovador), não só exibição.
describe("souAprovadorDoNivelComRateio / souAprovadorConfiguradoComRateio", () => {
  it("despesa de rateio: reconhece como aprovador quem está em QUALQUER classificação das linhas daquele nível", () => {
    const despesa = despesaBase({ classificacao_id: null, classificacao: null });
    const classificacaoPorId = new Map([
      ["c1", { aprovador2_user_ids: ["user-a"] }],
      ["c2", { aprovador2_user_ids: ["user-b"] }],
    ]);
    const idsRateio = new Set(["c1", "c2"]);
    expect(souAprovadorDoNivelComRateio(despesa, 2, "user-a", idsRateio, classificacaoPorId)).toBe(true);
    expect(souAprovadorDoNivelComRateio(despesa, 2, "user-b", idsRateio, classificacaoPorId)).toBe(true);
    expect(souAprovadorDoNivelComRateio(despesa, 2, "user-c", idsRateio, classificacaoPorId)).toBe(false);
  });

  it("despesa de rateio: não reconhece aprovador de nível diferente do configurado", () => {
    const despesa = despesaBase({ classificacao_id: null, classificacao: null });
    const classificacaoPorId = new Map([["c1", { aprovador1_user_ids: ["user-a"] }]]);
    expect(souAprovadorDoNivelComRateio(despesa, 2, "user-a", new Set(["c1"]), classificacaoPorId)).toBe(false);
  });

  it("despesa com classificação única: cai no caminho normal (ignora o rateio)", () => {
    const despesa = despesaBase({
      classificacao_id: "c1",
      classificacao: { id: "c1", nome: "X", aprovador1_user_ids: ["user-a"] } as any,
    });
    expect(souAprovadorDoNivelComRateio(despesa, 1, "user-a", new Set(["c2"]), new Map([["c2", { aprovador1_user_ids: ["user-b"] }]]))).toBe(true);
  });

  it("Fluxo Especial substitui a checagem por rateio/classificação", () => {
    const despesa = despesaBase({ classificacao_id: null, classificacao: null });
    const formaEspecial = { fluxo_aprovacao: "especial", aprovador_especial_user_id: "user-especial" };
    expect(souAprovadorDoNivelComRateio(despesa, 1, "user-especial", new Set(), new Map(), formaEspecial)).toBe(true);
    expect(souAprovadorDoNivelComRateio(despesa, 1, "user-a", new Set(["c1"]), new Map([["c1", { aprovador1_user_ids: ["user-a"] }]]), formaEspecial)).toBe(false);
  });

  it("souAprovadorConfiguradoComRateio: true se a pessoa é aprovadora de QUALQUER nível, via rateio", () => {
    const despesa = despesaBase({ classificacao_id: null, classificacao: null });
    const classificacaoPorId = new Map([["c1", { aprovador3_user_ids: ["user-a"] }]]);
    expect(souAprovadorConfiguradoComRateio(despesa, "user-a", new Set(["c1"]), classificacaoPorId)).toBe(true);
    expect(souAprovadorConfiguradoComRateio(despesa, "user-z", new Set(["c1"]), classificacaoPorId)).toBe(false);
  });
});
