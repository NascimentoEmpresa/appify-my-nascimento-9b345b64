import { describe, expect, it } from "vitest";
import { dadosPagamentoDispensados, formaPagamentoEhPix } from "@/pages/malote/pagamentoPix";

describe("SIS-2026-0583 — chave Pix obrigatória", () => {
  it("reconhece Pix independente de caixa e de complemento no nome", () => {
    expect(formaPagamentoEhPix("Pix")).toBe(true);
    expect(formaPagamentoEhPix("PIX")).toBe(true);
    expect(formaPagamentoEhPix(" pix - Itaú ")).toBe(true);
    expect(formaPagamentoEhPix("Transferência via PIX")).toBe(true);
  });

  it("não confunde outras formas", () => {
    expect(formaPagamentoEhPix("Boleto Bancário")).toBe(false);
    expect(formaPagamentoEhPix("Cartão Sicredi 119 - Final 2719")).toBe(false);
    expect(formaPagamentoEhPix("Pixel")).toBe(false);
    expect(formaPagamentoEhPix("")).toBe(false);
    expect(formaPagamentoEhPix(null)).toBe(false);
  });

  it("'só por anexo' dispensa os dados no boleto, mas não no Pix", () => {
    expect(dadosPagamentoDispensados("Boleto Bancário", true)).toBe(true);
    expect(dadosPagamentoDispensados("Pix", true)).toBe(false);
    expect(dadosPagamentoDispensados("Boleto Bancário", false)).toBe(false);
  });
});
