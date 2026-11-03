// =====================================================================
// SST › ASO Admissão — a régua da fila (src/pages/sst/AsoCandidatos.tsx).
// Com teste em src/test/sst-aso-admissao.test.ts.
//
// 03/11/2026 (mig 20261103002300), pedido do Pablo para o SST largar a
// planilha de acompanhamento dos exames admissionais:
//   - EXAME CANCELADO: o candidato saiu do processo (desistência, reprovação
//     ou admissão cancelada — tudo isso põe etapa_processo = 'Reprovado')
//     depois de o SST já ter mexido no exame (pedido à clínica ou
//     agendamento). Aparece ao lado do nome até alguém do SST clicar em
//     "Ciente" (sst_cancelamento_ciente_em/por) — é o aviso para desmarcar
//     na clínica.
//   - ASO REALIZADO/RECEBIDO: marcado nos agendados (sst_aso_realizado_em/por);
//     tira o candidato dos pendentes de acompanhamento.
// Por isso "Agendado" agora É pendente: o acompanhamento só termina com o
// ASO em mãos (ou com o cancelamento ciente).
// =====================================================================

export const ETAPAS_PARALELO = ["SST + COMPRAS", "EXAME SST"];

export type SituacaoAso =
  | "A receber"
  | "A agendar"
  | "Agendado"
  | "Exame cancelado"
  | "Cancelado (ciente)"
  | "ASO realizado/recebido"
  | "Reprovado pelo SST"
  | "Fora da etapa";

export const SITUACOES_ASO: SituacaoAso[] = [
  "A receber", "A agendar", "Agendado", "Exame cancelado", "Cancelado (ciente)",
  "ASO realizado/recebido", "Reprovado pelo SST", "Fora da etapa",
];

/** O que entra no filtro "Pendentes" (o padrão da tela). */
export const SITUACOES_PENDENTES: SituacaoAso[] = ["A receber", "A agendar", "Agendado", "Exame cancelado"];

export interface CandAso {
  etapa_processo?: string | null;
  sst_ok?: boolean | null;
  sst_visto_em?: string | null;
  sst_data_exame?: string | null;
  sst_agendado_em?: string | null;
  sst_solicitado_clinica_em?: string | null;
  sst_aso_realizado_em?: string | null;
  sst_cancelamento_ciente_em?: string | null;
}

/** O SST já mexeu no exame: pediu à clínica ou agendou. */
export function temExame(c: CandAso): boolean {
  return !!(c.sst_agendado_em || c.sst_data_exame || c.sst_solicitado_clinica_em);
}

/**
 * Exame cancelado: tinha exame em andamento e o candidato saiu do processo
 * antes do ASO. Reprovação do próprio SST não conta — foi o SST que fez.
 */
export function exameCancelado(c: CandAso): boolean {
  if (c.sst_ok === false || c.sst_aso_realizado_em) return false;
  return temExame(c) && c.etapa_processo === "Reprovado";
}

export function situacaoAso(c: CandAso): SituacaoAso {
  if (c.sst_ok === false) return "Reprovado pelo SST";
  if (c.sst_aso_realizado_em) return "ASO realizado/recebido";
  if (exameCancelado(c)) return c.sst_cancelamento_ciente_em ? "Cancelado (ciente)" : "Exame cancelado";
  if (c.sst_agendado_em || c.sst_ok === true) return "Agendado";
  if (!ETAPAS_PARALELO.includes(String(c.etapa_processo ?? ""))) return "Fora da etapa";
  return c.sst_visto_em ? "A agendar" : "A receber";
}

export const ehPendente = (c: CandAso) => SITUACOES_PENDENTES.includes(situacaoAso(c));
