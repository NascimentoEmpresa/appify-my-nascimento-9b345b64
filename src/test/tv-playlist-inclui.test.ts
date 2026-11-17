import { describe, it, expect } from "vitest";
import { expandirPlaylist, itensAlcancaveis, type ItemExpansivel, type TipoItem } from "@/lib/tv/tv";

// Item "Outra playlist" — a playlist da Presidência passa as dos setores
// (mig 20261118140000; a mesma regra de tv_itens_no_ar no banco).

type It = ItemExpansivel & { playlist_id: string };
let seq = 0;
const item = (playlist_id: string, tipo: TipoItem, duracao_seg: number, extra: Partial<It> = {}): It => ({
  id: `i${++seq}`, playlist_id, tipo, duracao_seg, ordem: seq * 10, ativo: true, valido_de: null, valido_ate: null, inclui_playlist_id: null, ...extra,
});
const agora = new Date("2026-11-18T12:00:00Z");

describe("TVs — playlist que inclui outras", () => {
  const compras = [item("compras", "relatorio", 3600)];
  const rh = [item("rh", "relatorio", 90), item("rh", "relatorio", 45), item("rh", "video", 15)];
  const playlists = [{ id: "compras", itens: compras }, { id: "rh", itens: rh }];

  it("abre cada inclusão no lugar dela, na ordem da playlist incluída, entre os itens próprios", () => {
    const incCompras = item("pre", "playlist", 60, { inclui_playlist_id: "compras" });
    const aviso = item("pre", "aviso", 20);
    const pre = [item("pre", "playlist", 60, { inclui_playlist_id: "rh" }), incCompras, aviso].map((i) => (i.inclui_playlist_id === "rh" ? { ...i, ordem: aviso.ordem + 10 } : i));
    expect(expandirPlaylist(pre, playlists, agora).map((i) => i.id)).toEqual([compras[0].id, aviso.id, ...rh.map((i) => i.id)]);
  });

  it("o tempo da inclusão é o teto de cada item; vídeo segue tocando até o fim", () => {
    const pre = [item("pre", "playlist", 60, { inclui_playlist_id: "compras" }), item("pre", "playlist", 60, { inclui_playlist_id: "rh" })];
    expect(expandirPlaylist(pre, playlists, agora).map((i) => i.duracao_seg)).toEqual([60, 60, 45, 15]);
    // não mexe no item original (a lista da playlist do setor continua com 3600 s)
    expect(compras[0].duracao_seg).toBe(3600);
  });

  it("inclusão desativada, fora da validade ou de playlist que não existe não passa nada", () => {
    const pre = [
      item("pre", "playlist", 60, { inclui_playlist_id: "compras", ativo: false }),
      item("pre", "playlist", 60, { inclui_playlist_id: "rh", valido_ate: "2026-11-01T00:00:00Z" }),
      item("pre", "playlist", 60, { inclui_playlist_id: "apagada" }),
    ];
    expect(expandirPlaylist(pre, playlists, agora)).toEqual([]);
  });

  it("item desativado ou fora da validade na playlist do setor também fica de fora", () => {
    const sst = [item("sst", "relatorio", 30, { ativo: false }), item("sst", "aviso", 20, { valido_de: "2026-12-01T00:00:00Z" }), item("sst", "imagem", 15)];
    const pre = [item("pre", "playlist", 60, { inclui_playlist_id: "sst" })];
    expect(expandirPlaylist(pre, [{ id: "sst", itens: sst }], agora).map((i) => i.id)).toEqual([sst[2].id]);
  });

  it("um nível só: inclusão dentro da playlist incluída é ignorada (sem laço)", () => {
    const a = [item("a", "imagem", 10), item("a", "playlist", 60, { inclui_playlist_id: "b" })];
    const b = [item("b", "imagem", 10), item("b", "playlist", 60, { inclui_playlist_id: "a" })];
    const pre = [item("pre", "playlist", 60, { inclui_playlist_id: "a" })];
    expect(expandirPlaylist(pre, [{ id: "a", itens: a }, { id: "b", itens: b }], agora).map((i) => i.id)).toEqual([a[0].id]);
  });

  it("playlist sem inclusão fica igual (as TVs dos setores não mudam)", () => {
    expect(expandirPlaylist(rh, playlists, agora).map((i) => i.id)).toEqual(rh.map((i) => i.id));
  });

  it("alcançáveis: os itens próprios e todos os das incluídas, para o AO VIVO achar o item informado", () => {
    const desligado = item("compras", "relatorio", 30, { ativo: false });
    const pre = [item("pre", "playlist", 60, { inclui_playlist_id: "compras" })];
    const ids = itensAlcancaveis(pre, [{ id: "compras", itens: [...compras, desligado] }, ...playlists.slice(1)]).map((i) => i.id);
    expect(ids).toEqual([compras[0].id, desligado.id]);
  });
});
