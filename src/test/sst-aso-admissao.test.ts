import { describe, expect, it } from "vitest";
import { ehPendente, exameCancelado, situacaoAso } from "@/lib/sst/asoAdmissao";

// SST › ASO Admissão — acompanhamento do agendamento (03/11/2026, mig 20261103002300).
describe("régua da fila de ASO admissional", () => {
  const naFila = { etapa_processo: "SST + COMPRAS" };
  const agendado = { ...naFila, sst_visto_em: "2026-11-01T10:00:00Z", sst_agendado_em: "2026-11-01T11:00:00Z", sst_data_exame: "2026-11-05", sst_ok: true };

  it("passos de antes continuam iguais", () => {
    expect(situacaoAso(naFila)).toBe("A receber");
    expect(situacaoAso({ ...naFila, sst_visto_em: "2026-11-01T10:00:00Z" })).toBe("A agendar");
    expect(situacaoAso(agendado)).toBe("Agendado");
    expect(situacaoAso({ ...naFila, sst_ok: false })).toBe("Reprovado pelo SST");
    expect(situacaoAso({ etapa_processo: "Reprovado", sst_visto_em: "2026-11-01T10:00:00Z" })).toBe("Fora da etapa");
  });

  it("agendado é pendente até o ASO realizado/recebido", () => {
    expect(ehPendente(agendado)).toBe(true);
    const feito = { ...agendado, sst_aso_realizado_em: "2026-11-06T09:00:00Z" };
    expect(situacaoAso(feito)).toBe("ASO realizado/recebido");
    expect(ehPendente(feito)).toBe(false);
  });

  it("saiu do processo com exame agendado ou pedido à clínica = exame cancelado, pendente até o ciente", () => {
    const cancelado = { ...agendado, etapa_processo: "Reprovado" };
    expect(exameCancelado(cancelado)).toBe(true);
    expect(situacaoAso(cancelado)).toBe("Exame cancelado");
    expect(ehPendente(cancelado)).toBe(true);

    const ciente = { ...cancelado, sst_cancelamento_ciente_em: "2026-11-03T12:00:00Z" };
    expect(situacaoAso(ciente)).toBe("Cancelado (ciente)");
    expect(ehPendente(ciente)).toBe(false);

    const soPedido = { etapa_processo: "Reprovado", sst_solicitado_clinica_em: "2026-11-02" };
    expect(situacaoAso(soPedido)).toBe("Exame cancelado");
  });

  it("não é cancelamento: reprovação do próprio SST nem ASO já realizado", () => {
    expect(exameCancelado({ ...agendado, etapa_processo: "Reprovado", sst_ok: false })).toBe(false);
    expect(exameCancelado({ ...agendado, etapa_processo: "Reprovado", sst_aso_realizado_em: "2026-11-06T09:00:00Z" })).toBe(false);
    expect(exameCancelado({ etapa_processo: "Reprovado" })).toBe(false);
  });
});
