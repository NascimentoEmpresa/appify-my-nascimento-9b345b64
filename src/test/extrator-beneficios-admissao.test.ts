import { describe, expect, it } from "vitest";
// @ts-expect-error módulo CommonJS do worker, sem tipos
import { admissaoParaBr, montarMapaAdmissoes } from "../../worker/src/extratorBeneficios/admissoes.js";

// Pedido do Pablo (10/11/2026): a planilha do SAMU saía sem Data de Admissão.
// Sem data na base, vale a do EMPREGADOS.

describe("Data de Admissão do extrator de benefícios", () => {
  it("formato do EMPREGADOS vira dd/mm/aaaa", () => {
    expect(admissaoParaBr("2026-06-29")).toBe("29/06/2026");
    expect(admissaoParaBr("4/8/2025")).toBe("04/08/2025");
    expect(admissaoParaBr("")).toBe("");
  });

  it("nome repetido: vale quem não está demitido, depois a admissão mais recente", () => {
    const m = montarMapaAdmissoes([
      { Nome: "Ana Karina da Silva", "Admissão": "2020-01-10", "Situação": "Demitido" },
      { Nome: "ANA KARINA DA SILVA", "Admissão": "2026-06-29", "Situação": "Trabalhando" },
      { Nome: "Grace Ávila", "Admissão": "2024-01-01", "Situação": "Trabalhando" },
      { Nome: "Grace Ávila", "Admissão": "2025-12-04", "Situação": "Férias" },
    ]);
    expect(m.get("ANA KARINA DA SILVA")).toBe("29/06/2026");
    expect(m.get("GRACE AVILA")).toBe("04/12/2025");
  });

});
