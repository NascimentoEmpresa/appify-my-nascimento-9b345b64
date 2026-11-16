import { describe, expect, it } from "vitest";
import {
  bloqueadoPelaIA, separarPelaTriagem, semTriagem, sinalizadoPelaIA, type TriagemItem,
} from "@/lib/formularios/muralTriagem";
import {
  emLotes, lerResultadoTriagem, modeloComVersao, montarPromptTriagem, motivoComTrecho, precisaTriagem,
  LIMITE_MOTIVO, SYSTEM_PROMPT_TRIAGEM, TAMANHO_LOTE, VERSAO_TRIAGEM,
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

describe("régua v2 (12/11/2026: a v1 deixava passar crítica escondida no elogio)", () => {
  it("lote pequeno e desempate para NÃO publicar", () => {
    expect(TAMANHO_LOTE).toBeLessThanOrEqual(20);
    expect(SYSTEM_PROMPT_TRIAGEM).toMatch(/Na dúvida entre os dois, NÃO recomende/);
    expect(SYSTEM_PROMPT_TRIAGEM).not.toMatch(/Na dúvida, recomende/);
  });
  it("a régua cobre o que a revisão humana tirou e o que ela liberou", () => {
    // Tirados em set/out: crítica a antecessor, problema interno, ressalva, gênero, texto quebrado.
    for (const t of ["antecessor", "minha líder", "às vezes fica bem bravo", "homem ou mulher", "ilegível"]) {
      expect(SYSTEM_PROMPT_TRIAGEM).toContain(t);
    }
    // Liberados pela revisão: religião leve, carinho, "melhor líder".
    for (const t of ["que Deus te abençoe", "segunda mãe", "melhor líder"]) {
      expect(SYSTEM_PROMPT_TRIAGEM).toContain(t);
    }
  });
  it("lê o trecho e mostra junto do motivo", () => {
    const bruto = JSON.stringify({ itens: [{ id: 0, publicar: false, motivo: "Critica quem ocupava o cargo antes", trecho: "“superior ao seu antecessor”" }] });
    expect(lerResultadoTriagem(bruto, 1)[0].motivo).toBe("Critica quem ocupava o cargo antes — “superior ao seu antecessor”");
  });
  it("motivo com trecho nunca passa do limite e o motivo nunca some", () => {
    const m = motivoComTrecho("x".repeat(100), "y".repeat(300));
    expect(m.length).toBeLessThanOrEqual(LIMITE_MOTIVO);
    expect(m.startsWith("x".repeat(100))).toBe(true);
    expect(motivoComTrecho("x".repeat(158), "trecho")).toBe("x".repeat(158));
    expect(motivoComTrecho("", "")).toMatch(/mural/);
  });
  it("modelo gravado leva a versão", () => {
    expect(modeloComVersao("gemini:gemini-3.6-flash")).toBe(`${VERSAO_TRIAGEM}|gemini:gemini-3.6-flash`);
    expect(modeloComVersao("z".repeat(200)).length).toBe(80);
  });
});

describe("precisaTriagem — quem a régua nova relê", () => {
  const v1 = "gemini:gemini-3.6-flash";
  const atual = modeloComVersao(v1);
  it("pendente nunca lido: lê", () => {
    expect(precisaTriagem({ status: "pendente", triado: false, recomendado: null, modelo: null })).toBe(true);
  });
  it("recomendado pela régua antiga: relê (pode ganhar sinalização)", () => {
    expect(precisaTriagem({ status: "pendente", triado: true, recomendado: true, habilitado: false, modelo: v1 })).toBe(true);
    expect(precisaTriagem({ status: "pendente", triado: true, recomendado: true, habilitado: false, modelo: null })).toBe(true);
  });
  it("já lido pela régua atual: não gasta token de novo", () => {
    expect(precisaTriagem({ status: "pendente", triado: true, recomendado: true, habilitado: false, modelo: atual })).toBe(false);
  });
  it("desabilitado ou habilitado à mão: a releitura não desfaz decisão", () => {
    expect(precisaTriagem({ status: "pendente", triado: true, recomendado: false, habilitado: false, modelo: v1 })).toBe(false);
    expect(precisaTriagem({ status: "pendente", triado: true, recomendado: false, habilitado: true, modelo: v1 })).toBe(false);
  });
  it("no mural ou recusado: não lê", () => {
    expect(precisaTriagem({ status: "liberado", triado: false, recomendado: null })).toBe(false);
    expect(precisaTriagem({ status: "recusado", triado: true, recomendado: true, modelo: v1 })).toBe(false);
  });
  it("banco sem a migration (modelo ausente): não relê, só lê os nunca lidos", () => {
    expect(precisaTriagem({ status: "pendente", triado: true, recomendado: true, habilitado: false })).toBe(false);
    expect(precisaTriagem({ status: "pendente", triado: false, recomendado: null })).toBe(true);
  });
});
