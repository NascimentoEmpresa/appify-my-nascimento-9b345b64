import { describe, it, expect } from "vitest";
import { MENU_DO_ATALHO, atalhosVisiveis } from "@/pages/comite-etica/vocabulario";

// =====================================================================
// Atalhos do cabeçalho de Denúncias — botão só aparece para quem passa
// no RouteGuard da tela de destino. Caso real (10/11/2026): membro do
// Comitê com a fila liberada e allow=false em comite_etica_indicadores
// clicava em Indicadores e caía em "Sem acesso".
// =====================================================================

describe("atalhosVisiveis", () => {
  it("usa os menus que guardam as rotas de destino", () => {
    expect(MENU_DO_ATALHO.indicadores).toBe("comite_etica_indicadores");
    expect(MENU_DO_ATALHO.configuracao).toBe("comite_etica_configuracao");
  });

  it("esconde Indicadores de quem tem a fila e a configuração, mas não o painel", () => {
    const liberados = new Set(["central_servicos_canal_denuncias", "comite_etica_configuracao"]);
    expect(atalhosVisiveis((m) => liberados.has(m))).toEqual({ indicadores: false, configuracao: true });
  });

  it("mostra os dois para quem tem os dois menus", () => {
    expect(atalhosVisiveis(() => true)).toEqual({ indicadores: true, configuracao: true });
  });
});
