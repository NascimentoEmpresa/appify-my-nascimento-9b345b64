import { describe, it, expect } from "vitest";
import { menusForaDoConcedeTudo } from "@/lib/acesso";

// Mig 20261008000006 (08/10/2026): o "concede tudo" (Administrador Geral)
// não alcança tela criada depois de 08/10/2026 — ela nasce sem ninguém.

describe("telas fora do concede tudo", () => {
  it("tela nova (NÃO) fica de fora; as de antes (SIM) não", () => {
    const fora = menusForaDoConcedeTudo([
      { codigo: "organograma", concede_tudo_alcanca: true },
      { codigo: "modulo_novo", concede_tudo_alcanca: false },
    ]);
    expect([...fora]).toEqual(["modulo_novo"]);
  });

  it("código repetido em dois módulos: basta uma linha SIM para continuar alcançado", () => {
    const fora = menusForaDoConcedeTudo([
      { codigo: "aprova_vagas", concede_tudo_alcanca: false },
      { codigo: "aprova_vagas", concede_tudo_alcanca: true },
    ]);
    expect(fora.size).toBe(0);
  });

  it("banco sem a coluna (valor ausente) = comportamento antigo, nada fica de fora", () => {
    expect(menusForaDoConcedeTudo([{ codigo: "x", concede_tudo_alcanca: null }]).size).toBe(0);
    expect(menusForaDoConcedeTudo([]).size).toBe(0);
  });
});
