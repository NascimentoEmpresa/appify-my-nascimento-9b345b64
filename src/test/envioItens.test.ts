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

/**
 * SIS-2026-0824 — a outra ponta da MESMA conta.
 *
 * O Dashboard de Compras e Estoque repete esta pendência em SQL
 * (`pendente_por_item`, migration 20261110000100) para somar todos os pedidos
 * de uma vez, porque aqui ela é calculada um pedido por vez no navegador. Os
 * dois lados têm de dar o mesmo número — senão o gerente vê 2 numa tela e 3 na
 * outra. Este teste fixa o cenário descrito pelo solicitante; o espelho está
 * em `src/test/dashboard-posicao-por-item.test.ts`.
 */
describe("pendência por item, somada entre pedidos (espelho do dashboard)", () => {
  it("3 pedidos de calça sarja M deixam 2 pendentes no total", () => {
    // P1: pediu 3, saíram 2 pelo ledger.
    const p1 = calcularEnvioItens([item("p1-calca", 3)], [{ pedido_item_id: "p1-calca", quantidade: 2 }]);
    // P2: pediu 2, saiu 1 por etiqueta única.
    const p2 = calcularEnvioItens([item("p2-calca", 2)], [{ pedido_item_id: "p2-calca", quantidade: 1 }]);
    // P3: pediu 2, saíram 2 — nada pendente.
    const p3 = calcularEnvioItens([item("p3-calca", 2)], [{ pedido_item_id: "p3-calca", quantidade: 2 }]);

    const total = [...p1, ...p2, ...p3].reduce((soma, l) => soma + l.pendente, 0);
    expect(total).toBe(2);
  });

  it("pedido despachado sem baixa nenhuma não entra na soma, mesmo tendo quantidade", () => {
    const linhas = calcularEnvioItens([item("p4-calca", 5)], []);
    // A linha diz 5 pendentes...
    expect(linhas[0].pendente).toBe(5);
    // ...mas o pedido inteiro é descartado antes de somar, porque não há
    // registro por peça. É a mesma exclusão que o SQL faz.
    expect(despachadoSemRegistroDeSaida("DESPACHADO", [])).toBe(true);
  });
});
