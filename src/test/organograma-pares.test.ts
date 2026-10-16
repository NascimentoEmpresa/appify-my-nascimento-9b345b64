import { describe, expect, it } from "vitest";
import { chefeDoNo, lerValorChefe, mesmoChefe, montarArvore, podeSerPar, valorChefe, type NoBase } from "@/lib/organograma/arvore";

// Cenário do print do Pablo (16/10/2026): Guiomar, Antonio e Helena no topo;
// Iury e Yuri reportam à Helena; Eduardo e Thamires são da equipe do Iury.
const no = (id: string, parent_id: string | null, extra: Partial<NoBase> = {}): NoBase => ({
  id, parent_id, ordem: 0, nome: id, setor: null, par_grupo: null, do_grupo: false, ...extra,
});

const base = () => [
  no("guiomar", null, { ordem: 0 }),
  no("antonio", null, { ordem: 1 }),
  no("helena", null, { ordem: 2 }),
  no("iury", "helena", { ordem: 0 }),
  no("yuri", "helena", { ordem: 1 }),
  no("eduardo", "iury", { setor: "Sistemas" }),
  no("thamires", "iury", { setor: "Sistemas" }),
];

const comGrupo = () => base().map((n) =>
  ["guiomar", "antonio", "helena"].includes(n.id) ? { ...n, par_grupo: "Direção" }
    : ["iury", "yuri"].includes(n.id) ? { ...n, do_grupo: true } : n);

describe("organograma: árvore sem grupos (como era)", () => {
  it("cada pessoa do topo é um card e a equipe desce de quem ela reporta", () => {
    const arv = montarArvore(base());
    expect(arv.raiz.map((i) => (i.tipo === "no" ? i.no.id : i.tipo))).toEqual(["guiomar", "antonio", "helena"]);
    expect(arv.equipeDe("helena").map((n) => n.id)).toEqual(["iury", "yuri"]);
    // Iury tem equipe (vira card); Yuri não (vai para o painel do setor).
    const itens = arv.itens(arv.equipeDe("helena"));
    expect(itens.map((i) => i.tipo)).toEqual(["no", "painel"]);
    // Equipe do Iury sem equipe própria = um painel por setor.
    const painel = arv.itens(arv.equipeDe("iury"));
    expect(painel).toHaveLength(1);
    expect(painel[0].tipo === "painel" && painel[0].membros.map((m) => m.id)).toEqual(["eduardo", "thamires"]);
  });
});

describe("organograma: pares no mesmo nível", () => {
  it("três pessoas do topo com o mesmo nome de grupo viram um grupo só, na ordem", () => {
    const arv = montarArvore(comGrupo());
    expect(arv.raiz).toHaveLength(1);
    const it0 = arv.raiz[0];
    expect(it0.tipo).toBe("grupo");
    if (it0.tipo !== "grupo") return;
    expect(it0.grupo.nome).toBe("Direção");
    expect(it0.grupo.membros.map((m) => m.id)).toEqual(["guiomar", "antonio", "helena"]);
  });

  it("quem responde ao grupo desce do grupo, não do card da Helena", () => {
    const arv = montarArvore(comGrupo());
    const g = arv.grupoDe("helena")!;
    expect(arv.equipeDe("helena")).toEqual([]);
    expect(arv.equipeDoGrupo(g).map((n) => n.id)).toEqual(["iury", "yuri"]);
    // A equipe do Iury continua dele.
    expect(arv.equipeDe("iury").map((n) => n.id)).toEqual(["eduardo", "thamires"]);
  });

  it("subordinado de um par só (sem do_grupo) continua debaixo daquele par", () => {
    const nos = comGrupo().map((n) => (n.id === "yuri" ? { ...n, parent_id: "antonio", do_grupo: false } : n));
    const arv = montarArvore(nos);
    expect(arv.equipeDe("antonio").map((n) => n.id)).toEqual(["yuri"]);
    expect(arv.equipeDoGrupo(arv.grupoDe("antonio")!).map((n) => n.id)).toEqual(["iury"]);
  });

  it("responder ao grupo vale por qualquer par: equipe de pares diferentes se junta", () => {
    const nos = comGrupo().map((n) => (n.id === "yuri" ? { ...n, parent_id: "guiomar" } : n));
    const arv = montarArvore(nos);
    expect(arv.equipeDoGrupo(arv.grupoDe("guiomar")!).map((n) => n.id)).toEqual(["iury", "yuri"]);
  });

  it("nome do grupo não diferencia maiúscula nem espaço", () => {
    const nos = comGrupo().map((n) => (n.id === "antonio" ? { ...n, par_grupo: "  direção " } : n));
    expect(montarArvore(nos).raiz).toHaveLength(1);
  });

  it("grupo com um par só não é grupo: card comum, e do_grupo vira subordinado comum", () => {
    const nos = base().map((n) =>
      n.id === "helena" ? { ...n, par_grupo: "Direção" } : ["iury", "yuri"].includes(n.id) ? { ...n, do_grupo: true } : n);
    const arv = montarArvore(nos);
    expect(arv.grupoDe("helena")).toBeUndefined();
    expect(arv.raiz.map((i) => i.tipo)).toEqual(["no", "no", "no"]);
    expect(arv.equipeDe("helena").map((n) => n.id)).toEqual(["iury", "yuri"]);
  });

  it("mesmo nome sob chefes diferentes são grupos diferentes", () => {
    const nos = [
      no("a", null), no("b", null),
      no("a1", "a", { par_grupo: "Gerência" }), no("a2", "a", { par_grupo: "Gerência" }),
      no("b1", "b", { par_grupo: "Gerência" }), no("b2", "b", { par_grupo: "Gerência" }),
    ];
    const arv = montarArvore(nos);
    expect(arv.grupoDe("a1")!.chave).not.toBe(arv.grupoDe("b1")!.chave);
    expect(arv.grupoDe("a1")!.membros.map((m) => m.id)).toEqual(["a1", "a2"]);
  });

  it("grupo fica na posição do primeiro par entre os irmãos; pares sem equipe não vão para painel", () => {
    const nos = [
      no("chefe", null),
      no("x", "chefe", { ordem: 0, setor: "RH" }),
      no("p1", "chefe", { ordem: 1, par_grupo: "Gerentes", setor: "RH" }),
      no("y", "chefe", { ordem: 2, setor: "RH" }),
      no("p2", "chefe", { ordem: 3, par_grupo: "Gerentes", setor: "RH" }),
    ];
    const arv = montarArvore(nos);
    const itens = arv.itens(arv.equipeDe("chefe"));
    expect(itens.map((i) => i.tipo)).toEqual(["painel", "grupo"]);
    expect(itens[0].tipo === "painel" && itens[0].membros.map((m) => m.id)).toEqual(["x", "y"]);
  });

  it("grupo dentro da equipe do grupo (do_grupo + par_grupo)", () => {
    const nos = comGrupo().map((n) => (["iury", "yuri"].includes(n.id) ? { ...n, par_grupo: "Gerência" } : n));
    const arv = montarArvore(nos);
    const itens = arv.itens(arv.equipeDoGrupo(arv.grupoDe("helena")!));
    expect(itens).toHaveLength(1);
    expect(itens[0].tipo === "grupo" && itens[0].grupo.membros.map((m) => m.id)).toEqual(["iury", "yuri"]);
  });
});

