import { describe, expect, it } from "vitest";
import { calcularEnvioItens, despachadoSemRegistroDeSaida, type ItemParaEnvio } from "@/lib/suprimentos/envioItens";

const item = (id: string, quantidade: number, ordem = 0): ItemParaEnvio => ({
  id, nome_item: id.toUpperCase(), tamanho: "G", litros: null, quantidade, ordem,
});

describe("calcularEnvioItens", () => {
  it("item sem etiqueta fica todo pendente", () => {
    const [l] = calcularEnvioItens([item("camiseta", 2)], []);
    expect(l.enviada).toBe(0);
    expect(l.pendente).toBe(2);
  });

  it("despacho parcial aparece nas duas listas", () => {
    const [l] = calcularEnvioItens([item("camiseta", 2)], [{ pedido_item_id: "camiseta", quantidade: 1 }]);
    expect(l.enviada).toBe(1);
    expect(l.pendente).toBe(1);
  });

  it("soma etiqueta única e lote em massa do mesmo item", () => {
    const [l] = calcularEnvioItens([item("luva", 5)], [
      { pedido_item_id: "luva", quantidade: 1 },
      { pedido_item_id: "luva", quantidade: 4 },
    ]);
    expect(l.enviada).toBe(5);
    expect(l.pendente).toBe(0);
  });

  it("saída acima do pedido não gera pendência negativa", () => {
    const [l] = calcularEnvioItens([item("calca", 1)], [{ pedido_item_id: "calca", quantidade: 2 }]);
    expect(l.enviada).toBe(2);
    expect(l.pendente).toBe(0);
  });

  it("etiqueta de outro item não contamina e a ordem do pedido é mantida", () => {
    const linhas = calcularEnvioItens(
      [item("b", 1, 2), item("a", 1, 1)],
      [{ pedido_item_id: "a", quantidade: 1 }, { pedido_item_id: "removido", quantidade: 3 }],
    );
    expect(linhas.map((l) => [l.id, l.enviada, l.pendente])).toEqual([["a", 1, 0], ["b", 0, 1]]);
  });
});

describe("despachadoSemRegistroDeSaida (SIS-2026-0799)", () => {
  it("despachado sem nenhuma saída no estoque não afirma que tudo está pendente", () => {
    expect(despachadoSemRegistroDeSaida("DESPACHADO", [])).toBe(true);
  });

  it("despachado com alguma saída é parcial de verdade — pendentes continuam aparecendo", () => {
    expect(despachadoSemRegistroDeSaida("DESPACHADO", [{ pedido_item_id: "a", quantidade: 1 }])).toBe(false);
  });

  it("antes do despacho, nada saiu ainda é simplesmente pendente", () => {
    expect(despachadoSemRegistroDeSaida("AGUARDANDO ENVIO", [])).toBe(false);
    expect(despachadoSemRegistroDeSaida("RETIRADO PARA ENTREGA", [])).toBe(false);
  });
});
