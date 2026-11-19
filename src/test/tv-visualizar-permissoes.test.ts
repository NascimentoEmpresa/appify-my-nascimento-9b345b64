import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MENU_VISUALIZAR_TODAS, MENU_VISUALIZAR_TVS, PREFIXO_MENU_PLAYLIST, ROTA_VISUALIZAR_TVS,
  menuDaPlaylist, playlistsDaLista, podeVisualizarPlaylist, resumoPlaylist,
} from "@/lib/tv/visualizarTvs";

// Visualizar TVs (mig 20261120200000): vê a playlist quem tem a tela E
// (todas as TVs OU o menu fantasma daquela playlist).

const PL = "0b3c9f2e-1a2b-4c5d-8e9f-001122334455";
const OUTRA = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const com = (...codigos: string[]) => (c: string) => codigos.includes(c);

describe("Visualizar TVs — quem vê qual TV", () => {
  it("menu da playlist é o id sem traços, com o prefixo do módulo", () => {
    expect(menuDaPlaylist(PL)).toBe("tvs_visualizar_pl_0b3c9f2e1a2b4c5d8e9f001122334455");
    expect(menuDaPlaylist(PL).startsWith(PREFIXO_MENU_PLAYLIST)).toBe(true);
  });

  it("sem a tela, nada — nem com 'todas' nem com a playlist", () => {
    expect(podeVisualizarPlaylist(com(MENU_VISUALIZAR_TODAS, menuDaPlaylist(PL)), PL)).toBe(false);
  });

  it("tela + 'todas' vê qualquer playlist", () => {
    const tem = com(MENU_VISUALIZAR_TVS, MENU_VISUALIZAR_TODAS);
    expect(podeVisualizarPlaylist(tem, PL)).toBe(true);
    expect(podeVisualizarPlaylist(tem, OUTRA)).toBe(true);
  });

  it("tela + uma playlist vê só ela", () => {
    const tem = com(MENU_VISUALIZAR_TVS, menuDaPlaylist(PL));
    expect(podeVisualizarPlaylist(tem, PL)).toBe(true);
    expect(podeVisualizarPlaylist(tem, OUTRA)).toBe(false);
  });

  it("só a tela, sem nenhuma TV liberada, não vê nada", () => {
    expect(podeVisualizarPlaylist(com(MENU_VISUALIZAR_TVS), PL)).toBe(false);
  });

  it("a lista mostra só as liberadas; as incluídas ficam só para a prévia", () => {
    const lista = playlistsDaLista([
      { nome: "TV SST", liberada: false },
      { nome: "TV Diretoria ADM", liberada: true },
      { nome: "Compras — Suprimentos", liberada: true },
    ]);
    expect(lista.map((p) => p.nome)).toEqual(["Compras — Suprimentos", "TV Diretoria ADM"]);
  });

  it("resumo conta itens ativos e TVs, no singular e no plural", () => {
    expect(resumoPlaylist({ itens: [{ ativo: true }, { ativo: false }], tvs: 1 })).toBe("1 item · 1 TV");
    expect(resumoPlaylist({ itens: [{ ativo: true }, { ativo: true }], tvs: 0 })).toBe("2 itens · 0 TVs");
  });
});

describe("Visualizar TVs — o banco usa os mesmos códigos", () => {
  const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261120200000_tvs_visualizar.sql"), "utf8");

  it("menu da tela com a rota da tela, e o 'todas' sem rota (fantasma)", () => {
    expect(sql).toContain(`'${MENU_VISUALIZAR_TVS}', 'Visualizar TVs', '${ROTA_VISUALIZAR_TVS}'`);
    expect(sql).toMatch(new RegExp(`'${MENU_VISUALIZAR_TODAS}', '[^']+', NULL`));
  });

  it("tv_visualizar_menu monta o código como menuDaPlaylist", () => {
    expect(sql).toContain(`'${PREFIXO_MENU_PLAYLIST}' || replace(p_playlist::text, '-', '')`);
  });

  it("a regra no banco: tela E (todas OU playlist), por has_screen_access", () => {
    const regra = sql.slice(sql.indexOf("FUNCTION public.tv_pode_visualizar_playlist"), sql.indexOf("REVOKE ALL ON FUNCTION public.tv_pode_visualizar_playlist"));
    expect(regra).toContain(`has_screen_access(p_user, '${MENU_VISUALIZAR_TVS}'`);
    expect(regra).toContain(`has_screen_access(p_user, '${MENU_VISUALIZAR_TODAS}'`);
    expect(regra).toContain("has_screen_access(p_user, public.tv_visualizar_menu(p_playlist)");
    expect(regra).not.toMatch(/has_role/);
  });
});
