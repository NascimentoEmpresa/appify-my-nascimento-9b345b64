import { describe, expect, it } from "vitest";
import { datasDaDespesaDeCartao, proximoVencimentoFatura } from "@/pages/malote/cartaoEspecial";

describe("[SEM-CHAMADO] despesa de cartão com Fluxo Especial", () => {
  it("paga no dia da criação, com competência no mês de hoje", () => {
    expect(datasDaDespesaDeCartao("2026-10-19")).toEqual({ dataPagamento: "2026-10-19", competencia: "2026-10" });
  });

  it("a competência acompanha o mês do lançamento (virada de mês e de ano)", () => {
    expect(datasDaDespesaDeCartao("2026-11-02")).toEqual({ dataPagamento: "2026-11-02", competencia: "2026-11" });
    expect(datasDaDespesaDeCartao("2026-12-31")).toEqual({ dataPagamento: "2026-12-31", competencia: "2026-12" });
  });
});

describe("despesa PARCELADA no cartão com Fluxo Especial — 1ª parcela no vencimento da fatura", () => {
  // 27/10/2026 é terça-feira.
  it("fecha antes do vencimento: compra após o fechamento cai na fatura do mês seguinte, que vence no mesmo mês (fim de semana → sexta)", () => {
    // fecha dia 8 (já passou) → fatura fecha 08/11 e vence dia 15 = domingo → sexta 13/11
    expect(proximoVencimentoFatura("2026-10-27", 8, 15)).toBe("2026-11-13");
  });

  it("vencimento antes do fechamento: vence no mês seguinte ao do fechamento", () => {
    // fecha dia 20 (ainda não passou? 27 > 20 → fecha 20/11), vence dia 15 < 20 → 15/12 (terça)
    expect(proximoVencimentoFatura("2026-10-27", 20, 15)).toBe("2026-12-15");
    // fecha dia 25, vence dia 5: fecha 25/11, vence 05/12 (sábado → sexta 04/12)
    expect(proximoVencimentoFatura("2026-10-27", 25, 5)).toBe("2026-12-04");
  });

  it("compra até o dia do fechamento ainda entra na fatura que fecha neste mês", () => {
    // fecha dia 28 e hoje é 27: fecha 28/10, vence dia 5 (< 28) → 05/11 (quinta)
    expect(proximoVencimentoFatura("2026-10-27", 28, 5)).toBe("2026-11-05");
    // no próprio dia do fechamento ainda entra
    expect(proximoVencimentoFatura("2026-10-28", 28, 5)).toBe("2026-11-05");
    expect(proximoVencimentoFatura("2026-10-29", 28, 5)).toBe("2026-12-04");
  });

  it("virada de ano e mês curto", () => {
    expect(proximoVencimentoFatura("2026-12-27", 8, 15)).toBe("2027-01-15"); // sexta
    // dia 31 em fevereiro vira o último dia do mês (28/02/2027 é domingo → sexta 26/02)
    expect(proximoVencimentoFatura("2027-01-20", 10, 31)).toBe("2027-02-26");
  });
});
