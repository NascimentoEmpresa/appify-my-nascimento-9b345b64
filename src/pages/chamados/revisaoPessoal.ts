// SIS-2026-0938 — Marcação pessoal de revisão (mig 20261119050000).
//
// Lembrete do PRÓPRIO usuário, guardado em "CHAMADO_SISTEMA_REVISAO" (RLS por
// dono). Não mexe em status, fila, prazo, avaliação, confirmação nem na trava
// de 3 pendências para abrir chamado — por isso fica fora de
// chamadoComPendencia/motivoNaListaPadrao e não entra em nenhum contador do time.

export type EstadoRevisao = "revisar" | "revisado";
/** null = não marcado. */
export type EstadoRevisaoOuNada = EstadoRevisao | null;

export interface RevisaoChamado {
  chamado_id: string;
  estado: EstadoRevisao;
  observacao: string | null;
  marcado_em: string;
  revisado_em: string | null;
}

/**
 * O que o clique no botão da LISTA faz:
 * - não marcado → "revisar" (amarelo);
 * - "revisar"   → desmarca (volta ao transparente);
 * - "revisado"  → "revisar" de novo (quer rever a entrega outra vez).
 * Finalizar ("revisado") é no detalhe do chamado, com a observação.
 */
export function proximoEstadoNaLista(atual: EstadoRevisaoOuNada): EstadoRevisaoOuNada {
  if (atual === null) return "revisar";
  if (atual === "revisar") return null;
  return "revisar";
}

/** Card de Observação no detalhe: só aparece para quem marcou. */
export const mostraCardObservacao = (atual: EstadoRevisaoOuNada) => atual !== null;

export const VISUAL_REVISAO: Record<"nada" | EstadoRevisao, { rotulo: string; dica: string }> = {
  nada: {
    rotulo: "Revisar",
    dica: "Clique para ativar a marcação de Revisar neste chamado. Você poderá sinalizar que deseja revisar a entrega posteriormente.",
  },
  revisar: {
    rotulo: "Revisar",
    dica: "Marcado para revisar. Abra o chamado para anotar e finalizar com \"Revisado\". Clique aqui para desmarcar.",
  },
  revisado: {
    rotulo: "Revisado",
    dica: "Revisão finalizada. Clique para marcar para revisar de novo.",
  },
};

export const visualRevisao = (atual: EstadoRevisaoOuNada) => VISUAL_REVISAO[atual ?? "nada"];

// ---- Filtro da lista -------------------------------------------------

export type FiltroRevisao = "" | "revisar" | "revisado";

export function passaNoFiltroRevisao(atual: EstadoRevisaoOuNada, filtro: FiltroRevisao): boolean {
  if (!filtro) return true;
  return atual === filtro;
}

export function contarRevisoes(estados: Iterable<EstadoRevisaoOuNada>) {
  let revisar = 0;
  let revisado = 0;
  for (const e of estados) {
    if (e === "revisar") revisar++;
    else if (e === "revisado") revisado++;
  }
  return { revisar, revisado };
}

/** Observação vazia vira null (não grava string em branco). */
export const normalizarObservacao = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t ? t : null;
};
