import { describe, expect, it } from "vitest";
import {
  ROTAS_OCULTAS_GERENCIAMENTO,
  rotaVisivelNoGerenciamento,
} from "@/lib/menusOcultosGerenciamento";

describe("menus ocultos do gerenciamento de acesso", () => {
  it("mantém exatamente as 15 rotas aposentadas fora do catálogo", () => {
    expect(ROTAS_OCULTAS_GERENCIAMENTO.size).toBe(15);
    for (const rota of ROTAS_OCULTAS_GERENCIAMENTO) {
      expect(rotaVisivelNoGerenciamento(rota)).toBe(false);
    }
  });

  it("preserva menus ativos e capacidades sem rota", () => {
    expect(rotaVisivelNoGerenciamento("/app/financeiro/conferencia-ponto")).toBe(true);
    expect(rotaVisivelNoGerenciamento(null)).toBe(true);
  });

  it("não oculta rotas filhas apenas por prefixo", () => {
    expect(rotaVisivelNoGerenciamento("/app/integracao/importacao-nova")).toBe(true);
  });
});
