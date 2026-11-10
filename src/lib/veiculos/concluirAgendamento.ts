/**
 * Concluir o agendamento de veículo (10/11/2026).
 *
 * Reclamação da Frota: viagem com KM inicial, KM final, fotos e notas de
 * abastecimento continuava "confirmado" e o modal não tinha NADA para
 * concluir. O status 'concluido' existia no banco desde a criação do módulo,
 * mas nada o gravava. Agora: viagem finalizada (KM final registrado ou
 * "Não usei o carro") → botão "Concluir agendamento".
 *
 * Espelho da régua do banco — cs_veiculo_concluir() na migration
 * 20261110003700_veiculos_concluir_agendamento.sql. Mudou aqui, muda lá.
 */

export interface AgendamentoParaConcluir {
  status: string;
  finalizada_em?: string | null;
}

/** O agendamento já pode ser concluído (falta só o clique)? */
export function podeConcluirAgendamento(a: AgendamentoParaConcluir | null | undefined): boolean {
  return !!a && a.status === "confirmado" && !!a.finalizada_em;
}

/** Status que ainda ocupa/representa uma viagem real (para calendário e contagens). */
export function agendamentoVivo(a: { status: string }): boolean {
  return a.status !== "cancelado";
}

export const LABEL_STATUS_AGENDAMENTO: Record<string, string> = {
  confirmado: "confirmado",
  cancelado: "cancelado",
  concluido: "concluído",
};
