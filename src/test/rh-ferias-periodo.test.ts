import { describe, expect, it } from "vitest";
import { passaNoPeriodo, ultimoDiaDoMes } from "@/lib/rh/feriasPeriodo";

const ferias = { data_saida: "2027-01-20", data_retorno: "2027-02-19", criado_em: "2026-10-22T13:00:00Z" };
const venda = { data_saida: null, data_retorno: null, criado_em: "2026-10-22T13:00:00Z" };

describe("Gestão de Férias — filtro de período", () => {
  it("sem período, tudo passa (inclusive venda)", () => {
    expect(passaNoPeriodo(ferias, "ferias", "", "")).toBe(true);
    expect(passaNoPeriodo(venda, "ferias", "", "")).toBe(true);
  });

  it("férias que atravessam o mês aparecem nos dois meses", () => {
    expect(passaNoPeriodo(ferias, "ferias", "2027-01-01", ultimoDiaDoMes("2027-01"))).toBe(true);
    expect(passaNoPeriodo(ferias, "ferias", "2027-02-01", ultimoDiaDoMes("2027-02"))).toBe(true);
    expect(passaNoPeriodo(ferias, "ferias", "2027-03-01", ultimoDiaDoMes("2027-03"))).toBe(false);
    expect(passaNoPeriodo(ferias, "ferias", "2026-12-01", ultimoDiaDoMes("2026-12"))).toBe(false);
  });

  it("limite de um lado só", () => {
    expect(passaNoPeriodo(ferias, "ferias", "2027-02-19", "")).toBe(true);
    expect(passaNoPeriodo(ferias, "ferias", "2027-02-20", "")).toBe(false);
    expect(passaNoPeriodo(ferias, "ferias", "", "2027-01-20")).toBe(true);
    expect(passaNoPeriodo(ferias, "ferias", "", "2027-01-19")).toBe(false);
  });

  it("venda de dias sai no modo férias e entra no modo criação", () => {
    expect(passaNoPeriodo(venda, "ferias", "2026-10-01", "2026-10-31")).toBe(false);
    expect(passaNoPeriodo(venda, "criado", "2026-10-01", "2026-10-31")).toBe(true);
  });

  it("modo criação usa a data em que a solicitação entrou", () => {
    expect(passaNoPeriodo(ferias, "criado", "2026-10-22", "2026-10-22")).toBe(true);
    expect(passaNoPeriodo(ferias, "criado", "2026-11-01", "")).toBe(false);
  });

  it("último dia do mês respeita fevereiro e bissexto", () => {
    expect(ultimoDiaDoMes("2027-02")).toBe("2027-02-28");
    expect(ultimoDiaDoMes("2028-02")).toBe("2028-02-29");
    expect(ultimoDiaDoMes("2026-12")).toBe("2026-12-31");
  });
});
