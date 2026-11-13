import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MENU_EDITAR_CHECKLIST, ACAO_EDITAR_CHECKLIST } from "@/lib/implantacao/permissaoChecklist";
import { acoesGravadasPeloToggle } from "@/lib/acoesDoToggleAcesso";

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

describe("Implantação — Pode editar o checklist (ação 'alterar' da tela)", () => {
  it("é a ação 'alterar' do próprio menu da Implantação, sem menu novo", () => {
    expect(MENU_EDITAR_CHECKLIST).toBe("licitacoes.implantacao");
    expect(ACAO_EDITAR_CHECKLIST).toBe("alterar");
    expect(migration).not.toMatch(/INSERT INTO public\.app_menu \(/);
    expect(migration).toMatch(/\('licitacoes\.implantacao', 'alterar'\)/);
  });

  it("ligar a tela não dá a edição junto; desligar tira tudo", () => {
    expect(acoesGravadasPeloToggle("licitacoes.implantacao", true)).not.toContain("alterar");
    expect(acoesGravadasPeloToggle("licitacoes.implantacao", true)).toContain("visualizar");
    expect(acoesGravadasPeloToggle("licitacoes.implantacao", false)).toContain("alterar");
  });

  it.each(["checklist_respostas_insert", "checklist_respostas_update", "implantacao_update"])(
    "%s exige 'alterar' (nunca 'incluir' nem has_role)",
    (nome) => {
      const corpo = policy(nome);
      expect(corpo).toContain("'licitacoes.implantacao'::text, 'alterar'::app_acao");
      expect(corpo).not.toMatch(/'incluir'/);
      expect(corpo).not.toMatch(/has_role/);
    },
  );

  it("recarrega o schema do PostgREST", () => {
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
  });
});
