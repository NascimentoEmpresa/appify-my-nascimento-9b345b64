// =====================================================================
// RECARGA GERAL — "todo mundo atualiza obrigatoriamente" (12/11/2026)
//
// Incidente do Mural do Início: os comentários saíram do servidor, mas quem
// estava com o Início aberto continuou vendo — o app não refaz consulta
// sozinho desde 03/11 (App.tsx: refetchOnWindowFocus off) e não havia como
// mandar as abas abertas recarregarem.
//
// SEM TEMPORIZADOR. O QA de telas deixa cada tela parada 10 min e reprova
// qualquer requisição que saia sozinha (post-mortem de 03/11: polling
// derrubou o servidor). Então a aba só confere quando a PESSOA usa a tela —
// clique, tecla, rolagem, toque, troca de tela, volta para a aba —, no
// máximo 1x por minuto. Quem está lendo o Início rola a página e é pego;
// aba esquecida aberta não custa nada e recarrega no primeiro uso.
//
// Abrir a tela também não custa requisição: o banco devolve há quantos
// SEGUNDOS foi o último pedido (sistema_recarga_idade, mig 20261113110100)
// e a aba compara com há quanto tempo ELA foi aberta (performance.now).
// Pedido mais novo que a aba → recarrega, depois de um sorteio de até 30 s
// (as abas não voltam todas no mesmo segundo). Nenhum relógio precisa bater
// com o outro.
//
// O pedido sai do botão "Forçar todos a recarregar" (Quadro de Avisos), com
// a capacidade sistema_forcar_recarga.
// =====================================================================

import { toast } from "sonner";

/** Entre duas conferências, no mínimo isto — mesmo com a pessoa mexendo sem parar. */
export const INTERVALO_MIN_MS = 60_000;
export const ATRASO_MAX_MS = 30_000;
/** Folga para o tempo da própria requisição e arredondamentos. */
const FOLGA_MS = 5_000;

/**
 * O pedido de recarga é mais novo que esta aba? Puro, para o teste.
 * `idadePedidoSeg`: há quantos segundos o banco registrou o último pedido
 * (null = nunca). `idadeAbaMs`: há quantos ms esta aba foi aberta.
 */
export function precisaRecarregar(idadePedidoSeg: number | null, idadeAbaMs: number): boolean {
  if (idadePedidoSeg == null || !Number.isFinite(idadePedidoSeg) || idadePedidoSeg < 0) return false;
  return idadePedidoSeg * 1000 + FOLGA_MS < idadeAbaMs;
}

type Rpc = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

let sb: Rpc | null = null;
let recarregando = false;
let consultando = false;
let ultimaConsulta = 0;

const escondida = () => typeof document !== "undefined" && document.visibilityState === "hidden";

function recarregar() {
  if (recarregando) return;
  recarregando = true;
  const atraso = Math.round(Math.random() * ATRASO_MAX_MS);
  toast.info("O ERP foi atualizado — esta página vai recarregar em instantes.", { duration: atraso + 2000 });
  setTimeout(() => window.location.reload(), atraso);
}

/** Chamado a cada uso da tela; consulta no máximo 1x por minuto. */
export async function conferirRecarga() {
  if (!sb || recarregando || consultando || escondida()) return;
  if (Date.now() - ultimaConsulta < INTERVALO_MIN_MS) return;
  consultando = true;
  ultimaConsulta = Date.now();
  try {
    const { data, error } = await sb.rpc("sistema_recarga_idade");
    if (error) return; // migration ainda não no banco, queda: tenta no próximo uso
    if (precisaRecarregar(data == null ? null : Number(data), performance.now())) recarregar();
  } catch {
    /* rede: tenta no próximo uso */
  } finally {
    consultando = false;
  }
}

/**
 * Uma vez por carga de página, depois do login (AppShell). A primeira
 * conferência só acontece no primeiro uso depois de um minuto de aba aberta
 * — abrir a tela não faz requisição.
 */
export function instalarRecargaGeral(cliente: Rpc) {
  if (sb || typeof window === "undefined") return;
  sb = cliente;
  ultimaConsulta = Date.now();
  const uso = () => void conferirRecarga();
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const) {
    window.addEventListener(ev, uso, { passive: true, capture: true });
  }
  document.addEventListener("visibilitychange", uso);
}

/** Registra o pedido: as abas abertas (com este código) recarregam no próximo uso. */
export async function forcarRecargaGeral(cliente: Rpc, motivo?: string): Promise<number> {
  const { data, error } = await cliente.rpc("sistema_forcar_recarga", { p_motivo: motivo ?? null });
  if (error) throw error;
  return Number(data);
}
