import { describe, expect, it } from "vitest";
import { chaveFatura, compararFatura, textoConferenciaFatura } from "@/pages/financeiro/cartao-credito/faturaConsolidada";

describe("SIS-2026-0632: comparação da fatura do cartão", () => {
  it("sem valor informado: nada a comparar", () => {
    expect(compararFatura(10478.74, null)).toEqual({ status: "sem_valor", diferenca: 0 });
    expect(compararFatura(10478.74, undefined).status).toBe("sem_valor");
  });

  it("confere quando a diferença é menor que 1 centavo", () => {
    expect(compararFatura(10478.74, 10478.74).status).toBe("confere");
    expect(compararFatura(0.1 + 0.2, 0.3).status).toBe("confere");
  });

  it("divergente: diferença = fatura − despesas (positiva = faltam despesas)", () => {
    expect(compararFatura(10000, 10478.74)).toEqual({ status: "divergente", diferenca: 478.74 });
    expect(compararFatura(10478.74, 10000)).toEqual({ status: "divergente", diferenca: -478.74 });
  });

  it("chave da fatura usa cartão + mês (ignora o dia)", () => {
    expect(chaveFatura("c1", "2026-10-01")).toBe("c1:2026-10");
    expect(chaveFatura("c1", "2026-10")).toBe("c1:2026-10");
  });
});

describe("textoConferenciaFatura · conferência com o boleto no Classificar e nas competências", () => {
  const fmt = (n: number) => `R$ ${n.toFixed(2)}`;
  it("sem valor informado, confere e divergente (faltam/sobram)", () => {
    expect(textoConferenciaFatura(compararFatura(69997.02, null), null, fmt)).toBe("valor da fatura não informado");
    expect(textoConferenciaFatura(compararFatura(71207.02, 71207.02), 71207.02, fmt)).toBe("confere com a fatura");
    // caso BB HAGG 09/2026: item excluído por engano → os itens ficam R$ 1.210,00 abaixo do boleto
    expect(textoConferenciaFatura(compararFatura(69997.02, 71207.02), 71207.02, fmt)).toBe("fatura R$ 71207.02 · faltam R$ 1210.00 nos itens");
    expect(textoConferenciaFatura(compararFatura(100, 90), 90, fmt)).toBe("fatura R$ 90.00 · sobram R$ 10.00 nos itens");
  });
});
