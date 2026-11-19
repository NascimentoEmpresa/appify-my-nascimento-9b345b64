import { describe, expect, it } from "vitest";
import { ehBancoContaVinculada, erroCentroContaVinculada, opcoesSomenteMovimentacao, type ContratoParaCentro } from "@/pages/financeiro/aplicacao-financeira/centroCusto";

// SIS-2026-0829: saída de conta vinculada só aceita o centro de custo MOVIMENTAÇÃO FINANCEIRA.
const C = (id: string, nome: string, empresa_id: string, status = "ativo"): ContratoParaCentro => ({ id, nome, empresa_id, status });

describe("banco de conta vinculada (reconhecido pelo nome)", () => {
  it("pega com ou sem acento, em qualquer caixa e com a grafia 'Vinculda' já gravada", () => {
    expect(ehBancoContaVinculada("Banco do Brasil Conta Vinculada Embrapa")).toBe(true);
    expect(ehBancoContaVinculada("BB CONTA VINCULDA EMBRAPA CANOINHA")).toBe(true);
    expect(ehBancoContaVinculada("Sicredi 119")).toBe(false);
    expect(ehBancoContaVinculada(null)).toBe(false);
  });
});

describe("opções de centro de custo da saída de conta vinculada", () => {
  const contratos = [C("1", "ADMINISTRATIVO - HAGG", "hagg"), C("2", "MOVIMENTAÇÃO FINANCEIRA - HAGG", "hagg"), C("3", "MOVIMENTAÇÃO FINANCEIRA - SN", "sn"), C("4", "Movimentacao Financeira antiga", "hagg", "encerrado")];
  it("só a MOVIMENTAÇÃO FINANCEIRA da empresa, com o ativo na frente", () => {
    expect(opcoesSomenteMovimentacao(contratos, "hagg").map((c) => c.id)).toEqual(["2", "4"]);
    expect(opcoesSomenteMovimentacao(contratos, "sn").map((c) => c.id)).toEqual(["3"]);
    expect(opcoesSomenteMovimentacao(contratos, "outra")).toEqual([]);
  });
});

describe("validação ao salvar", () => {
  it("conta vinculada com outro centro de custo (ou sem) é recusada", () => {
    expect(erroCentroContaVinculada("BB Conta Vinculada Embrapa", "ADMINISTRATIVO - HAGG")).toMatch(/MOVIMENTAÇÃO FINANCEIRA/);
    expect(erroCentroContaVinculada("BB Conta Vinculada Embrapa", undefined)).not.toBeNull();
  });
  it("conta vinculada com MOVIMENTAÇÃO FINANCEIRA passa; banco comum não é restringido", () => {
    expect(erroCentroContaVinculada("BB Conta Vinculada Embrapa", "MOVIMENTAÇÃO FINANCEIRA - HAGG")).toBeNull();
    expect(erroCentroContaVinculada("Sicredi 119", "ADMINISTRATIVO - HAGG")).toBeNull();
  });
});
