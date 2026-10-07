import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TipoItem } from "@/lib/tv/tv";

// =====================================================================
// Sistemas › TV's — gestão (mig 20261007000012). Tabelas TV_* com RLS por
// has_screen_access('sistemas_tvs', ...); parear só pela RPC tv_parear.
// TV_DISPOSITIVO é lido por coluna: o token_hash nunca sai do banco.
// =====================================================================

// Tabelas novas ainda não estão nos tipos gerados.
const sb = supabase as any;
const K = "sistemas-tvs";
export const MENU_TVS = "sistemas_tvs";

export interface TvDispositivo {
  id: string; nome: string | null; local: string | null; playlist_id: string | null;
  pareado_em: string | null; ultimo_ping: string | null; user_agent: string | null; tela: string | null;
  comando: string | null; comando_em: string | null; ativo: boolean; created_at: string;
}
export interface TvItem {
  id: string; playlist_id: string; ordem: number; tipo: TipoItem; titulo: string | null; url: string | null;
  arquivo: string | null; texto: string | null; cor: string | null; duracao_seg: number;
  valido_de: string | null; valido_ate: string | null; ativo: boolean;
  relatorio: string | null; rel_periodo: string | null; rel_contrato: string | null;
}
export interface TvPlaylist { id: string; nome: string; descricao: string | null; itens: TvItem[] }
export interface TvAlerta {
  id: string; texto: string; cor: string; inicio: string; fim: string; todas: boolean; dispositivos: string[];
  encerrado_em: string | null; created_at: string; created_by_nome: string | null;
}

const COLS_DISP = "id, nome, local, playlist_id, pareado_em, ultimo_ping, user_agent, tela, comando, comando_em, ativo, created_at";

export const useTvDispositivos = () => useQuery({
  queryKey: [K, "dispositivos"],
  // O online/offline vem do ping da TV (a cada 15 s): revalida no mesmo ritmo.
  refetchInterval: 15_000, staleTime: 10_000,
  queryFn: async (): Promise<TvDispositivo[]> => {
    const { data, error } = await sb.from("TV_DISPOSITIVO").select(COLS_DISP).not("pareado_em", "is", null).order("nome");
    if (error) throw error;
    return data ?? [];
  },
});

export const useTvPlaylists = () => useQuery({
  queryKey: [K, "playlists"], staleTime: 30_000,
  queryFn: async (): Promise<TvPlaylist[]> => {
    const { data, error } = await sb.from("TV_PLAYLIST").select("id, nome, descricao, itens:TV_ITEM(*)").order("nome");
    if (error) throw error;
    return (data ?? []).map((p: TvPlaylist) => ({ ...p, itens: [...(p.itens ?? [])].sort((a, b) => a.ordem - b.ordem) }));
  },
});

export const useTvAlertas = () => useQuery({
  queryKey: [K, "alertas"], staleTime: 15_000, refetchInterval: 30_000,
  queryFn: async (): Promise<TvAlerta[]> => {
    const { data, error } = await sb.from("TV_ALERTA").select("*").order("created_at", { ascending: false }).limit(20);
    if (error) throw error;
    return data ?? [];
  },
});

function useMut<T>(fn: (p: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: [K] }) });
}
const ok = ({ error }: { error: { message: string } | null }) => { if (error) throw error; };

export const useParearTv = () => useMut(async (p: { codigo: string; nome: string; local: string; playlistId: string | null }) =>
  ok(await sb.rpc("tv_parear", { p_codigo: p.codigo, p_nome: p.nome, p_local: p.local, p_playlist_id: p.playlistId })));

export const useAtualizarTv = () => useMut(async (p: { id: string; patch: Partial<Pick<TvDispositivo, "nome" | "local" | "playlist_id" | "ativo">> }) =>
  ok(await sb.from("TV_DISPOSITIVO").update(p.patch).eq("id", p.id)));

export const useRecarregarTv = () => useMut(async (ids: string[]) =>
  ok(await sb.from("TV_DISPOSITIVO").update({ comando: "recarregar", comando_em: new Date().toISOString() }).in("id", ids)));

/** Link fixo (mig 20261007000014): gera a chave curta da TV; a anterior para de valer. */
export const useGerarLinkTv = () => useMutation({
  mutationFn: async (id: string): Promise<string> => {
    const { data, error } = await sb.rpc("tv_gerar_link", { p_id: id });
    if (error) throw error;
    return data as string;
  },
});

export const useRemoverTv = () => useMut(async (id: string) => ok(await sb.from("TV_DISPOSITIVO").delete().eq("id", id)));

export const useSalvarPlaylist = () => useMut(async (p: { id?: string; nome: string; descricao?: string | null }) =>
  ok(p.id ? await sb.from("TV_PLAYLIST").update({ nome: p.nome, descricao: p.descricao ?? null, updated_at: new Date().toISOString() }).eq("id", p.id)
          : await sb.from("TV_PLAYLIST").insert({ nome: p.nome, descricao: p.descricao ?? null })));

export const useExcluirPlaylist = () => useMut(async (id: string) => ok(await sb.from("TV_PLAYLIST").delete().eq("id", id)));

export type NovoItem = Omit<TvItem, "id" | "ativo"> & { ativo?: boolean };
export const useSalvarItem = () => useMut(async (p: { id?: string; item: Partial<NovoItem> }) =>
  ok(p.id ? await sb.from("TV_ITEM").update(p.item).eq("id", p.id) : await sb.from("TV_ITEM").insert(p.item)));

export const useExcluirItem = () => useMut(async (item: Pick<TvItem, "id" | "arquivo">) => {
  ok(await sb.from("TV_ITEM").delete().eq("id", item.id));
  // O arquivo só some do bucket depois que o item saiu (se falhar, fica órfão — não quebra nada).
  if (item.arquivo) await sb.storage.from("tv-midia").remove([item.arquivo]);
});

/** Troca a ordem de dois itens vizinhos. */
export const useMoverItem = () => useMut(async (p: { a: TvItem; b: TvItem }) => {
  ok(await sb.from("TV_ITEM").update({ ordem: p.b.ordem }).eq("id", p.a.id));
  ok(await sb.from("TV_ITEM").update({ ordem: p.a.ordem }).eq("id", p.b.id));
});

/** Sobe o arquivo para o bucket público tv-midia e devolve o caminho. */
export async function enviarMidia(playlistId: string, arquivo: File): Promise<string> {
  const ext = (arquivo.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const caminho = `${playlistId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from("tv-midia").upload(caminho, arquivo, { contentType: arquivo.type || undefined, upsert: false });
  if (error) throw error;
  return caminho;
}
export const urlMidia = (caminho: string | null) => (caminho ? supabase.storage.from("tv-midia").getPublicUrl(caminho).data.publicUrl : "");

export const useCriarAlerta = () => useMut(async (p: { texto: string; cor: string; fim: string; todas: boolean; dispositivos: string[]; autor: string }) =>
  ok(await sb.from("TV_ALERTA").insert({ texto: p.texto, cor: p.cor, fim: p.fim, todas: p.todas, dispositivos: p.todas ? [] : p.dispositivos, created_by_nome: p.autor })));

export const useEncerrarAlerta = () => useMut(async (id: string) =>
  ok(await sb.from("TV_ALERTA").update({ encerrado_em: new Date().toISOString() }).eq("id", id)));
