// SIS-2026-0611: Fluxo de Caixa em três abas.
//   Realizado   = o que já aconteceu (pago/recebido, data até hoje).
//   Projetado   = o que está previsto: compromissos ainda não pagos (qualquer data — os de data
//                 passada são os "vencidos") e lançamentos já feitos com data de pagamento futura
//                 (ex.: parcelas de cartão ainda por vencer).
//   Consolidado = os dois juntos.
export type AbaFluxo = "realizado" | "projetado" | "consolidado";

export const ABAS_FLUXO: { valor: AbaFluxo; titulo: string; descricao: string }[] = [
  { valor: "realizado", titulo: "Realizado", descricao: "Entradas e saídas já pagas/recebidas" },
  { valor: "projetado", titulo: "Projetado", descricao: "Pagamentos futuros e recebimentos previstos" },
  { valor: "consolidado", titulo: "Consolidado", descricao: "Realizado + Projetado" },
];

export type SituacaoFluxo = "vencido" | "a_vencer" | "previsto" | "cancelado";

export const SITUACOES_FLUXO: { valor: SituacaoFluxo; rotulo: string; curto: string }[] = [
  { valor: "vencido", rotulo: "Vencido", curto: "Vencido" },
  { valor: "a_vencer", rotulo: "A vencer (7 dias)", curto: "A vencer" },
  { valor: "previsto", rotulo: "Previsto", curto: "Previsto" },
  { valor: "cancelado", rotulo: "Cancelado", curto: "Cancelado" },
];

// Janela do "a vencer".
export const DIAS_A_VENCER = 7;

// Data local (não UTC): às 22h de Brasília o "hoje" em UTC já seria amanhã.
export function hojeISO(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function somaDiasISO(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + dias);
  return hojeISO(d);
}

interface LinhaFluxo {
  data_pagamento: string | null;
  // Só as linhas da view de previstos trazem: 'aberto' | 'cancelado'.
  situacao_base?: "aberto" | "cancelado" | null;
}

// Linha "prevista" = ainda não aconteceu: veio da view de previstos, ou já está no Fluxo
// mas com data de pagamento depois de hoje. O dia de hoje conta como realizado.
export function ehPrevista(l: LinhaFluxo, hoje: string): boolean {
  if (l.situacao_base) return true;
  return !!l.data_pagamento && l.data_pagamento.slice(0, 10) > hoje;
}

// Só existe para linhas previstas (null para as realizadas).
export function situacaoFluxo(l: LinhaFluxo, hoje: string): SituacaoFluxo | null {
  if (!ehPrevista(l, hoje)) return null;
  if (l.situacao_base === "cancelado") return "cancelado";
  const data = l.data_pagamento?.slice(0, 10);
  if (!data) return "previsto";
  if (data < hoje) return "vencido";
  if (data <= somaDiasISO(hoje, DIAS_A_VENCER)) return "a_vencer";
  return "previsto";
}

export function filtrarPorAbaFluxo<T extends LinhaFluxo>(linhas: T[], aba: AbaFluxo, hoje: string): T[] {
  if (aba === "consolidado") return linhas;
  return aba === "projetado" ? linhas.filter((l) => ehPrevista(l, hoje)) : linhas.filter((l) => !ehPrevista(l, hoje));
}

// Cancelado só aparece quando a situação "Cancelado" é pedida e nunca entra em totais.
export function filtrarPorSituacaoFluxo<T extends LinhaFluxo>(linhas: T[], situacao: SituacaoFluxo | "", hoje: string): T[] {
  return linhas.filter((l) => {
    const s = situacaoFluxo(l, hoje);
    if (situacao) return s === situacao;
    return s !== "cancelado";
  });
}
