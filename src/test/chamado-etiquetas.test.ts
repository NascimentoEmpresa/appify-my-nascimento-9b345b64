import { describe, expect, it } from "vitest";
import { corTextoSobre, etiquetasPorChamado, validarEtiqueta, type Etiqueta } from "@/lib/chamados/etiquetas";

const urgente: Etiqueta = { id: "e1", nome: "Urgente", cor: "#ef4444" };
const revisar: Etiqueta = { id: "e2", nome: "A revisar", cor: "#eab308" };

describe("Chamado — etiquetas pessoais do dev", () => {
  it("valida nome, tamanho, cor e nome repetido (sem diferenciar maiúscula)", () => {
    expect(validarEtiqueta("  ", "#ef4444", [])).toMatch(/nome/);
    expect(validarEtiqueta("x".repeat(31), "#ef4444", [])).toMatch(/30/);
    expect(validarEtiqueta("Nova", "vermelho", [])).toMatch(/cor/);
    expect(validarEtiqueta("  urgente ", "#000000", [urgente])).toMatch(/já tem/);
    expect(validarEtiqueta("Urgente", "#000000", [urgente], "e1")).toBeNull(); // renomear a própria
    expect(validarEtiqueta("Cliente   VIP", "#3b82f6", [urgente])).toBeNull();
  });

  it("texto preto em cor clara, branco em cor escura", () => {
    expect(corTextoSobre("#eab308")).toBe("#000000");
    expect(corTextoSobre("#1e293b")).toBe("#ffffff");
    expect(corTextoSobre("lixo")).toBe("#000000");
  });

  it("agrupa por chamado, em ordem alfabética, ignorando vínculo de etiqueta que não é minha", () => {
    const m = etiquetasPorChamado([urgente, revisar], [
      { etiqueta_id: "e1", chamado_id: "c1" },
      { etiqueta_id: "e2", chamado_id: "c1" },
      { etiqueta_id: "e2", chamado_id: "c2" },
      { etiqueta_id: "outra", chamado_id: "c3" },
    ]);
    expect(m.c1.map((e) => e.nome)).toEqual(["A revisar", "Urgente"]);
    expect(m.c2).toEqual([revisar]);
    expect(m.c3).toBeUndefined();
  });
});
