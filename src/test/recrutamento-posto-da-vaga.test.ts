import { describe, it, expect } from "vitest";

import { postoELocalDaVaga } from "@/lib/recrutamento/postoDaVaga";
import { faltandoNaFicha, localExatoDaFicha, textoChecklistAso } from "@/lib/recrutamento/fichaAso";

describe("postoELocalDaVaga", () => {
  it("vaga editada no Recrutamento: posto vem do catálogo, endereço vira local exato (#1418)", () => {
    expect(postoELocalDaVaga("D2 - MOTORISTA CAT. D PORTO ALEGRE", "Campus vale .av,bento gonçalves 9500 porto alegre"))
      .toEqual({ posto: "D2 - MOTORISTA CAT. D PORTO ALEGRE", local: "Campus vale .av,bento gonçalves 9500 porto alegre" });
  });

  it("vaga do encarregado: local_exato é o próprio nome do posto e não repete", () => {
    expect(postoELocalDaVaga("SAMU PORTO ALEGRE", "SAMU PORTO ALEGRE")).toEqual({ posto: "SAMU PORTO ALEGRE", local: "" });
    expect(postoELocalDaVaga("PALÁCIO DA POLÍCIA", "Palacio da  Policia")).toEqual({ posto: "PALÁCIO DA POLÍCIA", local: "" });
  });

  it("sem posto no catálogo: não inventa posto, mantém o local digitado", () => {
    expect(postoELocalDaVaga(null, "Campus Centro, prédio 12")).toEqual({ posto: "", local: "Campus Centro, prédio 12" });
    expect(postoELocalDaVaga("", null)).toEqual({ posto: "", local: "" });
  });
});

describe("ficha do ASO: endereço / local exato", () => {
  const base = { tipo_aso: "Admissional", nome: "JORGE", posto: "D1 - MOTORISTA CAT. D PORTO ALEGRE", local_cidade: "Porto Alegre" };

  it("leva o endereço digitado na vaga para a ficha e para o checklist (#1418)", () => {
    const f = { ...base, local_exato: "Campus vale .av,bento gonçalves 9500 porto alegre" };
    expect(localExatoDaFicha(f)).toBe("Campus vale .av,bento gonçalves 9500 porto alegre");
    expect(textoChecklistAso(f)).toContain("Local / Cidade: Porto Alegre\nEndereço / Local exato: Campus vale .av,bento gonçalves 9500 porto alegre\nCelular:");
  });

  it("sem endereço (ou só o nome do posto repetido) a linha nem aparece e não conta como falta", () => {
    for (const local_exato of [null, "", "D1 - MOTORISTA CAT. D PORTO ALEGRE"]) {
      const f = { ...base, local_exato };
      expect(localExatoDaFicha(f)).toBe("");
      expect(textoChecklistAso(f)).not.toContain("Endereço");
      expect(faltandoNaFicha(f)).not.toContain("local_exato");
    }
  });
});
