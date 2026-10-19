import { describe, expect, it } from "vitest";
import { datasDaDespesaDeCartao } from "@/pages/malote/cartaoEspecial";

describe("[SEM-CHAMADO] despesa de cartão com Fluxo Especial", () => {
  it("paga no dia da criação, com competência no mês de hoje", () => {
    expect(datasDaDespesaDeCartao("2026-10-19")).toEqual({ dataPagamento: "2026-10-19", competencia: "2026-10" });
  });

  it("a competência acompanha o mês do lançamento (virada de mês e de ano)", () => {
    expect(datasDaDespesaDeCartao("2026-11-02")).toEqual({ dataPagamento: "2026-11-02", competencia: "2026-11" });
    expect(datasDaDespesaDeCartao("2026-12-31")).toEqual({ dataPagamento: "2026-12-31", competencia: "2026-12" });
  });
});
