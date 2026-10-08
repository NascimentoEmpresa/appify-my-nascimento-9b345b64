// =====================================================================
// Sistemas › TV's — regras compartilhadas entre o player (/tv) e a gestão
// (mig 20261007000012). Com teste em src/test/sistemas-tvs.test.ts.
// =====================================================================

export type TipoItem = "imagem" | "video" | "url" | "youtube" | "aviso" | "relatorio";

export const TIPOS_ITEM: { valor: TipoItem; rotulo: string; dica: string }[] = [
  { valor: "relatorio", rotulo: "Relatório do ERP", dica: "Números do ERP em tela cheia, atualizados sozinhos — sem rolar nem mexer" },
  { valor: "imagem", rotulo: "Imagem", dica: "JPG, PNG ou WEBP — fica na tela pelo tempo escolhido" },
  { valor: "video", rotulo: "Vídeo", dica: "MP4 — toca até o fim (sem som)" },
  { valor: "aviso", rotulo: "Aviso em texto", dica: "Texto grande sobre uma cor de fundo" },
  { valor: "youtube", rotulo: "YouTube", dica: "Link do vídeo — toca sem som" },
  { valor: "url", rotulo: "Página web", dica: "Endereço de um site (alguns sites não deixam abrir dentro de outra página)" },
];

export interface ItemTv {
  id: string; tipo: TipoItem; titulo: string | null; url: string | null; arquivo: string | null;
  texto: string | null; cor: string | null; duracao_seg: number;
  relatorio?: string | null; rel_periodo?: PeriodoTv | null;
  // Só na PRÉVIA da gestão (Sistemas › TV's): contrato do relatório, o nome
  // dele para o cabeçalho e o arquivo local ainda não enviado (blob:).
  rel_contrato?: string | null; rel_contrato_nome?: string | null; url_previa?: string | null;
}

// ---- Relatórios na TV (mig 20261007000014) ----------------------------------

/** Relatórios que a TV sabe mostrar em tela cheia (mesmos slugs de src/pages/relatorios/sistemas.ts + "geral"). */
export const RELATORIOS_TV: { slug: string; titulo: string }[] = [
  { slug: "geral", titulo: "Visão geral — todos os sistemas" },
  { slug: "recrutamento", titulo: "Gestão Recrutamento" },
  { slug: "demissoes", titulo: "Demissões" },
  { slug: "materiais", titulo: "Materiais" },
  { slug: "ferias", titulo: "Férias" },
  { slug: "medida-disciplinar", titulo: "Medida Disciplinar" },
  { slug: "mudanca-funcao", titulo: "Mudança de Função" },
  { slug: "chamados", titulo: "Chamados" },
  { slug: "orientacoes", titulo: "Orientações Jurídicas" },
  { slug: "colaboradores", titulo: "Colaboradores" },
  { slug: "turnover", titulo: "Turn-over" },
];
export const tituloRelatorioTv = (slug: string | null | undefined) => RELATORIOS_TV.find((r) => r.slug === slug)?.titulo ?? "Relatório";

export type PeriodoTv = "mes" | "3m" | "6m" | "12m" | "ano";
export const PERIODOS_TV: { valor: PeriodoTv; rotulo: string }[] = [
  { valor: "mes", rotulo: "Este mês" }, { valor: "3m", rotulo: "Últimos 3 meses" }, { valor: "6m", rotulo: "Últimos 6 meses" },
  { valor: "12m", rotulo: "Últimos 12 meses" }, { valor: "ano", rotulo: "Este ano" },
];
export const rotuloPeriodoTv = (p: string | null | undefined) => PERIODOS_TV.find((x) => x.valor === p)?.rotulo ?? "Últimos 12 meses";

/** De/até do período do item — a MESMA conta de tv_rel_periodo no banco (usada na prévia). */
export function periodoTv(p: string | null | undefined, hoje: Date = new Date()): { de: string; ate: string } {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const voltaMeses = p === "mes" ? 0 : p === "3m" ? 2 : p === "6m" ? 5 : p === "ano" ? hoje.getMonth() : 11;
  return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth() - voltaMeses, 1)), ate: iso(hoje) };
}

