import { describe, it, expect } from "vitest";
import {
  calcularCicloUniforme,
  type EntregaUniforme,
} from "@/lib/suprimentos/cicloUniforme";

/**
 * A regra do Eduardo (26/08/2026) tem duas metades que se comportam de forma
 * oposta, e é justamente na fronteira delas que erro passa despercebido:
 * receber DE MENOS nunca alerta, receber DEMAIS alerta.
 */

/** Data ISO a N meses atrás de hoje, para os testes não quebrarem com o tempo. */
function mesesAtras(n: number): string {
  const h = new Date();
  const d = new Date(Date.UTC(h.getFullYear(), h.getMonth() - n, h.getDate()));
  return d.toISOString().slice(0, 10);
}

function diasAtras(n: number): string {
  const h = new Date();
  const d = new Date(Date.UTC(h.getFullYear(), h.getMonth(), h.getDate() - n));
  return d.toISOString().slice(0, 10);
}

const entrega = (pedidoId: string, entregueEm: string): EntregaUniforme => ({
  pedidoId,
  entregueEm,
});

describe("ciclo de troca de uniforme", () => {
  it("sem entrega nenhuma não cobra troca — admitido hoje não está atrasado", () => {
    const r = calcularCicloUniforme([]);
    expect(r.trocaDevida).toBe(false);
    expect(r.excesso).toBe(false);
    expect(r.ultimaEntrega).toBeNull();
  });

  it("uma entrega recente não cobra troca nem acusa excesso", () => {
    const r = calcularCicloUniforme([entrega("p1", diasAtras(30))]);
    expect(r.entregasNaJanela).toBe(1);
    expect(r.trocaDevida).toBe(false);
    expect(r.excesso).toBe(false);
  });

  it("passados 13 meses da última entrega, a troca é devida", () => {
    const r = calcularCicloUniforme([entrega("p1", mesesAtras(13))]);
    expect(r.trocaDevida).toBe(true);
    expect(r.entregasNaJanela).toBe(0);
    expect(r.mesesDesdeUltima).toBe(13);
  });

  it("no dia exato em que fecha o ciclo a troca já é devida", () => {
    const r = calcularCicloUniforme([entrega("p1", mesesAtras(12))]);
    expect(r.trocaDevida).toBe(true);
  });

  it("um dia antes de fechar o ciclo ainda não é devida", () => {
    const r = calcularCicloUniforme([entrega("p1", diasAtras(364))]);
    expect(r.trocaDevida).toBe(false);
  });

  it("duas entregas na janela é o previsto em contrato, não é excesso", () => {
    const r = calcularCicloUniforme([
      entrega("p1", mesesAtras(2)),
      entrega("p2", mesesAtras(8)),
    ]);
    expect(r.entregasNaJanela).toBe(2);
    expect(r.excesso).toBe(false);
  });

  it("três entregas na janela acusa excesso", () => {
    const r = calcularCicloUniforme([
      entrega("p1", mesesAtras(1)),
      entrega("p2", mesesAtras(5)),
      entrega("p3", mesesAtras(9)),
    ]);
    expect(r.entregasNaJanela).toBe(3);
    expect(r.excesso).toBe(true);
  });

  it("entregas antigas saem da janela e deixam de contar para excesso", () => {
    const r = calcularCicloUniforme([
      entrega("p1", mesesAtras(1)),
      entrega("p2", mesesAtras(5)),
      entrega("p3", mesesAtras(20)),
      entrega("p4", mesesAtras(30)),
    ]);
    expect(r.entregasNaJanela).toBe(2);
    expect(r.excesso).toBe(false);
  });

  it("dezembro e janeiro em anos diferentes contam na mesma janela", () => {
    // O caso que um corte por ano-calendário deixaria passar: três entregas
    // em ~13 meses, mas duas de um ano e uma de outro.
    const r = calcularCicloUniforme([
      entrega("p1", mesesAtras(1)),
      entrega("p2", mesesAtras(6)),
      entrega("p3", mesesAtras(11)),
    ]);
    expect(r.excesso).toBe(true);
  });

  it("o mesmo pedido repetido conta uma vez só — é um evento, não N peças", () => {
    const r = calcularCicloUniforme([
      entrega("p1", mesesAtras(1)),
      entrega("p1", mesesAtras(1)),
      entrega("p1", mesesAtras(1)),
      entrega("p1", mesesAtras(1)),
    ]);
    expect(r.entregasNaJanela).toBe(1);
    expect(r.excesso).toBe(false);
  });

  it("data inválida é ignorada em vez de derrubar o cálculo", () => {
    const r = calcularCicloUniforme([
      entrega("p1", "data-que-nao-existe"),
      entrega("p2", "2026-02-31"),
      entrega("p3", mesesAtras(2)),
    ]);
    expect(r.entregasNaJanela).toBe(1);
  });

  it("o limite da janela é parâmetro, para o Cassio ajustar sem tocar em código", () => {
    const entregas = [
      entrega("p1", mesesAtras(1)),
      entrega("p2", mesesAtras(4)),
      entrega("p3", mesesAtras(7)),
    ];
    expect(calcularCicloUniforme(entregas, 12, 2).excesso).toBe(true);
    expect(calcularCicloUniforme(entregas, 12, 3).excesso).toBe(false);
  });
});