describe("organograma: recolher, busca e irmãos com grupos", () => {
  it("para achar o Eduardo abre o Iury e o grupo (não a Helena)", () => {
    const arv = montarArvore(comGrupo());
    expect(arv.caminhoAte("eduardo")).toEqual(["iury", arv.grupoDe("helena")!.chave]);
  });

  it("recolher tudo inclui o grupo com equipe e só cards que têm equipe própria", () => {
    const arv = montarArvore(comGrupo());
    expect(arv.recolhiveis().sort()).toEqual(["iury", arv.grupoDe("helena")!.chave].sort());
  });

  it("irmãos para mover à esquerda/direita", () => {
    const arv = montarArvore(comGrupo());
    expect(arv.irmaosDe("yuri").map((n) => n.id)).toEqual(["iury", "yuri"]);
    expect(arv.irmaosDe("antonio").map((n) => n.id)).toEqual(["guiomar", "antonio", "helena"]);
  });

  it("descendentes seguem o parent_id (contagem e trava de ciclo)", () => {
    const arv = montarArvore(comGrupo());
    expect([...arv.descendentes("helena")].sort()).toEqual(["eduardo", "iury", "thamires", "yuri"]);
  });
});

describe("organograma: seletor de chefe e escolha de pares", () => {
  it("valor do seletor ida e volta", () => {
    expect(lerValorChefe(valorChefe({ parentId: "helena", doGrupo: true }))).toEqual({ parentId: "helena", doGrupo: true });
    expect(lerValorChefe(valorChefe({ parentId: "helena", doGrupo: false }))).toEqual({ parentId: "helena", doGrupo: false });
    expect(lerValorChefe(null)).toEqual({ parentId: null, doGrupo: false });
  });

  it("quem responde ao grupo mostra o grupo (1º par) mesmo pendurado em outro par", () => {
    const arv = montarArvore(comGrupo());
    const iury = arv.porId.get("iury")!;
    expect(chefeDoNo(arv, iury)).toEqual({ parentId: "guiomar", doGrupo: true });
    expect(mesmoChefe(arv, iury, { parentId: "guiomar", doGrupo: true })).toBe(true);
    expect(mesmoChefe(arv, iury, { parentId: "helena", doGrupo: false })).toBe(false);
  });

  it("par não pode fechar ciclo: nem o chefe nem quem está acima dele", () => {
    const arv = montarArvore(base());
    // Eduardo (chefe = Iury) não pode ter como par o Iury nem a Helena.
    expect(podeSerPar(arv, "eduardo", "iury", "iury")).toBe(false);
    expect(podeSerPar(arv, "eduardo", "helena", "iury")).toBe(false);
    expect(podeSerPar(arv, "eduardo", "thamires", "iury")).toBe(true);
    expect(podeSerPar(arv, "eduardo", "yuri", "iury")).toBe(true);
    // No topo, qualquer um menos a própria pessoa.
    expect(podeSerPar(arv, "helena", "antonio", null)).toBe(true);
    expect(podeSerPar(arv, "helena", "helena", null)).toBe(false);
  });
});
