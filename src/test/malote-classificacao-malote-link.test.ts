import { describe, expect, it } from "vitest";
import { mapaClassificacaoVinculada, classificacaoCanonica } from "@/hooks/useMaloteClassificacaoMaloteLink";

// SIS-2026-0374 (Iury): "Pensão é uma classificação malote que não tem nada
// ligado a ela, então preciso ligar ela na classificação malote Salário" —
// toda conta de Orçado/Utilizado resolve a origem (sem orçamento próprio)
// pelo destino (com orçamento) antes de calcular.
describe("mapaClassificacaoVinculada", () => {
  it("monta o mapa origem → destino", () => {
    const mapa = mapaClassificacaoVinculada([
      { classificacao_malote_id: "pensao", classificacao_malote_vinculada_id: "salario" },
    ]);
    expect(mapa.get("pensao")).toBe("salario");
  });

  it("sem ligações, mapa vazio", () => {
    expect(mapaClassificacaoVinculada([]).size).toBe(0);
  });

  it("suporta múltiplas origens pro mesmo destino (many-to-one)", () => {
    const mapa = mapaClassificacaoVinculada([
      { classificacao_malote_id: "pensao", classificacao_malote_vinculada_id: "salario" },
      { classificacao_malote_id: "fgts", classificacao_malote_vinculada_id: "salario" },
    ]);
    expect(mapa.get("pensao")).toBe("salario");
    expect(mapa.get("fgts")).toBe("salario");
  });
});

describe("classificacaoCanonica", () => {
  const mapa = mapaClassificacaoVinculada([
    { classificacao_malote_id: "pensao", classificacao_malote_vinculada_id: "salario" },
  ]);

  it("origem resolve pro destino", () => {
    expect(classificacaoCanonica(mapa, "pensao")).toBe("salario");
  });

  it("classificação sem ligação (ex. o próprio destino) devolve ela mesma", () => {
    expect(classificacaoCanonica(mapa, "salario")).toBe("salario");
  });

  it("classificação qualquer sem ligação nenhuma devolve ela mesma", () => {
    expect(classificacaoCanonica(mapa, "outra-qualquer")).toBe("outra-qualquer");
  });

  it("null/undefined/vazio devolvem null", () => {
    expect(classificacaoCanonica(mapa, null)).toBeNull();
    expect(classificacaoCanonica(mapa, undefined)).toBeNull();
    expect(classificacaoCanonica(mapa, "")).toBeNull();
  });
});
