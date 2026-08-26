import { describe, expect, it } from "vitest";
import {
  enxovalCompleto,
  montarItensDoEnxoval,
  motivoTokenInvalido,
} from "@/lib/suprimentos/admissao";

describe("montarItensDoEnxoval", () => {
  it("preserva a ordem, cria o snapshot e ignora vínculo não aprovado", () => {
    const itens = montarItensDoEnxoval([
      {
        item_id: "bota",
        ordem: 20,
        ativo: true,
        aprovado: true,
        sup_item: { id: "bota", nome: "Botina", tipo: "epi", aprovado: true },
      },
      {
        item_id: "camisa",
        ordem: 10,
        ativo: true,
        aprovado: true,
        sup_item: { id: "camisa", nome: "Camisa", tipo: "uniforme", aprovado: true },
      },
      {
        item_id: "pendente",
        ordem: 5,
        ativo: true,
        aprovado: false,
        sup_item: { id: "pendente", nome: "Item pendente", tipo: "epi" },
      },
    ]);

    expect(itens).toEqual([
      {
        sup_item_id: "camisa",
        nome_item: "Camisa",
        tipo_item: "uniforme",
        tamanho: null,
        quantidade: 1,
        ordem: 10,
      },
      {
        sup_item_id: "bota",
        nome_item: "Botina",
        tipo_item: "epi",
        tamanho: null,
        quantidade: 1,
        ordem: 20,
      },
    ]);
  });
});

describe("enxovalCompleto", () => {
  it("só fica completo quando todo item com grade tem tamanho", () => {
    expect(enxovalCompleto([
      { tamanhos_disponiveis: ["P", "M"], tamanho: "M" },
      { tamanhos_disponiveis: ["40", "41"], tamanho: null },
    ])).toBe(false);
    expect(enxovalCompleto([
      { tamanhos_disponiveis: ["P", "M"], tamanho: "M" },
      { tamanhos_disponiveis: ["40", "41"], tamanho: "41" },
    ])).toBe(true);
  });

  it("não trava por item sem tamanho disponível no catálogo", () => {
    expect(enxovalCompleto([
      { tamanhos_disponiveis: [], tamanho: null },
      { tamanhos_disponiveis: null, tamanho: null },
    ])).toBe(true);
  });
});

describe("motivoTokenInvalido", () => {
  const agora = new Date("2026-08-26T15:00:00-03:00");

  it("respeita inexistente, usado e expirado nessa precedência", () => {
    expect(motivoTokenInvalido({ existe: false, usadoEm: "2026-08-20", expiraEm: "2026-08-20" }, agora))
      .toBe("inexistente");
    expect(motivoTokenInvalido({ existe: true, usadoEm: "2026-08-25", expiraEm: "2026-08-20" }, agora))
      .toBe("ja_usado");
    expect(motivoTokenInvalido({ existe: true, usadoEm: null, expiraEm: "2026-08-25T10:00:00-03:00" }, agora))
      .toBe("expirado");
  });

  it("considera válido o token que expira hoje", () => {
    expect(motivoTokenInvalido({
      existe: true,
      usadoEm: null,
      expiraEm: "2026-08-26T00:01:00-03:00",
    }, agora)).toBeNull();
  });
});
