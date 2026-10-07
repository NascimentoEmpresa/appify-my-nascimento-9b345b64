// =====================================================================
// Sistemas › TV's — regras compartilhadas entre o player (/tv) e a gestão
// (mig 20261007000012). Com teste em src/test/sistemas-tvs.test.ts.
// =====================================================================

export type TipoItem = "imagem" | "video" | "url" | "youtube" | "aviso";

export const TIPOS_ITEM: { valor: TipoItem; rotulo: string; dica: string }[] = [
  { valor: "imagem", rotulo: "Imagem", dica: "JPG, PNG ou WEBP — fica na tela pelo tempo escolhido" },
  { valor: "video", rotulo: "Vídeo", dica: "MP4 — toca até o fim (sem som)" },
  { valor: "aviso", rotulo: "Aviso em texto", dica: "Texto grande sobre uma cor de fundo" },
  { valor: "youtube", rotulo: "YouTube", dica: "Link do vídeo — toca sem som" },
  { valor: "url", rotulo: "Página web", dica: "Endereço de um site (alguns sites não deixam abrir dentro de outra página)" },
];

export interface ItemTv {
  id: string; tipo: TipoItem; titulo: string | null; url: string | null; arquivo: string | null;
  texto: string | null; cor: string | null; duracao_seg: number;
}

export interface EstadoTv {
  desconhecida?: boolean;
  pareada?: boolean;
  codigo?: string;
  nome?: string; local?: string | null; ativa?: boolean;
  comando?: "recarregar" | null;
  itens?: ItemTv[];
  alerta?: { id: string; texto: string; cor: string; fim: string } | null;
}

/** A TV consulta o ERP a cada INTERVALO_PING_S; sem notícia há 3 consultas, está offline. */
export const INTERVALO_PING_S = 15;
export const OFFLINE_APOS_S = INTERVALO_PING_S * 3 + 5;

export function statusTv(ultimoPing: string | null | undefined, agora: Date = new Date()): "online" | "offline" | "nunca" {
  if (!ultimoPing) return "nunca";
  return (agora.getTime() - new Date(ultimoPing).getTime()) / 1000 <= OFFLINE_APOS_S ? "online" : "offline";
}

/** "há 3 min", "há 2 h", "há 4 dias" — para a coluna "visto por último". */
export function haQuanto(iso: string | null | undefined, agora: Date = new Date()): string {
  if (!iso) return "nunca";
  const s = Math.max(0, Math.round((agora.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return `há ${d} dia${d > 1 ? "s" : ""}`;
}

/** Link de YouTube (watch, youtu.be, shorts, embed) → embed com autoplay, mudo e em loop. null se não reconhecer. */
export function youtubeEmbed(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.trim().match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (!m) return null;
  const id = m[1];
  return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&controls=0&loop=1&playlist=${id}&rel=0&modestbranding=1`;
}

/** Endereço web aceito para o item "página web": só http(s). */
export const urlValida = (u: string | null | undefined) => !!u && /^https?:\/\/[^\s]+\.[^\s]+/i.test(u.trim());

/** Cor de fundo do aviso: só #rgb/#rrggbb; fora disso, o azul padrão. */
export const corAviso = (c: string | null | undefined) => (c && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : "#1d4ed8");

/** Duração total da playlist em texto ("2 min 30 s"). Vídeo e YouTube contam pela duração cadastrada. */
export function duracaoTotal(itens: Pick<ItemTv, "duracao_seg">[]): string {
  const s = itens.reduce((t, i) => t + (i.duracao_seg || 0), 0);
  const m = Math.floor(s / 60), r = s % 60;
  return m ? `${m} min${r ? ` ${r} s` : ""}` : `${r} s`;
}
