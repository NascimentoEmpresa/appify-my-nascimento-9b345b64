import { describe, expect, it } from "vitest";
import {
  LABEL_STATUS_AGENDAMENTO, agendamentoVivo, podeConcluirAgendamento,
} from "@/lib/veiculos/concluirAgendamento";

// Reclamação da Frota (10/11/2026): viagem do JOEL DOS SANTOS com KM inicial,
// KM final, fotos e notas ficava "confirmado" sem NADA para concluir.
describe("podeConcluirAgendamento", () => {
  it("viagem finalizada e ainda confirmada → pode concluir (caso da reclamação)", () => {
    expect(podeConcluirAgendamento({ status: "confirmado", finalizada_em: "2026-11-10T11:07:00Z" })).toBe(true);
  });

  it("viagem ainda não finalizada (sem KM final) → não conclui, primeiro fecha a viagem", () => {
    expect(podeConcluirAgendamento({ status: "confirmado", finalizada_em: null })).toBe(false);
    expect(podeConcluirAgendamento({ status: "confirmado" })).toBe(false);
  });

  it("já concluído ou cancelado → sem botão", () => {
    expect(podeConcluirAgendamento({ status: "concluido", finalizada_em: "2026-11-10T11:07:00Z" })).toBe(false);
    expect(podeConcluirAgendamento({ status: "cancelado", finalizada_em: "2026-11-10T11:07:00Z" })).toBe(false);
  });

  it("sem dado carregado → false", () => {
    expect(podeConcluirAgendamento(null)).toBe(false);
    expect(podeConcluirAgendamento(undefined)).toBe(false);
  });
});

describe("agendamentoVivo", () => {
  it("concluído continua contando no calendário e no painel; cancelado não", () => {
    expect(agendamentoVivo({ status: "confirmado" })).toBe(true);
    expect(agendamentoVivo({ status: "concluido" })).toBe(true);
    expect(agendamentoVivo({ status: "cancelado" })).toBe(false);
  });

  it("rótulo do status concluído tem acento", () => {
    expect(LABEL_STATUS_AGENDAMENTO.concluido).toBe("concluído");
  });
});
