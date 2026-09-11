import { describe, expect, it } from "vitest";
import {
  ETIQUETAS_RECRUTAMENTO, VALORES_ETIQUETAS, alternarEtiqueta, corDaEtiqueta, etiquetasValidas,
} from "@/lib/recrutamento/etiquetas";

describe("etiquetas da solicitação de vaga", () => {
  it("o catálogo tem o que foi pedido e não repete valor", () => {
    for (const v of ["Confere", "Visto", "OK", "Revisar", "Digitar"]) expect(VALORES_ETIQUETAS).toContain(v);
    expect(new Set(VALORES_ETIQUETAS).size).toBe(ETIQUETAS_RECRUTAMENTO.length);
  });

  it("alternar liga e desliga, sempre na ordem do catálogo", () => {
    expect(alternarEtiqueta([], "Revisar")).toEqual(["Revisar"]);
    expect(alternarEtiqueta(["Revisar"], "Confere")).toEqual(["Confere", "Revisar"]);
    expect(alternarEtiqueta(["Confere", "Revisar"], "Revisar")).toEqual(["Confere"]);
    expect(alternarEtiqueta(null, "OK")).toEqual(["OK"]);
  });

  it("alternar não deixa passar valor fora do catálogo que já estivesse na lista", () => {
    expect(alternarEtiqueta(["inventada", "OK"], "Visto")).toEqual(["Visto", "OK"]);
  });

  it("etiquetasValidas filtra e ordena o que veio do banco", () => {
    expect(etiquetasValidas(["Digitar", "xpto", "Confere"])).toEqual(["Confere", "Digitar"]);
    expect(etiquetasValidas(null)).toEqual([]);
  });

  it("valor desconhecido ganha cor neutra em vez de quebrar", () => {
    expect(corDaEtiqueta("OK").texto).toBe("#166534");
    expect(corDaEtiqueta("xpto").bg).toBe("#f8fafc");
  });
});