/** Chave do link fixo: 12 caracteres do alfabeto sem 0/O/1/I (tv_gerar_link). Aceita com espaço/traço e minúscula. */
export function normalizarChaveTv(c: string | null | undefined): string | null {
  const s = (c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/.test(s) ? s : null;
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

// ---- AO VIVO × PRÉVIA da gestão (08/10/2026, mig 20261008000003) -------------
//
// Pedido do Pablo: "ao criar a playlist pra TV, ter um PREVIEW e um AO VIVO
// que mostre exatamente como está a tela da TV e como vai ficar após
// atualizar". A gestão desenha as duas telas com o MESMO componente do
// player (/tv/previa num iframe Full HD); aqui fica a decisão do que cada uma
// mostra — a mesma regra do tv_estado (item ativo e dentro da validade;
// aviso geral por cima; pausada; relógio quando não há nada).

/** O que uma tela de TV mostra (o iframe /tv/previa desenha). `chave` muda = remonta (vídeo recomeça, relatório reconsulta). */
export type TelaTv = { chave: string; alerta?: { texto: string; cor: string } | null } & (
  | { modo: "item"; item: ItemTv; inicioS?: number }
  | { modo: "relogio"; nome: string }
  | { modo: "pausada"; nome: string }
  | { modo: "offline"; nome: string; visto: string }
);

/** Campos de item da gestão que importam para saber se ele está no ar. */
export interface ItemNoAr { id: string; ativo: boolean; valido_de: string | null; valido_ate: string | null; ordem: number }

/** Os itens que a TV toca agora: ativos e dentro da validade, na ordem (a regra do tv_estado). */
export function itensNoAr<T extends ItemNoAr>(itens: T[], agora: Date = new Date()): T[] {
  const t = agora.getTime();
  return itens
    .filter((i) => i.ativo && (!i.valido_de || new Date(i.valido_de).getTime() <= t) && (!i.valido_ate || new Date(i.valido_ate).getTime() > t))
    .sort((a, b) => a.ordem - b.ordem);
}

export interface AlertaTv { id: string; texto: string; cor: string; inicio: string; fim: string; todas: boolean; dispositivos: string[]; encerrado_em: string | null; created_at: string }

/** O aviso geral que cobre esta TV agora (o mais recente valendo) — a regra do tv_estado. */
export function alertaDaTv(alertas: AlertaTv[], tvId: string | null, agora: Date = new Date()): AlertaTv | null {
  const t = agora.getTime();
  return [...alertas]
    .filter((a) => !a.encerrado_em && new Date(a.inicio).getTime() <= t && new Date(a.fim).getTime() > t && (a.todas || (!!tvId && a.dispositivos.includes(tvId))))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

/**
 * Em que item a volta da playlist está depois de `decorridoMs` — para simular
 * a TV quando ela ainda não informa o item atual. Vídeo conta pela duração
 * cadastrada (estimativa: na TV ele toca até acabar).
 */
export function posicaoNoLaco(itens: Pick<ItemTv, "duracao_seg">[], decorridoMs: number): { indice: number; noItemMs: number } {
  const dur = itens.map((i) => Math.max(3, i.duracao_seg || 15) * 1000);
  const volta = dur.reduce((a, b) => a + b, 0);
  if (!itens.length || !volta) return { indice: 0, noItemMs: 0 };
  let resto = ((decorridoMs % volta) + volta) % volta;
  for (let i = 0; i < dur.length; i++) {
    if (resto < dur[i]) return { indice: i, noItemMs: resto };
    resto -= dur[i];
  }
  return { indice: 0, noItemMs: 0 };
}

/** O que a TV informou (mig 20261008000003). `suportado` = o banco tem as colunas (a migration foi aplicada). */
export interface AoVivoTv { suportado: boolean; atual_item_id: string | null; atual_desde: string | null }

export interface EntradaAoVivo {
  tv: { id: string; nome: string | null; ativo: boolean; ultimo_ping: string | null };
  itens: ItemTv[];                 // os itens no ar da playlist da TV, na ordem
  alertas: AlertaTv[];
  aoVivo: AoVivoTv | null;
  agora: Date;
  /** Base da simulação (quando a TV não informa o item): a volta conta a partir daqui. */
  simulacaoDesde: number;
}

/**
 * A tela que a TV está mostrando agora, e se é EXATA (a TV informou o item)
 * ou APROXIMADA (simulada pela duração dos itens).
 */
export function telaAoVivo(e: EntradaAoVivo): { tela: TelaTv; exata: boolean; indice: number | null } {
  const nome = e.tv.nome ?? "TV";
  const a = alertaDaTv(e.alertas, e.tv.id, e.agora);
  const alerta = a ? { texto: a.texto, cor: a.cor } : null;
  const chaveAlerta = a?.id ?? "-";
  if (statusTv(e.tv.ultimo_ping, e.agora) !== "online") {
    return { tela: { modo: "offline", nome, visto: haQuanto(e.tv.ultimo_ping, e.agora), chave: `off|${e.tv.id}` }, exata: true, indice: null };
  }
  if (!e.tv.ativo) return { tela: { modo: "pausada", nome, alerta, chave: `pausa|${chaveAlerta}` }, exata: true, indice: null };
  if (!e.itens.length) return { tela: { modo: "relogio", nome, alerta, chave: `rel|${chaveAlerta}` }, exata: true, indice: null };

  const informado = e.aoVivo?.suportado && e.aoVivo.atual_item_id ? e.itens.findIndex((i) => i.id === e.aoVivo!.atual_item_id) : -1;
  if (informado >= 0) {
    const desde = e.aoVivo!.atual_desde ? new Date(e.aoVivo!.atual_desde).getTime() : e.agora.getTime();
    const item = e.itens[informado];
    return {
      tela: { modo: "item", item, inicioS: Math.max(0, (e.agora.getTime() - desde) / 1000), alerta, chave: `i|${item.id}|${e.aoVivo!.atual_desde}|${chaveAlerta}` },
      exata: true, indice: informado,
    };
  }
  const p = posicaoNoLaco(e.itens, e.agora.getTime() - e.simulacaoDesde);
  const item = e.itens[p.indice];
  return { tela: { modo: "item", item, inicioS: p.noItemMs / 1000, alerta, chave: `s|${item.id}|${p.indice}|${chaveAlerta}` }, exata: false, indice: p.indice };
}

/** Duração total da playlist em texto ("2 min 30 s"). Vídeo e YouTube contam pela duração cadastrada. */
export function duracaoTotal(itens: Pick<ItemTv, "duracao_seg">[]): string {
  const s = itens.reduce((t, i) => t + (i.duracao_seg || 0), 0);
  const m = Math.floor(s / 60), r = s % 60;
  return m ? `${m} min${r ? ` ${r} s` : ""}` : `${r} s`;
}
