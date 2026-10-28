import { describe, expect, it } from "vitest";
import { ehContratoForaDasDespesas } from "@/pages/controladoria/faturamento/regras";

// SIS-2026-0755: MOVIMENTAÇÃO FINANCEIRA, INVESTIMENTOS e ESTOQUE não são despesa de contrato (não diminuem o lucro do Faturamento).
describe("contratos que ficam fora da coluna Despesas", () => {
  it("MOVIMENTAÇÃO FINANCEIRA, INVESTIMENTOS e ESTOQUE (qualquer empresa) ficam de fora", () => {
    for (const nome of ["MOVIMENTAÇÃO FINANCEIRA HAGG", "MOVIMENTAÇÃO FINANCEIRA - SN", "Movimentacao Financeira Canaa", "INVESTIMENTOS AGPS", "INVESTIMENTOS HAGG", "INVESTIMENTOS SN", "ESTOQUE HAGG", "ESTOQUE - HAGG", "estoque sn"]) {
      expect(ehContratoForaDasDespesas(nome), nome).toBe(true);
    }
  });

  it("contrato de cliente e administrativo continuam contando", () => {
    for (const nome of ["UFRGS - LIMPEZA GERAL - 047/2022", "ADMINISTRATIVO - HAGG", "ADMINISTRATIVO SÓCIOS - HELENA", "HUSM SANTA MARIA - LAVANDERIA - 020/2021", "PM FARROUPILHA 327.2021"]) {
      expect(ehContratoForaDasDespesas(nome), nome).toBe(false);
    }
    expect(ehContratoForaDasDespesas(null)).toBe(false);
    expect(ehContratoForaDasDespesas("")).toBe(false);
  });

  it("só pelo início do nome: contrato de cliente que cita 'estoque' no meio não sai", () => {
    expect(ehContratoForaDasDespesas("PREF X - ALMOXARIFADO E ESTOQUE - 001/2026")).toBe(false);
  });

  it("o Fechamento mantém as linhas de INVESTIMENTOS (coluna própria), mas não as de ESTOQUE e MOVIMENTAÇÃO FINANCEIRA", () => {
    expect(ehContratoForaDasDespesas("INVESTIMENTOS HAGG", { manterInvestimentos: true })).toBe(false);
    expect(ehContratoForaDasDespesas("ESTOQUE HAGG", { manterInvestimentos: true })).toBe(true);
    expect(ehContratoForaDasDespesas("MOVIMENTAÇÃO FINANCEIRA HAGG", { manterInvestimentos: true })).toBe(true);
  });
});
