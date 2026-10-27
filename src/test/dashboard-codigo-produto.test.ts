import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261027000010_sup_dashboard_codigo_produto.sql",
  "utf8",
);
const dashboardOriginal = readFileSync(
  "supabase/migrations/20261007000001_sup_dashboard_compras_estoque.sql",
  "utf8",
).replace(/\r\n/g, "\n");

describe("código do produto no Dashboard de Suprimentos", () => {
  it("preserva o código do item canônico até as linhas devolvidas pela RPC", () => {
    expect(migration).toContain("i.codigo AS codigo");
    expect(migration).toContain("e.item, e.codigo, e.categoria");
    expect(migration).toContain("SELECT item, codigo, categoria, quantidade, valor_total");
  });

  it("interrompe a migration se a RPC instalada não tiver a estrutura esperada", () => {
    expect(migration).toContain("Não foi possível localizar");
    expect(migration).toContain("EXECUTE v_definicao");
  });

  it("altera somente trechos que pertencem à definição atual da RPC", () => {
    expect(dashboardOriginal).toContain("i.nome AS item,\n             i.tipo AS categoria,");
    expect(dashboardOriginal).toContain("GROUP BY ei.id, ei.sup_item_id, i.nome, i.tipo,");
    expect(dashboardOriginal).toContain("SELECT e.item_estoque_id, e.item, e.categoria,");
    expect(dashboardOriginal).toContain("SELECT item, categoria, quantidade, valor_total");
    expect(dashboardOriginal).toContain("SELECT e.item, e.categoria, e.disponivel, e.reservado,");
  });
});
