// =====================================================================
// REABERTURA DECIDIDA PELO GESTOR e TRANSFERÊNCIA ENTRE DEVS
// 12/11/2026, mig 20261112190000. Pedido do Pablo:
//   - Reaberto pelo solicitante ("não atendeu o solicitado"), o chamado
//     mostra o card CHAMADO REABERTO (quem, quando, por quê) e o Gestor de
//     Sistemas NEGA (motivo obrigatório) ou CONFIRMA, mantendo o dev ou
//     mandando para outro.
//   - O dev pede a transferência para outro dev; o Gestor aprova ou recusa.
//   - Trocou o responsável → o chat mostra "Transferido para <dev>".
// As regras moram no banco (RPCs SECURITY DEFINER); aqui só o espelho para a
// tela não oferecer o que o banco recusa. Testado em
// src/test/chamado-reabertura-transferencia.test.ts.
// =====================================================================

/** Mínimo de caracteres do motivo — o mesmo `length(btrim(...)) < 5` das RPCs. */
export const MIN_MOTIVO = 5;

export const motivoValido = (texto: string | null | undefined) => (texto ?? "").trim().length >= MIN_MOTIVO;

/** Quem decide reabertura e transferência: Gestor de Sistemas ou Coordenar (chamado_pode_decidir no banco). */
export const podeDecidir = (p: { canGestorSistemas: boolean; canCoordenar: boolean }) =>
  p.canGestorSistemas || p.canCoordenar;

export type StatusPedido = "pendente" | "confirmada" | "negada" | "aprovada" | "recusada" | "cancelada";

export interface Reabertura {
  id: number;
  chamado_id: string;
  solicitado_por: string | null;
  motivo: string;
  status: "pendente" | "confirmada" | "negada";
  status_chamado: string | null;
  responsavel_anterior: string | null;
  responsavel_novo: string | null;
  decidido_por: string | null;
  decidido_em: string | null;
  motivo_decisao: string | null;
  created_at: string;
}

export interface Transferencia {
  id: number;
  chamado_id: string;
  solicitado_por: string | null;
  de_responsavel: string | null;
  para_responsavel: string | null;
  motivo: string;
  status: "pendente" | "aprovada" | "recusada" | "cancelada";
  decidido_por: string | null;
  decidido_em: string | null;
  motivo_decisao: string | null;
  created_at: string;
}

/**
 * O card de reabertura aparece enquanto o pedido está pendente e, depois de
 * decidido, só enquanto ainda é a notícia mais recente (7 dias) — para o dev
 * e o solicitante verem o desfecho sem precisar caçar no chat.
 */
export function reaberturaEmDestaque(r: Reabertura | null | undefined, agora: Date = new Date()): boolean {
  if (!r) return false;
  if (r.status === "pendente") return true;
  if (!r.decidido_em) return false;
  return agora.getTime() - new Date(r.decidido_em).getTime() < 7 * 24 * 60 * 60 * 1000;
}

/**
 * Opções do "Confirmar reabertura": o dev atual primeiro (é o "manter o
 * mesmo"), depois os outros em ordem alfabética. Quem já não é dev ativo
 * não entra — a RPC recusaria.
 */
export function opcoesDesenvolvedor<T extends { id: string; display_name: string | null }>(
  devs: readonly T[], atualId: string | null | undefined,
): Array<T & { atual: boolean }> {
  const nome = (d: T) => (d.display_name ?? "").toLocaleLowerCase("pt-BR");
  const atual = devs.filter((d) => d.id === atualId).map((d) => ({ ...d, atual: true }));
  const outros = devs
    .filter((d) => d.id !== atualId)
    .sort((a, b) => nome(a).localeCompare(nome(b), "pt-BR"))
    .map((d) => ({ ...d, atual: false }));
  return [...atual, ...outros];
}

/** Para quem o dev pode pedir: qualquer dev ativo, menos ele mesmo. */
export const destinosTransferencia = <T extends { id: string }>(devs: readonly T[], eu: string | null | undefined) =>
  devs.filter((d) => d.id !== eu);

/**
 * Tradução dos eventos desta migration para o chat ("Fulano …"). null = não é
 * um deles (o chat segue com as outras traduções).
 */
export function fraseEventoReabertura(texto: string, quem: string): string | null {
  let m: RegExpMatchArray | null;
  if ((m = texto.match(/^Reabertura solicitada:\s*(.+?)(?:\s*\(aguardando o Gestor de Sistemas\))?$/is)))
    return `${quem} pediu para reabrir o chamado — ${m[1]}`;
  if ((m = texto.match(/^Reabertura negada:\s*(.+)$/is))) return `${quem} negou a reabertura — ${m[1]}`;
  if ((m = texto.match(/^Transferido para\s+(.+)$/i))) return `Transferido para ${m[1]}`;
  return null;
}
