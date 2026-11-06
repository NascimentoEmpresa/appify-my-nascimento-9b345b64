// SIS-2026-0772 (fase 2): menu lateral organizável. A garantia central é que
// organizar o menu só muda ONDE a tela aparece — nunca cria endereço novo nem
// some com tela. Quem vê cada uma continua sendo decidido pela rota (canSee).
import { describe, expect, it } from "vitest";
import { Bell, Circle } from "lucide-react";
import { NAV_MODULOS_ORIGEM } from "@/components/layout/Sidebar";
import {
  copiarItem, criarAtalho, criarCategoria, criarModulo, estruturaPadrao, montarMenu, moverItem, moverModulo,
  remover, renomear, restaurarOriginal, rotasDaEstrutura, situacaoDoItem, validarEstrutura,
  type EstruturaMenu, type ModuloCatalogo,
} from "@/lib/menuLateral/estrutura";

type Item = { label: string; to: string; icon: typeof Circle; notif?: string };
const mod = (id: string, label: string, grupos: Record<string, [string, string][]>, extra: Partial<ModuloCatalogo<Item>> = {}): ModuloCatalogo<Item> => ({
  id, label, description: `desc ${id}`, icon: Circle, basePath: `/app/${id}`, status: "active",
  groups: Object.entries(grupos).map(([g, itens]) => ({ label: g, items: itens.map(([l, to]) => ({ label: l, to, icon: Circle })) })),
  ...extra,
});

const CAT = [
  mod("central_servicos", "Central de Serviços", { "Central de Serviços": [["Quadro de Avisos", "/app/cs/avisos"], ["Agenda de Reunião", "/app/cs/reunioes"]] }),
  mod("encarregados", "Encarregados", { Acompanhamento: [["Minha equipe", "/app/enc/equipe"]] }),
];
const rotas = (ms: { groups?: { items: { to: string }[] }[] }[]) =>
  ms.flatMap((m) => (m.groups ?? []).flatMap((g) => g.items.map((i) => i.to))).sort();
const achar = (e: EstruturaMenu, rota: string) => {
  for (const m of e.modulos) for (const c of m.categorias) for (const i of c.itens) if (i.rota === rota) return { m, c, i };
  throw new Error(rota);
};
const catDe = (e: EstruturaMenu, modOrigem: string) => e.modulos.find((m) => m.origem === modOrigem)!.categorias[0];

