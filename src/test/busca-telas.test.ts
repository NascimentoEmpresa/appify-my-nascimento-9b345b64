import { describe, expect, it } from "vitest";
import { NAV_MODULOS } from "@/components/layout/Sidebar";
import { buscarTelas, casarPalavra, distancia, normalizar, sonora, trechosDestacados, type TelaBusca } from "@/lib/busca/buscaTelas";

// O menu de verdade: nome novo no menu ou sinônimo quebrado aparecem aqui.
const TELAS: TelaBusca[] = NAV_MODULOS.flatMap((m) =>
  (m.groups ?? []).flatMap((g) => g.items.map((i) => ({ to: i.to, label: i.label, modulo: m.label, grupo: g.label }))));
const nomes = (q: string, limite = 12) => buscarTelas(q, TELAS, [], limite).map((r) => r.label);

describe("os pedidos do chamado", () => {
  it("demissão traz Solicitar Demissão em primeiro", () => {
    expect(nomes("demissão")[0]).toBe("Solicitar Demissão");
    expect(nomes("demissão")).toContain("Solicitações de Demissão");
  });
  it("vaga traz Solicitar Vaga e Gestão Recrutamento", () => {
    const r = nomes("vaga");
    expect(r[0]).toBe("Solicitar Vaga");
    expect(r[1]).toBe("Gestão Recrutamento");
  });
});

describe("nome errado", () => {
  it.each([
    ["demisao", "Solicitar Demissão"],
    ["demição", "Solicitar Demissão"],
    ["dimissão", "Solicitar Demissão"],
    ["demissoes", "Solicitar Demissão"],
    ["vga", "Solicitar Vaga"],
    ["vagas", "Solicitar Vaga"],
    ["recrutameto", "Gestão Recrutamento"],
    ["recrutamneto", "Gestão Recrutamento"],
    ["feiras", "Solicitar Férias"],
    ["ferias", "Solicitar Férias"],
    ["reenbolso", "Solicitar Reembolso"],
    ["advertensia", "Advertências"],
    ["organogrma", "Organograma"],
    ["bonificasao", "Bonificação Coletiva"],
  ])("%s encontra %s", (q, esperado) => {
    expect(nomes(q).slice(0, 5)).toContain(esperado);
  });
});

describe("outro nome para a mesma coisa", () => {
  it.each([
    ["desligamento", "Solicitar Demissão"],
    ["rescisão", "Rescisões"],
    ["atestado", "Afastamentos e Telemedicina"],
    ["uniforme", "Solicitar Materiais"],
    ["holerite", "Ficha Financeira"],
    ["carro", "Agendamento de Veículos"],
    ["boleto", "Pagamento Malote"],
    ["funcionário", "Colaboradores"],
    ["contratação", "Gestão Recrutamento"],
    ["HE", "Hora Extra"],
  ])("%s encontra %s", (q, esperado) => {
    expect(nomes(q)).toContain(esperado);
  });
  it("marca que veio por sinônimo", () => {
    const r = buscarTelas("holerite", TELAS).find((x) => x.label === "Ficha Financeira");
    expect(r?.porSinonimo).toBeTruthy();
  });
});

describe("mais de uma palavra", () => {
  it("todas precisam casar", () => {
    const r = nomes("solicitar demissão");
    expect(r[0]).toBe("Solicitar Demissão");
    expect(r).not.toContain("Solicitar Férias");
  });
  it("aceita pela metade e frase solta", () => {
    expect(nomes("solic dem")[0]).toBe("Solicitar Demissão");
    expect(nomes("quero solicitar férias")[0]).toBe("Solicitar Férias");
  });
  it("nome exato vence", () => {
    expect(nomes("Hora Extra")[0]).toBe("Hora Extra");
    expect(nomes("Controle de CA")[0]).toBe("Controle de CA");
  });
});

describe("não inventa", () => {
  it("texto sem sentido não traz nada", () => {
    expect(nomes("xqzwk")).toEqual([]);
    expect(nomes("")).toEqual([]);
    expect(nomes("   ")).toEqual([]);
  });
  it("palavra parecida de outro assunto não entra", () => {
    const r = nomes("demisao");
    expect(r).not.toContain("Emissão de NF");
    expect(r).not.toContain("Novas Admissões");
    // "Decisão" é o nome do grupo delas, e é parecido com "demisao".
    expect(r).not.toContain("Diretor Administrativo");
  });
  it("palavra curta não vira qualquer coisa", () => {
    expect(casarPalavra("ab", "ad")).toBe(0);
    expect(casarPalavra("ata", "nota")).toBe(0);
  });
  it("assunto não despeja o módulo inteiro no topo", () => {
    expect(nomes("férias").slice(0, 2)).toEqual(expect.arrayContaining(["Solicitar Férias", "Gestão de Férias"]));
  });
});

describe("ordem e acesso", () => {
  const LISTA: TelaBusca[] = [
    { to: "/a", label: "Gestão Recrutamento", modulo: "RH" },
    { to: "/b", label: "Gestão Recrutamento", modulo: "Operacional" },
    { to: "/c", label: "Solicitar Vaga", modulo: "Encarregados" },
    { to: "/d", label: "Dashboard de Recrutamento", modulo: "RH" },
  ];
  it("só devolve o que recebeu: tela sem acesso nem entra na lista", () => {
    expect(buscarTelas("vaga", LISTA.filter((t) => t.to !== "/c")).map((r) => r.to)).not.toContain("/c");
  });
  it("repetido vai para o fim, sem sumir", () => {
    const r = buscarTelas("recrutamento", LISTA).map((x) => x.to);
    expect(r.at(-1)).toBe("/b");
    expect(r).toHaveLength(4);
  });
  it("o que a pessoa já usa sobe no empate", () => {
    const dois: TelaBusca[] = [{ to: "/x", label: "Gestão de Férias", modulo: "RH" }, { to: "/y", label: "Gestão de Ponto", modulo: "RH" }];
    expect(buscarTelas("gestão", dois, ["/y"])[0].to).toBe("/y");
  });
});

describe("as peças", () => {
  it("escritas diferentes soam igual", () => {
    expect(sonora(normalizar("demissão"))).toBe(sonora(normalizar("demição")));
    expect(sonora(normalizar("demissões"))).toBe(sonora(normalizar("demissão")));
    expect(sonora(normalizar("contratacao"))).toBe(sonora(normalizar("contratação")));
  });
  it("letra trocada de lugar custa 1", () => expect(distancia("feiras", "ferias")).toBe(1));
  it("destaca a palavra que casou", () => {
    const t = trechosDestacados("Solicitar Demissão", "demisao");
    expect(t.find((p) => p.marcado)?.texto).toBe("Demissão");
    expect(t.find((p) => p.texto === "Solicitar")?.marcado).toBe(false);
  });
});
