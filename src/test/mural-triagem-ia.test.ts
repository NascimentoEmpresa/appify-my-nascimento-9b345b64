import { describe, expect, it } from "vitest";
import {
  bloqueadoPelaIA, separarPelaTriagem, semTriagem, sinalizadoPelaIA, type TriagemItem,
} from "@/lib/formularios/muralTriagem";
import {
  emLotes, lerResultadoTriagem, montarPromptTriagem, LIMITE_MOTIVO,
} from "../../supabase/functions/_shared/mural-triagem-ia.ts";

const naoRec: TriagemItem = { recomendado: false, motivo: "Compara com o líder", habilitado: false };
const rec: TriagemItem = { recomendado: true, motivo: null, habilitado: false };
const reab: TriagemItem = { ...naoRec, habilitado: true };

describe("bloqueadoPelaIA", () => {
  it("não recomendado e pendente fica fora da liberação", () => {
    expect(bloqueadoPelaIA({ status: "pendente" }, naoRec)).toBe(true);
  });
  it("habilitado à mão volta ao envio, mas segue sinalizado", () => {
    expect(bloqueadoPelaIA({ status: "pendente" }, reab)).toBe(false);
    expect(sinalizadoPelaIA({ status: "pendente" }, reab)).toBe(true);
  });
  it("recomendado ou sem triagem (IA falhou) segue como antes", () => {
    expect(bloqueadoPelaIA({ status: "pendente" }, rec)).toBe(false);
    expect(bloqueadoPelaIA({ status: "pendente" }, undefined)).toBe(false);
    expect(bloqueadoPelaIA({ status: "pendente" }, { recomendado: null, motivo: null, habilitado: false })).toBe(false);
  });
  it("liberado ou recusado não muda por causa da IA", () => {
    expect(bloqueadoPelaIA({ status: "liberado" }, naoRec)).toBe(false);
    expect(bloqueadoPelaIA({ status: "recusado" }, naoRec)).toBe(false);
  });
});

describe("separarPelaTriagem", () => {
  const itens = [
    { id: "a", status: "pendente" },
    { id: "b", status: "pendente" },
    { id: "c", status: "pendente" },
    { id: "d", status: "pendente" },
  ];
  const mapa = new Map<string, TriagemItem>([["a", rec], ["b", naoRec], ["c", reab]]);
  it("conta para liberar só os habilitados, mantendo a ordem", () => {
    const { liberaveis, bloqueados } = separarPelaTriagem(itens, mapa, (i) => i.id);
    expect(liberaveis.map((i) => i.id)).toEqual(["a", "c", "d"]);
    expect(bloqueados.map((i) => i.id)).toEqual(["b"]);
  });
  it("aponta os pendentes que a IA não leu", () => {
    expect(semTriagem(itens, mapa, (i) => i.id).map((i) => i.id)).toEqual(["d"]);
  });
  it("sem triagem nenhuma, tudo é liberável (falha da IA não trava)", () => {
    expect(separarPelaTriagem(itens, new Map(), (i) => i.id).bloqueados).toEqual([]);
  });
});

describe("lerResultadoTriagem (Edge mural-triagem-ia)", () => {
  it("lê o JSON, tolera cerca de markdown e ordena pelo id", () => {
    const bruto = "```json\n{\"itens\":[{\"id\":1,\"publicar\":false,\"motivo\":\"Diz que deveria ser o líder do setor\"},{\"id\":0,\"publicar\":true}]}\n```";
    expect(lerResultadoTriagem(bruto, 2)).toEqual([
      { indice: 0, recomendado: true, motivo: null },
      { indice: 1, recomendado: false, motivo: "Diz que deveria ser o líder do setor" },
    ]);
  });
  it("descarta id fora do lote, repetido ou sem decisão", () => {
    const bruto = JSON.stringify({ itens: [
      { id: 0, publicar: true }, { id: 0, publicar: false }, { id: 5, publicar: false },
      { id: 1 }, { id: "2", publicar: "false" },
    ] });
    const r = lerResultadoTriagem(bruto, 3);
    expect(r.map((x) => [x.indice, x.recomendado])).toEqual([[0, true], [2, false]]);
  });
  it("não recomendado sem motivo ganha motivo genérico; motivo longo é cortado", () => {
    const r = lerResultadoTriagem(JSON.stringify({ itens: [{ id: 0, publicar: false }, { id: 1, publicar: false, motivo: "x".repeat(500) }] }), 2);
    expect(r[0].motivo).toMatch(/mural/);
    expect(r[1].motivo!.length).toBe(LIMITE_MOTIVO);
  });
  it("resposta que não é JSON vira lista vazia (nada é gravado)", () => {
    expect(lerResultadoTriagem("desculpe, não consigo", 3)).toEqual([]);
  });
});

describe("montarPromptTriagem / emLotes", () => {
  it("numera pelo índice do lote e não leva quem votou", () => {
    const p = montarPromptTriagem([{ colaborador: "ANA", setor: "RH", comentario: "Mais competente que o líder" }]);
    expect(p).toContain('"id":0');
    expect(p).toContain("Mais competente que o líder");
  });
  it("fatia em lotes", () => {
    expect(emLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
