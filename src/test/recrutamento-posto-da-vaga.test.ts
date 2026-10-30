import { describe, it, expect } from "vitest";

import { postoELocalDaVaga } from "@/lib/recrutamento/postoDaVaga";

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
