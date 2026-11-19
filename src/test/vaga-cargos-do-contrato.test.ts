import { describe, it, expect } from "vitest";
import { nomeCargoDoPosto, opcoesDeCargo, valorCargoSelecionado } from "@/lib/recrutamento/cargosDoContrato";

const CONTRATO = "1074 - UFFS REALEZA - 041/2021";

describe("nomeCargoDoPosto", () => {
  it("tira o sufixo que repete o contrato", () => {
    expect(nomeCargoDoPosto("LAV. DE ROUPAS A MÁQUINA - REALEZA", CONTRATO)).toBe("LAV. DE ROUPAS A MÁQUINA");
    expect(nomeCargoDoPosto("TRADUTOR/INTERPRETE DE LIBRAS - REALEZA", CONTRATO)).toBe("TRADUTOR/INTERPRETE DE LIBRAS");
  });
  it("mantém sufixo que não é do contrato", () => {
    expect(nomeCargoDoPosto("PORTARIA - BLOCO A", CONTRATO)).toBe("PORTARIA - BLOCO A");
    expect(nomeCargoDoPosto("RECEPCIONISTA", CONTRATO)).toBe("RECEPCIONISTA");
  });
});

describe("opcoesDeCargo", () => {
  const funcoes = [
    { id: "f1", posto_id: "p1", nome: "JARDINEIRO", posto_nome: "JARDINEIRO - REALEZA" },
    { id: "f2", posto_id: "p2", nome: "MOTORISTA", posto_nome: "MOTORISTA - REALEZA" },
  ];
  const postos = [
    { id: "p1", nome: "JARDINEIRO - REALEZA" },
    { id: "p2", nome: "MOTORISTA - REALEZA" },
    { id: "p3", nome: "LAV. DE ROUPAS A MÁQUINA - REALEZA" },
    { id: "p4", nome: "RECEPCIONISTA - REALEZA" },
  ];

  it("posto sem função entra como cargo, e posto com função não duplica", () => {
    const ops = opcoesDeCargo(funcoes, postos, CONTRATO);
    expect(ops.map(o => o.rotulo)).toEqual(["JARDINEIRO", "LAV. DE ROUPAS A MÁQUINA", "MOTORISTA", "RECEPCIONISTA"]);
    const lav = ops.find(o => o.cargo === "LAV. DE ROUPAS A MÁQUINA")!;
    expect(lav).toMatchObject({ valor: "p:p3", posto_id: "p3", funcao_id: "" });
    expect(ops.find(o => o.cargo === "JARDINEIRO")).toMatchObject({ valor: "f1", posto_id: "p1", funcao_id: "f1" });
  });

  it("sem posto da planilha, fica só com as funções (como antes)", () => {
    expect(opcoesDeCargo(funcoes, [], CONTRATO).map(o => o.valor)).toEqual(["f1", "f2"]);
  });

  it("função repetida em dois postos leva o posto no rótulo", () => {
    const ops = opcoesDeCargo(
      [{ id: "a", posto_id: "x", nome: "ASG", posto_nome: "BLOCO A" }, { id: "b", posto_id: "y", nome: "ASG", posto_nome: "BLOCO B" }],
      [], CONTRATO);
    expect(ops.map(o => o.rotulo)).toEqual(["ASG — BLOCO A", "ASG — BLOCO B"]);
  });

  it("posto sem função com o mesmo nome de uma função leva o posto no rótulo", () => {
    const ops = opcoesDeCargo(funcoes, [{ id: "p9", nome: "MOTORISTA - SEDE" }, ...postos], "MOTORISTA - SEDE");
    expect(ops.find(o => o.valor === "p:p9")!.rotulo).toBe("MOTORISTA — MOTORISTA - SEDE");
  });
});

describe("valorCargoSelecionado", () => {
  const ops = opcoesDeCargo([], [{ id: "p3", nome: "LAV. DE ROUPAS A MÁQUINA - REALEZA" }], CONTRATO);
  it("função → id; posto sem função → p:id; cargo solto → q:nome", () => {
    expect(valorCargoSelecionado({ cargo: "X", posto_id: "p1", funcao_id: "f1" }, ops)).toBe("f1");
    expect(valorCargoSelecionado({ cargo: "LAV. DE ROUPAS A MÁQUINA", posto_id: "p3", funcao_id: "" }, ops)).toBe("p:p3");
    expect(valorCargoSelecionado({ cargo: "AUXILIAR", posto_id: "", funcao_id: "" }, ops)).toBe("q:AUXILIAR");
    expect(valorCargoSelecionado({ cargo: "", posto_id: "", funcao_id: "" }, ops)).toBe("");
  });
});
