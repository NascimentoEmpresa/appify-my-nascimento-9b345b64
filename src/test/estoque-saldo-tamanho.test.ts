import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261023000530_sup_estoque_saldo_tamanho_canonico.sql",
  "utf8",
);

describe("saldo de estoque por tamanho", () => {
  it("prioriza o tamanho canônico do item sobre uma etiqueta legada", () => {
    // A ficha "CAMISETA M" precisa permanecer no M mesmo que uma etiqueta
    // histórica carregue outro tamanho. É o que mantém a lista operacional e
    // as agregações do dashboard sobre a mesma grade de estoque.
    expect(migration).toContain("COALESCE(i.tamanho, t.tamanho) AS tamanho");
    expect(migration).toContain("i.tamanho, t.tamanho");
  });
});
