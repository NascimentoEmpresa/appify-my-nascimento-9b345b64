import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261028000001_sis_2026_0740_salvar_respostas_implantacao.sql",
  "utf8",
);

describe("RLS das respostas da Implantação", () => {
  it("permite o INSERT inicial do upsert a quem pode alterar o checklist", () => {
    expect(migration).toMatch(/CREATE POLICY checklist_respostas_insert/);
    expect(migration).toMatch(/'licitacoes\.implantacao'::text, 'alterar'::app_acao/);
    expect(migration).toMatch(/'implantacao'::text, 'alterar'::app_acao/);
  });

  it("preserva o acesso de inclusão e recarrega o schema do PostgREST", () => {
    expect(migration).toMatch(/'licitacoes\.implantacao'::text, 'incluir'::app_acao/);
    expect(migration).toMatch(/'implantacao'::text, 'incluir'::app_acao/);
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
  });
});
