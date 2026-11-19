import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LIMITE_OBSERVACAO, ordenarHistorico, podeSalvarObservacao } from "@/pages/chamados/revisaoPessoal";

// SIS-2026-0951 — histórico de observações pessoais (complemento do SIS-2026-0938).
const sql = readFileSync("supabase/migrations/20261120190000_sis_2026_0951_chamado_historico_observacoes.sql", "utf8")
  .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const card = readFileSync("src/pages/chamados/RevisaoPessoalChamado.tsx", "utf8");

describe("histórico de observações do chamado", () => {
  it("só salva texto não vazio e dentro do limite", () => {
    expect(podeSalvarObservacao("   ")).toBe(false);
    expect(podeSalvarObservacao("Revisar após validação com a Controladoria.")).toBe(true);
    expect(podeSalvarObservacao("x".repeat(LIMITE_OBSERVACAO + 1))).toBe(false);
  });

  it("nova observação não apaga as anteriores; mais recente primeiro", () => {
    const h = ordenarHistorico([
      { id: "a", created_at: "2026-11-17T19:28:00Z", texto: "Acompanhar a entrega" },
      { id: "b", created_at: "2026-11-18T12:41:00Z", texto: "Revisar após validação" },
    ]);
    expect(h.map((o) => o.id)).toEqual(["b", "a"]);
  });

  it("banco: só INSERT e SELECT, RLS por dono, sem bypass", () => {
    expect(sql).toMatch(/GRANT SELECT, INSERT ON public\."CHAMADO_SISTEMA_REVISAO_OBSERVACAO" TO authenticated/);
    expect(sql).not.toMatch(/FOR (UPDATE|DELETE)/);
    expect(sql).toMatch(/USING \(user_id = \(SELECT auth\.uid\(\)\)\)/);
    expect(sql).not.toMatch(/has_screen_access|has_role|tem_acesso_menu/);
  });

  it("não mexe no chamado nem no chat", () => {
    expect(sql).not.toMatch(/(ALTER TABLE|UPDATE|INSERT INTO) public\."CHAMADO_SISTEMA"\s/);
    expect(sql).not.toMatch(/CHAMADO_SISTEMA_EVENTO/);
    expect(card).not.toMatch(/CHAMADO_SISTEMA_EVENTO|"CHAMADO_SISTEMA"\)/);
  });

  it("tela tem Salvar observação e Histórico de observações", () => {
    expect(card).toContain("Salvar observação");
    expect(card).toContain("Histórico de observações");
  });
});