describe("catálogo real da Sidebar", () => {
  const padrao = estruturaPadrao(NAV_MODULOS_ORIGEM);

  it("o padrão tem todas as telas do catálogo e nenhuma a mais", () => {
    const doCatalogo = new Set(rotas(NAV_MODULOS_ORIGEM));
    for (const m of NAV_MODULOS_ORIGEM) if (m.headerLink && m.headerLink !== "/app") doCatalogo.add(m.headerLink);
    expect(new Set(rotasDaEstrutura(padrao))).toEqual(doCatalogo);
  });

  it("o padrão está em ordem alfabética e é válido", () => {
    const nomes = padrao.modulos.map((m) => m.rotulo);
    expect(nomes).toEqual([...nomes].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" })));
    expect(validarEstrutura(padrao)).toEqual([]);
  });

  it("montar sem organização salva dá o padrão, com as mesmas telas do catálogo", () => {
    const menu = montarMenu(NAV_MODULOS_ORIGEM, null);
    expect(new Set(rotas(menu))).toEqual(new Set(rotasDaEstrutura(padrao)));
    expect(menu.map((m) => m.label)).toEqual(padrao.modulos.map((m) => m.rotulo));
  });

  it("ids de módulo continuam os do catálogo (o Início usa para a cor)", () => {
    const ids = new Set(NAV_MODULOS_ORIGEM.map((m) => m.id));
    for (const m of montarMenu(NAV_MODULOS_ORIGEM, null)) expect(ids.has(m.id)).toBe(true);
  });
});

describe("operações do editor", () => {
  const p = estruturaPadrao(CAT);

  it("mover tira da origem e põe no destino, com o mesmo endereço", () => {
    const de = achar(p, "/app/cs/reunioes");
    const e = moverItem(p, de.i.id, catDe(p, "encarregados").id);
    expect(achar(e, "/app/cs/reunioes").m.origem).toBe("encarregados");
    expect(rotasDaEstrutura(e).sort()).toEqual(rotasDaEstrutura(p).sort());
    expect(situacaoDoItem(achar(e, "/app/cs/reunioes").i, achar(e, "/app/cs/reunioes").m, achar(e, "/app/cs/reunioes").c, p)).toBe("movido");
    const menu = montarMenu(CAT, e);
    expect(menu.find((m) => m.id === "central_servicos")!.groups!.flatMap((g) => g.items.map((i) => i.to))).not.toContain("/app/cs/reunioes");
    expect(menu.find((m) => m.id === "encarregados")!.groups!.flatMap((g) => g.items.map((i) => i.to))).toContain("/app/cs/reunioes");
  });

  it("copiar deixa nos dois lugares, apontando para a mesma tela", () => {
    const de = achar(p, "/app/cs/reunioes");
    const e = copiarItem(p, de.i.id, catDe(p, "encarregados").id, "x1");
    expect(rotasDaEstrutura(e).filter((r) => r === "/app/cs/reunioes")).toHaveLength(2);
    const copia = e.modulos.find((m) => m.origem === "encarregados")!.categorias[0].itens.find((i) => i.id === "x1")!;
    expect(copia.copiaDe).toBe(de.i.id);
    expect(montarMenu(CAT, e).find((m) => m.id === "encarregados")!.groups![0].items.some((i) => i.label === "Agenda de Reunião")).toBe(true);
    expect(validarEstrutura(e)).toEqual([]);
  });

  it("restaurar devolve a entrada movida ao lugar original", () => {
    const de = achar(p, "/app/cs/reunioes");
    const e = restaurarOriginal(moverItem(p, de.i.id, catDe(p, "encarregados").id), de.i.id, p);
    expect(achar(e, "/app/cs/reunioes").m.origem).toBe("central_servicos");
  });

  it("reordenar módulos e entradas respeita a ordem salva", () => {
    const e = moverModulo(p, "m:encarregados", 0);
    expect(montarMenu(CAT, e).map((m) => m.id)).toEqual(["encarregados", "central_servicos"]);
    const cs = catDe(p, "central_servicos");
    const e2 = moverItem(p, cs.itens[1].id, cs.id, 0);
    expect(catDe(e2, "central_servicos").itens[0].id).toBe(cs.itens[1].id);
  });

  it("módulo, categoria e atalho criados aparecem no menu; atalho só aceita endereço interno", () => {
    let e = criarModulo(p, "Diretoria Operacional", "m:x");
    e = criarCategoria(e, "m:x", "Aprovações", "c:x");
    e = criarAtalho(e, "c:x", "/app/cs/avisos", "Avisos da diretoria", "a1");
    expect(criarAtalho(e, "c:x", "https://site-externo.com", "x", "a2")).toBe(e);
    expect(criarAtalho(e, "c:x", "javascript:alert(1)", "x", "a3")).toBe(e);
    const novo = montarMenu(CAT, e).find((m) => m.label === "Diretoria Operacional")!;
    expect(novo.groups![0].items[0]).toMatchObject({ label: "Avisos da diretoria", to: "/app/cs/avisos" });
    expect(situacaoDoItem(e.modulos.at(-1)!.categorias[0].itens[0], e.modulos.at(-1)!, e.modulos.at(-1)!.categorias[0], p)).toBe("criado");
  });

  it("renomear entrada troca o nome exibido; nome vazio volta ao do catálogo", () => {
    const id = achar(p, "/app/cs/avisos").i.id;
    const e = renomear(p, id, "Mural");
    expect(montarMenu(CAT, e)[0].groups![0].items.some((i) => i.label === "Mural")).toBe(true);
    expect(montarMenu(CAT, renomear(e, id, "  "))[0].groups![0].items.some((i) => i.label === "Quadro de Avisos")).toBe(true);
  });

  it("remover entrada tira do menu; pasta com telas não é apagada", () => {
    const id = achar(p, "/app/cs/avisos").i.id;
    expect(rotasDaEstrutura(remover(p, id))).not.toContain("/app/cs/avisos");
    expect(remover(p, "m:central_servicos")).toBe(p);
  });
});

describe("telas criadas depois de uma organização salva", () => {
  it("tela nova aparece sozinha no módulo de origem, com ícone e bolinha do catálogo", () => {
    const salvo = estruturaPadrao(CAT);
    const cat2 = [
      mod("central_servicos", "Central de Serviços", { "Central de Serviços": [["Quadro de Avisos", "/app/cs/avisos"], ["Agenda de Reunião", "/app/cs/reunioes"]] }),
      { ...CAT[1], groups: [{ label: "Acompanhamento", items: [{ label: "Minha equipe", to: "/app/enc/equipe", icon: Circle }, { label: "Alertas", to: "/app/enc/alertas", icon: Bell, notif: "meus" }] }] },
    ];
    const enc = montarMenu(cat2, salvo).find((m) => m.id === "encarregados")!;
    expect(enc.groups![0].items.find((i) => i.to === "/app/enc/alertas")).toMatchObject({ icon: Bell, notif: "meus" });
  });

  it("tela tirada do menu de propósito não volta", () => {
    const p = estruturaPadrao(CAT);
    const e = remover(p, achar(p, "/app/cs/avisos").i.id);
    expect(rotas(montarMenu(CAT, e))).not.toContain("/app/cs/avisos");
  });

  it("sem o módulo de origem (removido no editor), a tela nova vai para 'Novas telas'", () => {
    const p = estruturaPadrao(CAT);
    const e = remover(remover(p, achar(p, "/app/enc/equipe").i.id), "m:encarregados");
    expect(e.modulos.some((m) => m.origem === "encarregados")).toBe(false);
    // O módulo removido ganha uma tela nova; a antiga continua conhecida.
    const cat2 = [CAT[0], { ...CAT[1], groups: [{ label: "Acompanhamento", items: [
      { label: "Minha equipe", to: "/app/enc/equipe", icon: Circle },
      { label: "Alertas", to: "/app/enc/alertas", icon: Circle },
    ] }] }];
    const novas = montarMenu(cat2, e).find((m) => m.label === "Novas telas");
    expect(novas?.groups?.[0].items.map((i) => i.to)).toEqual(["/app/enc/alertas"]);
  });

  it("módulo inteiro novo entra como módulo próprio, não em 'Novas telas'", () => {
    const salvo = estruturaPadrao(CAT);
    const cat2 = [...CAT, mod("email", "E-mail", { "E-mail": [["Meu E-mail", "/app/email"], ["Remetentes", "/app/email/remetentes"]] })];
    const menu = montarMenu(cat2, salvo);
    expect(menu.find((m) => m.label === "Novas telas")).toBeUndefined();
    const email = menu.find((m) => m.id === "email")!;
    expect(email.label).toBe("E-mail");
    expect(email.groups![0].items.map((i) => i.to)).toEqual(["/app/email", "/app/email/remetentes"]);
    // Ordem alfabética entre os módulos da organização salva.
    expect(menu.map((m) => m.label)).toEqual(["Central de Serviços", "E-mail", "Encarregados"]);
  });
});

describe("validarEstrutura (mesmas regras do banco)", () => {
  const base = (rota: string, rotulo?: string): EstruturaMenu => ({
    rotasConhecidas: [],
    modulos: [{ id: "m", rotulo: "M", origem: null, categorias: [{ id: "c", rotulo: "C", itens: [{ id: "i", rota, rotulo }] }] }],
  });
  it("recusa endereço externo, javascript: e nome vazio", () => {
    expect(validarEstrutura(base("https://x.com", "x")).length).toBeGreaterThan(0);
    expect(validarEstrutura(base("javascript:alert(1)", "x")).length).toBeGreaterThan(0);
    expect(validarEstrutura(base("/app/x", " ")).length).toBeGreaterThan(0);
    expect(validarEstrutura(base("/app/x", "ok"))).toEqual([]);
    expect(validarEstrutura(base("/app?tab=1", "ok"))).toEqual([]);
  });
  it("recusa id repetido", () => {
    const e = base("/app/x", "ok");
    e.modulos[0].categorias[0].itens.push({ id: "i", rota: "/app/y", rotulo: "y" });
    expect(validarEstrutura(e).some((m) => m.includes("repetido"))).toBe(true);
  });
});
