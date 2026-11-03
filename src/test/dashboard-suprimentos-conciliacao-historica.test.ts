import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261029000600_sis_2026_0753_historico_e_ia_operacional.sql",
  "utf8",
);

describe("SIS-2026-0753 — conciliação histórica", () => {
  it("agrupa pedidos pela data da solicitação, não pela data de importação", () => {
    expect(migration).toContain("date_trunc(''month'', p.data_solicitacao::timestamp)");
    expect(migration).toContain("p.data_solicitacao DESC, p.created_at DESC");
    expect(migration).toContain("periodo_disponivel");
    expect(migration).toContain("itens_registrados_inicio");
    expect(migration).toContain("Âncora do limite histórico");
    expect(migration).toContain("v_definicao := replace(v_definicao, v_origem, '')");
  });

  it("expõe à IA exatamente o KPI operacional de entradas registradas", () => {
    expect(migration).toContain("'entradas_registradas'");
    expect(migration).toContain("JOIN public.sup_estoque_item estoque_item");
    expect(migration).toContain("estoque_item.arquivado_em IS NULL");
  });

  it("marca a ficha encerrada sem descartá-la do histórico de rotatividade", () => {
    expect(migration).toContain("bool_or(estoque_item.arquivado_em IS NULL) AS cadastro_ativo");
    expect(migration).toContain("'cadastro_ativo', cadastro_ativo");
  });

  it("prioriza o código próprio da variante/tamanho em vez do código do item-pai", () => {
    expect(migration).toContain("v_origem := 'COALESCE(base.codigo, item.codigo) AS codigo'");
    expect(migration).toContain("v_destino := 'COALESCE(item.codigo, base.codigo) AS codigo'");
    expect(migration).toContain("Âncora do código específico por tamanho");
  });
});
