// =====================================================================
// RECARGA GERAL — "todo mundo atualiza obrigatoriamente" (12/11/2026)
//
// Incidente do Mural do Início: os comentários saíram do servidor, mas quem
// estava com o Início aberto continuou vendo — o app não refaz consulta
// sozinho desde 03/11 (App.tsx: refetchOnWindowFocus off) e não havia como
// mandar as abas abertas recarregarem.
//
// Agora cada aba guarda o número de "SISTEMA_RECARGA_GERAL".versao que viu
// ao abrir (mig 20261113110100) e pergunta de novo a cada ~2 min, só com a
// aba visível. Número maior que o visto → recarrega:
//   · aba visível: avisa e recarrega depois de um sorteio de até 30 s — as
//     abas não voltam todas no mesmo segundo (post-mortem de 03/11: a
//     manada de recargas derrubava o servidor que tinha acabado de voltar);
//   · aba escondida: não pergunta nem recarrega; confere quando a pessoa
//     voltar a ela.
// O número sobe pelo botão "Forçar todos a recarregar" (Quadro de Avisos),
// com a capacidade sistema_forcar_recarga.
// =====================================================================

import { toast } from "sonner";

export const INTERVALO_MS = 120_000;
export const ATRASO_MAX_MS = 30_000;

/** O que fazer com a versão lida do servidor. Puro, para o teste. */
export function decidirRecarga(vista: number | null, atual: number | null): "guardar" | "recarregar" | "nada" {
  if (atual == null || !Number.isFinite(atual)) return "nada";
  if (vista == null) return "guardar";
  return atual > vista ? "recarregar" : "nada";
}

type Rpc = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

let vista: number | null = null;
let recarregando = false;
let instalado = false;
let ultimaConsulta = 0;

const escondida = () => typeof document !== "undefined" && document.visibilityState === "hidden";

function recarregar() {
  if (recarregando) return;
  recarregando = true;
  const atraso = Math.round(Math.random() * ATRASO_MAX_MS);
  toast.info("O ERP foi atualizado — esta página vai recarregar em instantes.", { duration: atraso + 2000 });
  setTimeout(() => window.location.reload(), atraso);
}

async function verificar(sb: Rpc) {
  if (recarregando || escondida()) return;
  ultimaConsulta = Date.now();
  try {
    const { data, error } = await sb.rpc("sistema_recarga_versao");
    if (error) return; // migration ainda não no banco, queda: tenta na próxima
    const atual = data == null ? null : Number(data);
    const d = decidirRecarga(vista, atual);
    if (d === "guardar") vista = atual;
    else if (d === "recarregar") recarregar();
  } catch {
    /* rede: tenta na próxima */
  }
}

/** Uma vez por carga de página, depois do login (AppShell). */
export function instalarRecargaGeral(sb: Rpc) {
  if (instalado || typeof window === "undefined") return;
  instalado = true;
  void verificar(sb);
  // Intervalo sorteado por aba (±20 %), para não perguntarem todas juntas.
  const passo = Math.round(INTERVALO_MS * (0.8 + Math.random() * 0.4));
  // guardiao-ok: único polling deliberado do ERP — é o que alcança aba parada (incidente do Mural 12/11/2026); 1 RPC STABLE de 1 número a cada ~2 min, só com a aba visível (0,5 req/min/aba, contra 13 req/min do caso de 03/11)
  window.setInterval(() => void verificar(sb), passo);
  // Voltou para a aba: confere na hora (no máximo 1x a cada 20 s).
  document.addEventListener("visibilitychange", () => {
    if (!escondida() && Date.now() - ultimaConsulta > 20_000) void verificar(sb);
  });
}

/** Sobe o número: todas as abas abertas (com este código) recarregam. */
export async function forcarRecargaGeral(sb: Rpc, motivo?: string): Promise<number> {
  const { data, error } = await sb.rpc("sistema_forcar_recarga", { p_motivo: motivo ?? null });
  if (error) throw error;
  return Number(data);
}
