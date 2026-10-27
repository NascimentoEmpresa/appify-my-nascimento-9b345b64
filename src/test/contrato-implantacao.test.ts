import { describe, expect, it } from "vitest";
import {
  cicloInicio, errosImplantacao, paraPayload, proximaRenovacao, rotuloImplantado, type LinhaForm,
} from "@/lib/licitacoes/implantacao";

const linha = (p: Partial<LinhaForm>): LinhaForm => ({ posto: "SERVENTE", previsto: 10, implantado: "10", justificativa: "", ...p });

describe("errosImplantacao", () => {
  it("igual ao previsto não exige justificativa", () => {
    expect(errosImplantacao([linha({})])).toEqual({});
  });
  it("diferente do previsto exige justificativa", () => {
    expect(errosImplantacao([linha({ implantado: "8" })]).SERVENTE).toMatch(/justifique/);
    expect(errosImplantacao([linha({ implantado: "8", justificativa: "  ok " })]).SERVENTE).toBeDefined();
    expect(errosImplantacao([linha({ implantado: "8", justificativa: "Tomador pediu 8 postos" })])).toEqual({});
  });
  it("implantado acima do previsto também precisa de justificativa", () => {
    expect(errosImplantacao([linha({ implantado: "12" })]).SERVENTE).toBeDefined();
  });
  it("número inválido", () => {
    for (const v of ["", "-1", "2.5", "abc"]) expect(errosImplantacao([linha({ implantado: v })]).SERVENTE).toMatch(/inteiro/);
  });
  it("zero é válido (posto não implantado), com justificativa", () => {
    expect(errosImplantacao([linha({ implantado: "0", justificativa: "Posto suspenso pelo tomador" })])).toEqual({});
  });
});

describe("paraPayload", () => {
  it("converte o número e limpa a justificativa", () => {
    expect(paraPayload([linha({ implantado: " 8 ", justificativa: "  motivo  " }), linha({ posto: "COPEIRO", justificativa: " " })]))
      .toEqual([{ posto: "SERVENTE", implantado: 8, justificativa: "motivo" }, { posto: "COPEIRO", implantado: 10, justificativa: null }]);
  });
});

describe("ciclo anual", () => {
  it("último aniversário da vigência inicial", () => {
    expect(cicloInicio("2024-03-15", "2026-10-27")).toBe("2026-03-15");
    expect(cicloInicio("2024-11-01", "2026-10-27")).toBe("2025-11-01");
    expect(cicloInicio("2024-10-27", "2026-10-27")).toBe("2026-10-27");
  });
  it("sem data ou contrato que ainda não começou: sem ciclo", () => {
    expect(cicloInicio(null, "2026-10-27")).toBeNull();
    expect(cicloInicio("2026-12-01", "2026-10-27")).toBeNull();
  });
  it("29/02 vira 28/02 em ano comum", () => {
    expect(cicloInicio("2024-02-29", "2026-10-27")).toBe("2026-02-28");
  });
  it("próxima renovação", () => {
    expect(proximaRenovacao("2024-03-15", "2026-10-27")).toBe("2027-03-15");
    expect(proximaRenovacao("2024-11-01", "2026-10-27")).toBe("2026-11-01");
    expect(proximaRenovacao("2024-10-27", "2026-10-27")).toBe("2027-10-27");
    expect(proximaRenovacao("2026-12-01", "2026-10-27")).toBe("2026-12-01");
    expect(proximaRenovacao(null, "2026-10-27")).toBeNull();
  });
});

describe("rotuloImplantado", () => {
  it("mostra o previsto só quando difere", () => {
    expect(rotuloImplantado(10, 10)).toBe("10");
    expect(rotuloImplantado(8, 10)).toBe("8 de 10 previstos");
    expect(rotuloImplantado(0, 1)).toBe("0 de 1 previsto");
  });
});
