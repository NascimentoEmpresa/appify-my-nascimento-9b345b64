// 03/11/2026 (item 12): "Saídas por Contrato" existia no app_menu e no
// Gerenciamento de Acesso, mas não na sidebar — a lista da sidebar é
// src/components/layout/Sidebar.tsx, e canSee() só FILTRA o que já está lá.
// E ela tem que morar em Suprimentos, não em "relatórios".
import { describe, expect, it } from "vitest";
import { NAV_MODULOS } from "@/components/layout/Sidebar";
import { rotaMovida } from "@/lib/acesso";

const NOVA = "/app/suprimentos/saidas-por-contrato";

describe("Saídas por Contrato na sidebar", () => {
  it("aparece dentro do módulo Suprimentos, no endereço novo", () => {
    const sup = NAV_MODULOS.find((m) => m.id === "suprimentos");
    const itens = (sup?.groups ?? []).flatMap((g) => g.items);
    expect(itens.some((i) => i.to === NOVA && i.label === "Saídas por Contrato")).toBe(true);
  });

  it("não aparece em nenhum outro módulo", () => {
    const outros = NAV_MODULOS.filter((m) => m.id !== "suprimentos")
      .flatMap((m) => m.groups.flatMap((g) => g.items))
      .filter((i) => i.to.includes("saidas-por-contrato"));
    expect(outros).toEqual([]);
  });

  it("o endereço antigo (com /relatorios/) é redirecionado para o novo", () => {
    expect(rotaMovida("/app/suprimentos/relatorios/saidas-por-contrato")).toBe(NOVA);
  });
});
