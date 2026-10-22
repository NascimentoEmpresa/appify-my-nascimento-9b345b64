import { describe, expect, it } from "vitest";
import { competenciaDoMes } from "@/hooks/useNfEmissao";

// SIS-2026-0684: ajuste de competência da NF já emitida (Relatório de Serviços).
describe("competenciaDoMes", () => {
  it("transforma o mês do input no 1º dia, como a competência é gravada", () => {
    expect(competenciaDoMes("2026-10")).toBe("2026-10-01");
    expect(competenciaDoMes("2026-01")).toBe("2026-01-01");
  });
  it("recusa vazio e formatos inválidos", () => {
    expect(competenciaDoMes("")).toBeNull();
    expect(competenciaDoMes("2026-13")).toBeNull();
    expect(competenciaDoMes("2026-00")).toBeNull();
    expect(competenciaDoMes("10/2026")).toBeNull();
    expect(competenciaDoMes("2026-10-01")).toBeNull();
  });
});
