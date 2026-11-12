import { describe, expect, it } from "vitest";
import { itensDaPrevia, rankingMural } from "@/lib/formularios/muralReconhecimento";

// A trava do dia 20 (dataLiberacao/podeLiberar) saiu em 12/11/2026 junto com
// o trigger do banco (mig 20261112210000): publica quando quiser, com dupla
// confirmação na tela. Ficam o ranking e a prévia.

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
  type Linha = ReturnType<typeof l>;
  const ch = (x: Linha) => x.id;
  const todos = [
    l("a1", "ANA", "liberado"), l("b1", "BRUNO", "pendente", "2026-10-03"), l("b2", "BRUNO", "pendente", "2026-10-02"),
    l("c1", "CARLA", "recusado"), l("a2", "ANA", "pendente"),
  ];

  it("junta o que já está no mural com o que vai ser liberado, sem recusado nem repetido", () => {
    const pend = todos.filter((x) => x.status === "pendente");
    const r = itensDaPrevia<Linha>(todos, [...pend, todos[0]], ch);
    // ANA e BRUNO empatam em 2 recados e na nota: o ranking desempata pelo nome.
    expect(r.map((x) => x.id)).toEqual(["a1", "a2", "b2", "b1"]);
  });

  it("sem nada a liberar, mostra só o que já está no mural", () => {
    expect(itensDaPrevia<Linha>(todos, [], ch).map((x) => x.id)).toEqual(["a1"]);
  });

  it("recusado na lista a liberar não entra", () => {
    expect(itensDaPrevia<Linha>(todos, [todos[3]], ch).map((x) => x.id)).toEqual(["a1"]);
  });
});
