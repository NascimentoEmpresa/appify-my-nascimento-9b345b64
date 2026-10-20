import { describe, expect, it } from "vitest";
import { abrirChamadoTravado, LIMITE_AVALIACOES_PENDENTES } from "@/pages/chamados/validacaoPresidencia";
import {
  CRITERIOS_AVALIACAO_SOLICITANTE,
  mediaAvaliacaoSolicitante,
} from "@/pages/chamados/types";

// 20/10/2026 (mig 20261020000070): "se eu ficar sem avaliar 3 chamados não
// posso abrir o próximo". Antes travava na primeira pendente.
describe("trava de abrir chamado com avaliações pendentes", () => {
  const p = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i) }));

  it("o limite é 3 — o gatilho do banco usa o mesmo número", () => {
    expect(LIMITE_AVALIACOES_PENDENTES).toBe(3);
  });

  it("com 0, 1 ou 2 pendentes ainda abre", () => {
    expect(abrirChamadoTravado(p(0))).toBe(false);
    expect(abrirChamadoTravado(p(1))).toBe(false);
    expect(abrirChamadoTravado(p(2))).toBe(false);
  });

  it("na 3ª sem avaliar (ou mais) trava", () => {
    expect(abrirChamadoTravado(p(3))).toBe(true);
    expect(abrirChamadoTravado(p(7))).toBe(true);
  });
});

describe("avaliação de quem pediu, feita pelo dev", () => {
  it("os pesos somam 1 — senão a nota final não vai de 1 a 5", () => {
    const soma = CRITERIOS_AVALIACAO_SOLICITANTE.reduce((s, c) => s + c.peso, 0);
    expect(soma).toBeCloseTo(1, 10);
  });

  it("nota cheia dá 5 e nota mínima dá 1", () => {
    const todas = (n: number) => Object.fromEntries(CRITERIOS_AVALIACAO_SOLICITANTE.map((c) => [c.key, n])) as never;
    expect(mediaAvaliacaoSolicitante(todas(5))).toBeCloseTo(5);
    expect(mediaAvaliacaoSolicitante(todas(1))).toBeCloseTo(1);
  });

  it("clareza pesa mais que colaboração (0,30 x 0,15)", () => {
    const base = Object.fromEntries(CRITERIOS_AVALIACAO_SOLICITANTE.map((c) => [c.key, 5])) as Record<string, number>;
    const semClareza = mediaAvaliacaoSolicitante({ ...base, clareza: 1 } as never);
    const semColaboracao = mediaAvaliacaoSolicitante({ ...base, colaboracao: 1 } as never);
    expect(semClareza).toBeLessThan(semColaboracao);
  });
});
