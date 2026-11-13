import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchMenuCode, type MenuRoute } from "@/hooks/useAccessibleMenus";
import { MENU_RESUMO_GERAL, SLUGS_PAINEL_SETOR, menuDoPainel } from "@/lib/implantacao/permissaoChecklist";

const migration = readFileSync(
  "supabase/migrations/20261115000400_implantacao_resumo_contratos_acesso_por_painel.sql",
  "utf8",
);
const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");

const ROTA = "/app/licitacoes/implantacao/painel";

/** Menus (código → rota) que a migration cadastra. */
const menusDaMigration = [...migration.matchAll(/\('(licitacoes-implantacao-painel[a-z-]*)',\s*'[^']+',\s*'([^']+)'/g)]
  .map((m) => ({ codigo: m[1], rota: m[2] }));

describe("Resumo dos Contratos — um acesso por painel", () => {
  it("a migration cadastra os 9 painéis com a rota do menu lateral", () => {
    expect(menusDaMigration).toHaveLength(1 + SLUGS_PAINEL_SETOR.length);
    expect(menusDaMigration).toContainEqual({ codigo: MENU_RESUMO_GERAL, rota: ROTA });
    for (const slug of SLUGS_PAINEL_SETOR) {
      expect(menusDaMigration).toContainEqual({ codigo: menuDoPainel(slug), rota: `${ROTA}/${slug}` });
      expect(sidebar).toContain(`"${ROTA}/${slug}"`);
    }
    expect(migration).toMatch(/WHERE m\.codigo = 'licitacoes'/);
  });

  it("cada rota cai no menu do próprio painel, não no da Implantação", () => {
    const rotas: MenuRoute[] = [
      { codigo: "licitacoes.implantacao", rota: "/app/licitacoes/implantacao", ativo: true },
      { codigo: "implantacao.base", rota: "/app/licitacoes/implantacao/base", ativo: true },
      ...menusDaMigration.map((m) => ({ ...m, ativo: true })),
    ];
    expect(matchMenuCode("/app/licitacoes/implantacao", rotas)).toBe("licitacoes.implantacao");
    expect(matchMenuCode(ROTA, rotas)).toBe(MENU_RESUMO_GERAL);
    expect(matchMenuCode(`${ROTA}/compras`, rotas)).toBe("licitacoes-implantacao-painel-compras");
    expect(matchMenuCode(`${ROTA}/sst`, rotas)).toBe("licitacoes-implantacao-painel-sst");
    // Setor fora da lista fica sob o Resumo geral — nunca aberto.
    expect(matchMenuCode(`${ROTA}/juridico`, rotas)).toBe(MENU_RESUMO_GERAL);
  });

  it("menuDoPainel segue a mesma regra", () => {
    expect(menuDoPainel("rh")).toBe("licitacoes-implantacao-painel-rh");
    expect(menuDoPainel("juridico")).toBe(MENU_RESUMO_GERAL);
    expect(menuDoPainel(null)).toBe(MENU_RESUMO_GERAL);
  });

  it("quem tem só um painel lê os dados; a leitura usa uma função só", () => {
    for (const tabela of ["public.implantacao_contrato", "public.checklist_respostas", 'public."IMPLANTACAO_SETOR_CONFIRMACAO"']) {
      const re = new RegExp(`^CREATE POLICY \\S+ ON ${tabela.replace(/[."]/g, "\\$&")} FOR SELECT[^\\n]*\\n\\s*USING \\(\\(SELECT public\\.implantacao_pode_ler\\(auth\\.uid\\(\\)\\)\\)\\);`, "m");
      expect(migration).toMatch(re);
    }
    const funcao = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.implantacao_pode_ler"), migration.indexOf("$$;"));
    for (const m of menusDaMigration) expect(funcao).toContain(`'${m.codigo}'`);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.implantacao_pode_ler\(uuid\) FROM anon;/);
    expect(migration).not.toMatch(/has_role/);
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
  });

  it("semente: quem já via a Implantação continua vendo os painéis", () => {
    expect(migration).toMatch(/menu_codigo IN \('licitacoes\.implantacao', 'implantacao'\)\s*AND [sp]\.acao = 'visualizar'/);
  });
});
