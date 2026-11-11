import { describe, expect, it } from "vitest";
import { chaveRegra, postosDoContrato, resumoPostos } from "@/lib/organograma/postoEncarregado";
import type { NoPessoa } from "@/lib/organograma/pessoas";

// SIS-2026-0770 (11/11/2026): encarregado por posto no contrato. Dados fictícios.

const no = (id: string, nome: string, posto: string | null, parent: string | null, cargo = "AUXILIAR DE LIMPEZA"): NoPessoa => ({
  id, nome, parent_id: parent, posto_codigo: posto, posto_nome: posto ? `POSTO ${posto}` : null, cargo,
  user_id: null, empregado_id: null, funcao_manual: null, email: null, avatar_url: null, ativo: true, cor: null,
  superior_origem: "posto", ordem: 0, setor: null, par_grupo: null, do_grupo: false, superior_pendente: false,
  empresa: 1, filial: 10, contrato: "10 - CONTRATO FICTICIO", contratos_extras: [],
} as unknown as NoPessoa);

const encA = no("ea", "ANA ENCARREGADA", "P1", "sup", "ENCARREGADA DE LIMPEZA");
const encB = no("eb", "BRUNO ENCARREGADO", "P2", "sup", "ENCARREGADO");
const lider = no("lt", "CARLA LIDER", "P1", "ea", "LIDER DE TURMA");
const membros = [
  encA, encB, lider,
  no("1", "DANI", "P1", "lt"),      // responde à líder, que responde à Ana → é da Ana
  no("2", "EDU", "P1", null),       // sem superior
  no("3", "FABI", "P2", "eb"),
  no("4", "GABI", "P3", "ea"),
  no("5", "HELIO", null, "ea"),     // sem posto: fora da lista
];
const c = { empresa: 1, filial: 10, membros };

describe("encarregado por posto", () => {
  const regras = new Map([[chaveRegra(1, 10, "P1"), "ea"], [chaveRegra(1, 10, "P2"), "eb"]]);
  const postos = postosDoContrato(c, regras);

  it("agrupa pelo posto de cada pessoa; quem não tem posto fica de fora", () => {
    expect(postos.map((p) => [p.codigo, p.pessoas.length])).toEqual([["P1", 4], ["P2", 2], ["P3", 1]]);
  });

  it("mostra o encarregado definido e quem ainda não responde a ele", () => {
    const p1 = postos.find((p) => p.codigo === "P1")!;
    expect(p1.encarregado?.nome).toBe("ANA ENCARREGADA");
    // Dani chega na Ana pela líder; só o Edu (sem superior) está fora.
    expect(p1.foraDoEncarregado).toBe(1);
    expect(postos.find((p) => p.codigo === "P2")!.foraDoEncarregado).toBe(0);
  });

  it("posto sem regra fica sem encarregado e conta no resumo", () => {
    const p3 = postos.find((p) => p.codigo === "P3")!;
    expect(p3.encarregado).toBeNull();
    expect(resumoPostos(postos)).toEqual({ total: 3, comEncarregado: 2, semEncarregado: 1 });
  });

  it("encarregado que saiu do contrato é sinalizado", () => {
    const fora = no("x", "IVO DE OUTRO CONTRATO", "P9", null, "ENCARREGADO");
    const r = postosDoContrato(c, new Map([[chaveRegra(1, 10, "P3"), "x"]]), [...membros, fora]);
    const p3 = r.find((p) => p.codigo === "P3")!;
    expect(p3.encarregado?.nome).toBe("IVO DE OUTRO CONTRATO");
    expect(p3.encarregadoFora).toBe(true);
  });

  it("regra de outro contrato não vale aqui", () => {
    const r = postosDoContrato(c, new Map([[chaveRegra(2, 10, "P1"), "ea"]]));
    expect(r.find((p) => p.codigo === "P1")!.encarregado).toBeNull();
  });
});
