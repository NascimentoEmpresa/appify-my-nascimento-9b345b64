import { describe, it, expect } from "vitest";
import { SITUACOES_PAGAMENTO, corSituacao, opcoesSituacao } from "@/pages/juridico/patrimonio/carteira";

describe("Patrimônio — Situação (etiqueta)", () => {
  it("ALUGADO e VENDIDO são opções do formulário e do filtro", () => {
    expect(SITUACOES_PAGAMENTO).toEqual(expect.arrayContaining(["ALUGADO", "VENDIDO", "PAGO"]));
  });

  it("valor antigo fora da lista continua aparecendo (não some ao editar)", () => {
    expect(opcoesSituacao("QUITADO", null, "PAGO", "", "QUITADO")).toEqual([...SITUACOES_PAGAMENTO, "QUITADO"]);
    expect(opcoesSituacao()).toEqual(SITUACOES_PAGAMENTO);
  });

  it("ALUGADO tem cor própria; VENDIDO fica no cinza neutro", () => {
    expect(corSituacao("ALUGADO").fg).not.toBe(corSituacao("VENDIDO").fg);
    expect(corSituacao("VENDIDO")).toEqual(corSituacao(""));
  });
});
