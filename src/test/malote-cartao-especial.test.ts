import { describe, expect, it } from "vitest";
import { proximoVencimentoCartao } from "@/pages/malote/cartaoEspecial";

describe("[SEM-CHAMADO] próximo vencimento do cartão (despesa de cartão com Fluxo Especial)", () => {
  it("no próprio dia do vencimento vale hoje", () => {
    expect(proximoVencimentoCartao(15, "2026-10-15")).toBe("2026-10-15");
  });

  it("antes do vencimento vale o dia deste mês", () => {
    expect(proximoVencimentoCartao(15, "2026-10-05")).toBe("2026-10-15");
  });

  it("depois do vencimento vale o do mês seguinte", () => {
    expect(proximoVencimentoCartao(15, "2026-10-16")).toBe("2026-11-15");
  });

  it("virada de ano", () => {
    expect(proximoVencimentoCartao(10, "2026-12-20")).toBe("2027-01-10");
  });

  it("mês curto usa o último dia (vencimento 31 em fevereiro)", () => {
    expect(proximoVencimentoCartao(31, "2027-02-10")).toBe("2027-02-28");
    expect(proximoVencimentoCartao(31, "2028-02-10")).toBe("2028-02-29");
    expect(proximoVencimentoCartao(30, "2026-04-30")).toBe("2026-04-30");
  });

  it("vencimento 31 já passado em fevereiro vai para março no dia 31", () => {
    expect(proximoVencimentoCartao(31, "2027-03-01")).toBe("2027-03-31");
  });
});
