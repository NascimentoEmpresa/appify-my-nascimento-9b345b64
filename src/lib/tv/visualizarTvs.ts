// =====================================================================
// TV's › Visualizar TVs (20/11/2026, mig 20261120200000)
//
// "Uma tela onde os gestores acompanhem o que está passando em cada TV, cada
// um vendo só as TVs liberadas para ele" (Pablo). Só para ASSISTIR — editar
// é em Sistemas › TV's (sistemas_tvs).
//
// Liberação (Administração › Acesso por Usuário, módulo TV's), no arranjo
// das pastas do WhatsApp: a tela (tvs_visualizar), o menu fantasma "Todas as
// TVs" (tvs_visualizar_todas) e um menu fantasma POR PLAYLIST
// (tvs_visualizar_pl_<uuid sem traços>), criado por gatilho com a playlist.
// Quem decide é o banco (tv_pode_visualizar_playlist); as funções daqui são
// o espelho da regra, para o teste e para a tela.
// =====================================================================

export const MENU_VISUALIZAR_TVS = "tvs_visualizar";
export const MENU_VISUALIZAR_TODAS = "tvs_visualizar_todas";
export const PREFIXO_MENU_PLAYLIST = "tvs_visualizar_pl_";
export const ROTA_VISUALIZAR_TVS = "/app/sistemas/tvs/visualizar";

/** Código do menu fantasma da playlist — a mesma conta de tv_visualizar_menu() no banco. */
export const menuDaPlaylist = (playlistId: string) => PREFIXO_MENU_PLAYLIST + playlistId.replace(/-/g, "");

/** Vê a playlist quem tem a tela E (todas as TVs OU o menu daquela playlist). */
export function podeVisualizarPlaylist(temAcesso: (codigo: string) => boolean, playlistId: string): boolean {
  return temAcesso(MENU_VISUALIZAR_TVS) && (temAcesso(MENU_VISUALIZAR_TODAS) || temAcesso(menuDaPlaylist(playlistId)));
}

export interface PlaylistVisivel<I = unknown> {
  id: string; nome: string; descricao: string | null;
  /** false = veio só porque uma liberada a inclui ("Outra playlist"): toca dentro dela, não entra na lista. */
  liberada: boolean;
  tvs: number;
  itens: I[];
}

/** A lista da esquerda: só as liberadas, na ordem do nome. */
export function playlistsDaLista<P extends Pick<PlaylistVisivel, "liberada" | "nome">>(playlists: P[]): P[] {
  return playlists.filter((p) => p.liberada).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** "N itens · N TVs" — itens ativos (os que podem ir ao ar) e TVs pareadas com a playlist. */
export function resumoPlaylist(p: { itens: { ativo: boolean }[]; tvs: number }): string {
  const n = p.itens.filter((i) => i.ativo).length;
  return `${n} ${n === 1 ? "item" : "itens"} · ${p.tvs} ${p.tvs === 1 ? "TV" : "TVs"}`;
}
