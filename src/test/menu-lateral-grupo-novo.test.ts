import { describe, expect, it } from "vitest";
import { Circle } from "lucide-react";
import { estruturaPadrao, montarMenu, type ModuloCatalogo } from "@/lib/menuLateral/estrutura";

// 09/11/2026 — Operacional › Indicadores: grupo criado depois da organização
// salva caía na primeira categoria do módulo em vez de aparecer como grupo.

const item = (label: string, to: string) => ({ label, to, icon: Circle });
const modulo = (groups: ModuloCatalogo["groups"]): ModuloCatalogo => ({
  id: "operacional", label: "Operacional", description: "", icon: Circle, basePath: "/app/operacional", status: "active", groups,
});

const ANTES = [
  { label: "Efetivo", items: [item("Colaboradores", "/app/op/colab")] },
  { label: "Operacional", items: [item("Diárias", "/app/op/diarias")] },
];
const salva = estruturaPadrao([modulo(ANTES)]);
const grupos = (cat: ModuloCatalogo[]) => montarMenu(cat, salva)[0].groups!.map((g) => [g.label, g.items.map((i) => i.label)]);

describe("grupo novo com organização salva", () => {
  it("aparece como grupo próprio, em ordem alfabética", () => {
    const novo = modulo([...ANTES, { label: "Indicadores", items: [item("Painel Executivo", "/app/op/painel")] }]);
    expect(grupos([novo])).toEqual([
      ["Efetivo", ["Colaboradores"]],
      ["Indicadores", ["Painel Executivo"]],
      ["Operacional", ["Diárias"]],
    ]);
  });

  it("duas telas do mesmo grupo novo ficam juntas", () => {
    const novo = modulo([...ANTES, { label: "Indicadores", items: [item("B", "/app/op/b"), item("A", "/app/op/a")] }]);
    expect(grupos([novo])[1]).toEqual(["Indicadores", ["A", "B"]]);
  });

  it("tela nova em grupo que já existe continua nele", () => {
    const novo = modulo([ANTES[0], { label: "Operacional", items: [...ANTES[1].items, item("Escala", "/app/op/escala")] }]);
    expect(grupos([novo])[1]).toEqual(["Operacional", ["Diárias", "Escala"]]);
  });

  it("grupo renomeado no editor (com tela conhecida) cai na primeira categoria, como antes", () => {
    const novo = modulo([ANTES[0], { label: "Renomeado", items: [...ANTES[1].items, item("Escala", "/app/op/escala")] }]);
    expect(grupos([novo])[0]).toEqual(["Efetivo", ["Colaboradores", "Escala"]]);
  });
});
