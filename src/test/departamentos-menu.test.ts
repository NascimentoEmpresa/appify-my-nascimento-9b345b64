// SIS-2026-0772: menu lateral por departamento. A garantia principal é a
// primeira: o agrupamento não tira nem acrescenta tela nenhuma — só muda onde
// ela aparece. Quem vê cada uma continua sendo decidido pela rota (canSee).
import { describe, expect, it } from "vitest";
import { Circle } from "lucide-react";
import { NAV_MODULOS, NAV_MODULOS_ORIGEM } from "@/components/layout/Sidebar";
import { DEPARTAMENTOS, agruparPorDepartamento, rotasDoMenu, type ModuloMenu } from "@/lib/departamentosMenu";

const mod = (id: string, label: string, grupos: Record<string, string[]>, extra: Partial<ModuloMenu> = {}): ModuloMenu => ({
  id,
  label,
  description: `desc ${id}`,
  icon: Circle,
  basePath: `/app/${id}`,
  status: "active",
  groups: Object.entries(grupos).map(([g, rotas]) => ({
    label: g,
    defaultOpen: true,
    items: rotas.map((to) => ({ label: to, to, icon: Circle })),
  })),
  ...extra,
});

describe("menu real (Sidebar)", () => {
  it("tem exatamente as mesmas telas antes e depois do agrupamento", () => {
    expect([...rotasDoMenu(NAV_MODULOS)].sort()).toEqual([...rotasDoMenu(NAV_MODULOS_ORIGEM)].sort());
  });

  it("cada módulo de origem cai em um único departamento", () => {
    const vistos = DEPARTAMENTOS.flatMap((d) => d.modulos);
    expect(new Set(vistos).size).toBe(vistos.length);
  });

  it("todo módulo citado num departamento existe na Sidebar", () => {
    const ids = new Set(NAV_MODULOS_ORIGEM.map((m) => m.id));
    expect(DEPARTAMENTOS.flatMap((d) => d.modulos).filter((id) => !ids.has(id))).toEqual([]);
  });

  it("nenhum departamento tem dois grupos com o mesmo nome", () => {
    for (const m of NAV_MODULOS) {
      const rotulos = (m.groups ?? []).map((g) => g.label);
      expect(new Set(rotulos).size, `${m.label}: ${rotulos.join(" | ")}`).toBe(rotulos.length);
    }
  });

  it("ids do menu continuam únicos", () => {
    const ids = NAV_MODULOS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("mostra os departamentos pedidos e deixa Central de Serviços e Plano de Ações soltos", () => {
    const rotulos = NAV_MODULOS.map((m) => m.label);
    for (const d of ["Jurídico", "Suprimentos", "Recursos Humanos", "Operacional", "Licitação", "Diretoria Administrativa",
      "Financeiro", "TST / SESMT", "Treinamento", "TI", "Recrutamento e Seleção", "Presidência"]) {
      expect(rotulos).toContain(d);
    }
    expect(rotulos).toContain("Central de Serviços");
    expect(rotulos).toContain("Plano de Ações");
    // Vazia até a Helena definir o que é dela: não pode aparecer oca no menu.
    expect(rotulos).not.toContain("Diretoria Operacional");
  });
});

describe("agruparPorDepartamento", () => {
  it("departamento de um módulo só troca o nome e mantém grupos e página-hub", () => {
    const m = mod("sst", "SST", { EPIs: ["/app/sst/epi"] }, { headerLink: "/app/sst" });
    const [r] = agruparPorDepartamento([m], [{ label: "TST / SESMT", modulos: ["sst"] }]);
    expect(r.label).toBe("TST / SESMT");
    expect(r.groups).toEqual(m.groups);
    expect(r.headerLink).toBe("/app/sst");
  });

  it("convidado entra com o nome do módulo na frente; o principal mantém os seus", () => {
    const fin = mod("financeiro", "Financeiro", { Ferramentas: ["/app/financeiro/f"] });
    const fis = mod("fiscal", "Fiscal & Tributário", { "Emissão & Apuração": ["/app/fiscal/e"] });
    const mal = mod("malote", "Malote", { Malote: ["/app/malote"] });
    const [r] = agruparPorDepartamento([fin, fis, mal], [{ label: "Financeiro", modulos: ["financeiro", "fiscal", "malote"] }]);
    expect(r.id).toBe("financeiro");
    expect(r.groups!.map((g) => g.label)).toEqual(["Ferramentas", "Fiscal · Emissão & Apuração", "Malote"]);
  });

  it("grupo convidado não força aberto nem fechado (abre pela tela atual)", () => {
    const a = mod("a", "A", { G: ["/a"] });
    const b = mod("b", "B", { G: ["/b"] });
    const [r] = agruparPorDepartamento([a, b], [{ label: "D", modulos: ["a", "b"] }]);
    expect(r.groups![0].defaultOpen).toBe(true);
    expect(r.groups![1].defaultOpen).toBeUndefined();
  });

  it("página-hub que não é item vira item quando o módulo entra num departamento", () => {
    const a = mod("a", "A", { G: ["/a/x"] });
    const hub = mod("tvs", "TV's", { Painel: ["/app/tvs/painel"] }, { headerLink: "/app/tvs" });
    const [r] = agruparPorDepartamento([a, hub], [{ label: "TI", modulos: ["a", "tvs"] }]);
    expect(r.headerLink).toBeUndefined();
    expect(rotasDoMenu([r])).toContain("/app/tvs");
  });

  it("módulo fora de qualquer departamento continua como está", () => {
    const solto = mod("central_servicos", "Central de Serviços", { S: ["/app/cs"] });
    const r = agruparPorDepartamento([solto], [{ label: "X", modulos: ["outro"] }]);
    expect(r).toEqual([solto]);
  });

  it("departamento sem módulo presente não aparece", () => {
    expect(agruparPorDepartamento([], [{ label: "Diretoria Operacional", modulos: [] }])).toEqual([]);
  });
});
