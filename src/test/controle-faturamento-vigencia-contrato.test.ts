import { describe, expect, it } from "vitest";
import { contratoEncerradoNaCompetencia, fimDoContrato } from "@/pages/controladoria/vigenciaContrato";

const caxias162 = { data_fim_vigencia: "2026-02-28", vigencia_final: "2026-02-28" };

describe("vigência do contrato no Controle de Faturamento (SIS-2026-0605)", () => {
  it("Caxias 162 (fim 28/02/2026): fevereiro ainda vigente, março em diante encerrado", () => {
    expect(contratoEncerradoNaCompetencia(caxias162, "2026-01-01")).toBe(false);
    expect(contratoEncerradoNaCompetencia(caxias162, "2026-02-01")).toBe(false);
    expect(contratoEncerradoNaCompetencia(caxias162, "2026-03-01")).toBe(true);
    expect(contratoEncerradoNaCompetencia(caxias162, "2026-09-01")).toBe(true);
  });

  it("contrato sem data fim nunca é tratado como encerrado", () => {
    expect(contratoEncerradoNaCompetencia({ data_fim_vigencia: null, vigencia_final: null }, "2030-01-01")).toBe(false);
  });

  it("campos divergentes: vale o fim mais tardio (aditivo)", () => {
    expect(fimDoContrato({ data_fim_vigencia: "2026-02-28", vigencia_final: "2026-08-31" })).toBe("2026-08-31");
    expect(contratoEncerradoNaCompetencia({ data_fim_vigencia: "2026-02-28", vigencia_final: "2026-08-31" }, "2026-07-01")).toBe(false);
  });

  it("aceita só um dos dois campos preenchido", () => {
    expect(fimDoContrato({ data_fim_vigencia: null, vigencia_final: "2026-02-28" })).toBe("2026-02-28");
    expect(fimDoContrato({ data_fim_vigencia: "2026-02-28T00:00:00Z", vigencia_final: null })).toBe("2026-02-28");
  });
});
