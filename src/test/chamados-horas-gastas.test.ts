import { describe, it, expect } from "vitest";
import { fmtHorasGastas, lerHorasGastas } from "@/lib/chamados/horasGastas";

describe("horas gastas ao concluir o chamado", () => {
  it("aceita hora cheia e meia hora, com vírgula ou ponto", () => {
    expect(lerHorasGastas("12,5")).toBe(12.5);
    expect(lerHorasGastas("12.5")).toBe(12.5);
    expect(lerHorasGastas(" 3 ")).toBe(3);
    expect(lerHorasGastas("0,5")).toBe(0.5);
  });

  it("recusa vazio, zero, negativo, texto e acima do teto", () => {
    for (const t of ["", "0", "0,0", "-2", "abc", "1,2,3", "5001", null, undefined]) {
      expect(lerHorasGastas(t)).toBeNull();
    }
  });

  it("mostra no formato brasileiro e '—' sem horas", () => {
    expect(fmtHorasGastas(12.5)).toBe("12,5");
    expect(fmtHorasGastas("3.00")).toBe("3");
    expect(fmtHorasGastas(null)).toBe("—");
  });
});
