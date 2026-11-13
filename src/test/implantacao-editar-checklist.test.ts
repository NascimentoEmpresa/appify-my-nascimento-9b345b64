import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MENU_EDITAR_CHECKLIST, ACAO_EDITAR_CHECKLIST } from "@/lib/implantacao/permissaoChecklist";

const migration = readFileSync(
  "supabase/migrations/20261115000300_implantacao_editar_checklist_permissao.sql",
  "utf8",
);

/** Corpo de uma policy, do CREATE até o `;`. */
function policy(nome: string): string {
  const m = migration.match(new RegExp(`^CREATE POLICY ${nome} ON [^\\n]*[\\s\\S]*?;`, "m"));
  if (!m) throw new Error(`policy ${nome} não encontrada`);
  return m[0];
}

describe("Implantação — permissão Pode editar o checklist", () => {
  it("tela e banco usam o mesmo menu fantasma, no módulo Licitação", () => {
    expect(MENU_EDITAR_CHECKLIST).toBe("licitacoes-implantacao-editar-checklist");
    expect(ACAO_EDITAR_CHECKLIST).toBe("visualizar");
    expect(migration).toMatch(/'licitacoes-implantacao-editar-checklist',\s*'Licitações — Implantação: Pode editar o checklist', NULL/);
    expect(migration).toMatch(/WHERE m\.codigo = 'licitacoes'/);
  });

  it.each(["checklist_respostas_insert", "checklist_respostas_update", "implantacao_update"])(
    "%s exige só a permissão nova (ver a tela não basta)",
    (nome) => {
      const corpo = policy(nome);
      expect(corpo).toContain(`'${MENU_EDITAR_CHECKLIST}'::text, 'visualizar'::app_acao`);
      expect(corpo).not.toMatch(/'licitacoes\.implantacao'/);
      expect(corpo).not.toMatch(/'implantacao'::text/);
      expect(corpo).not.toMatch(/has_role/);
    },
  );

  it("quem edita hoje continua editando (semente) e o schema recarrega", () => {
    expect(migration).toMatch(/menu_codigo IN \('licitacoes\.implantacao', 'implantacao'\)/);
    expect(migration).toMatch(/acao IN \('alterar', 'incluir'\)/);
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
  });
});
