import { describe, expect, it } from "vitest";
import { abaPermitida } from "@/pages/controladoria/faturamento/abasPermitidas";

describe("Controle de Faturamento: abas por permissão", () => {
  it("com a visão completa, vale a aba pedida", () => {
    expect(abaPermitida("geral", true)).toBe("geral");
    expect(abaPermitida("anual", true)).toBe("anual");
    expect(abaPermitida("pendentes", true)).toBe("pendentes");
  });
  it("sem a visão completa, qualquer aba pedida vira NFs Não Emitidas (inclusive o padrão 'geral' e o clique de KPI)", () => {
    expect(abaPermitida("geral", false)).toBe("pendentes");
    expect(abaPermitida("anual", false)).toBe("pendentes");
    expect(abaPermitida("pendentes", false)).toBe("pendentes");
  });
});
