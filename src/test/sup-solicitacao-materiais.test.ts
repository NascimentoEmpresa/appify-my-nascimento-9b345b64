import { describe, expect, it } from "vitest";
import {
  QUANTIDADE_MAXIMA_SOLICITACAO,
  normalizarQuantidadeSolicitada,
  quantidadeSolicitadaValida,
} from "@/lib/suprimentos/solicitacaoMateriais";

describe("quantidade da solicitação de materiais", () => {
  it("aceita tanto uma opção predefinida quanto uma quantidade digitada", () => {
    expect(normalizarQuantidadeSolicitada("4")).toBe(4);
    expect(normalizarQuantidadeSolicitada("24")).toBe(24);
    expect(quantidadeSolicitadaValida("120")).toBe(true);
  });

  it.each(["", "0", "-1", "1.5", "1,5", "1e3", "abc"])(
    "recusa quantidade inválida: %s",
    (valor) => expect(normalizarQuantidadeSolicitada(valor)).toBeNull(),
  );

  it("protege o limite integer usado no banco", () => {
    expect(normalizarQuantidadeSolicitada(String(QUANTIDADE_MAXIMA_SOLICITACAO)))
      .toBe(QUANTIDADE_MAXIMA_SOLICITACAO);
    expect(normalizarQuantidadeSolicitada(String(QUANTIDADE_MAXIMA_SOLICITACAO + 1)))
      .toBeNull();
  });
});
