import { describe, expect, it } from "vitest";
import {
  dataBR, dataLiberacao, diaDeBrasilia, diasParaLiberar, itensDaPrevia, podeLiberar, rankingMural,
} from "@/lib/formularios/muralReconhecimento";

// Espelho da trava do banco (mig 20261103001300, cs_form_mural_libera_em):
// votos de um mês só vão ao mural a partir do dia 20 do mês seguinte.

describe("trava de liberação — dia 20 do mês seguinte", () => {
  it("outubro libera em 20/11; dezembro vira o ano", () => {
    expect(dataLiberacao("2026-10")).toBe("2026-11-20");
    expect(dataLiberacao("2026-12")).toBe("2027-01-20");
    expect(dataBR(dataLiberacao("2026-10"))).toBe("20/11/2026");
  });

  it("bloqueia até 19/11 e abre em 20/11, no relógio de Brasília", () => {
    expect(podeLiberar("2026-10", new Date("2026-11-03T12:00:00-03:00"))).toBe(false);
    expect(podeLiberar("2026-10", new Date("2026-11-19T23:59:00-03:00"))).toBe(false);
    expect(podeLiberar("2026-10", new Date("2026-11-20T00:00:00-03:00"))).toBe(true);
    expect(podeLiberar("2026-10", new Date("2027-02-01T10:00:00-03:00"))).toBe(true);
    // 02:00 UTC do dia 20 ainda é 19/11 em Brasília.
    expect(podeLiberar("2026-10", new Date("2026-11-20T02:00:00Z"))).toBe(false);
    expect(diaDeBrasilia(new Date("2026-11-20T02:00:00Z"))).toBe("2026-11-19");
  });

  it("conta os dias que faltam", () => {
    expect(diasParaLiberar("2026-10", new Date("2026-11-03T09:00:00-03:00"))).toBe(17);
    expect(diasParaLiberar("2026-10", new Date("2026-11-19T22:00:00-03:00"))).toBe(1);
    expect(diasParaLiberar("2026-10", new Date("2026-11-20T08:00:00-03:00"))).toBe(0);
    expect(diasParaLiberar("2026-10", new Date("2026-12-25T08:00:00-03:00"))).toBe(0);
    // Mês corrente: novembro só em 20/12.
    expect(diasParaLiberar("2026-11", new Date("2026-11-03T09:00:00-03:00"))).toBe(47);
  });
});

describe("ranking por pessoa", () => {
  const l = (colaborador: string, nota: number | string, setor: string | null = "RH") => ({ colaborador, nota, setor });

  it("mais comentários primeiro, nota média desempata", () => {
    const r = rankingMural([
      l("Ana", 4), l("Bruno", 5), l("Ana", 5), l("Carla", 5), l("Carla", 5), l("Bruno", 4), l("Davi", 5),
    ]);
    expect(r.map((p) => [p.posicao, p.colaborador, p.total])).toEqual([
      [1, "Carla", 2], [2, "Ana", 2], [2, "Bruno", 2], [4, "Davi", 1],
    ]);
    expect(r[0].media).toBe(5);
    expect(r[1].media).toBe(4.5);
  });

  it("agrupa o mesmo nome sem caixa nem espaços e fica com o setor mais citado", () => {
    const r = rankingMural([
      l("PABLO NASCIMENTO", 5, "SISTEMAS"), l(" pablo nascimento ", 5, "SISTEMAS"), l("Pablo Nascimento", "4,5", "TI"),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].total).toBe(3);
    expect(r[0].setor).toBe("SISTEMAS");
    expect(r[0].media).toBeCloseTo(4.833, 3);
    expect(r[0].itens).toHaveLength(3);
  });

  it("ignora linha sem nome e não quebra com nota que não é número", () => {
    const r = rankingMural([l("", 5), l("Eva", "ótima"), l("Eva", 5)]);
    expect(r).toEqual([expect.objectContaining({ posicao: 1, colaborador: "Eva", total: 2, media: 5 })]);
  });
});

describe("itensDaPrevia (Ver prévia do Mural do Início)", () => {
  const l = (id: string, colaborador: string, status: "pendente" | "liberado" | "recusado", enviado_em = "2026-10-01") =>
    ({ id, colaborador, setor: null, nota: 5, escala: 5, comentario: "Ótima", enviado_em, status });
  const ch = (x: { id: string }) => x.id;
  const todos = [
    l("a1", "ANA", "liberado"), l("b1", "BRUNO", "pendente", "2026-10-03"), l("b2", "BRUNO", "pendente", "2026-10-02"),
    l("c1", "CARLA", "recusado"), l("a2", "ANA", "pendente"),
  ];

  it("junta o que já está no mural com o que vai ser liberado, sem recusado nem repetido", () => {
    const pend = todos.filter((x) => x.status === "pendente");
    const r = itensDaPrevia(todos, [...pend, todos[0]], ch);
    // ANA e BRUNO empatam em 2 recados e na nota: o ranking desempata pelo nome.
    expect(r.map((x) => x.id)).toEqual(["a1", "a2", "b2", "b1"]);
  });

  it("sem nada a liberar, mostra só o que já está no mural", () => {
    expect(itensDaPrevia(todos, [], ch).map((x) => x.id)).toEqual(["a1"]);
  });

  it("recusado na lista a liberar não entra", () => {
    expect(itensDaPrevia(todos, [todos[3]], ch).map((x) => x.id)).toEqual(["a1"]);
  });
});
