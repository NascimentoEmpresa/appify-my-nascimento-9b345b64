import { describe, it, expect } from "vitest";
import { dataParaIso, tempoDeEmpresa } from "@/lib/rh/colaboradoresUtils";

// EMPREGADOS."Admissão" vem em dois formatos (ISO na maioria, DD/MM/AAAA numa
// minoria). Antes, a demissão mandava a string crua pra coluna `date` e o
// banco estourava em "26/08/2026"; e o conversor de Férias devolvia NULL pra
// quem já estava em ISO. Este arquivo trava o conversor único (17/09/2026).
describe("dataParaIso", () => {
  it("DD/MM/AAAA vira AAAA-MM-DD", () => {
    expect(dataParaIso("26/08/2026")).toBe("2026-08-26");
    expect(dataParaIso("1/2/2024")).toBe("2024-02-01");
  });
  it("ISO (com ou sem hora) passa como data", () => {
    expect(dataParaIso("2026-08-26")).toBe("2026-08-26");
    expect(dataParaIso("2026-08-26T00:00:00")).toBe("2026-08-26");
  });
  it("vazio, inválido e o 'zero' do legado (ano < 1900) viram NULL", () => {
    expect(dataParaIso("")).toBeNull();
    expect(dataParaIso(null)).toBeNull();
    expect(dataParaIso("abc")).toBeNull();
    expect(dataParaIso("30/12/1899")).toBeNull();
  });
});

describe("tempoDeEmpresa", () => {
  const hoje = new Date(2026, 8, 17); // 17/09/2026
  it("conta anos e meses completos desde a admissão", () => {
    expect(tempoDeEmpresa("2024-06-10", hoje)).toBe("2 anos e 3 meses");
    expect(tempoDeEmpresa("17/09/2025", hoje)).toBe("1 ano");
    expect(tempoDeEmpresa("2026-08-01", hoje)).toBe("1 mês");
  });
  it("dia ainda não chegou no mês: não conta o mês", () => {
    expect(tempoDeEmpresa("2026-08-20", hoje)).toBe("menos de 1 mês");
    expect(tempoDeEmpresa("2025-09-18", hoje)).toBe("11 meses");
  });
  it("sem admissão ou no futuro: vazio", () => {
    expect(tempoDeEmpresa(null, hoje)).toBe("");
    expect(tempoDeEmpresa("2027-01-01", hoje)).toBe("");
  });
});
