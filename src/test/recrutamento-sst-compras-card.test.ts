import { describe, expect, it } from "vitest";
import { mensagemEnvioAgendamento, resumoAgendamentoAso, TEMPLATE_AGENDAMENTO_ASO } from "@/lib/recrutamento/agendamentoAso";
import { statusJuridicoCard } from "@/lib/recrutamento/parecerJuridico";

describe("card do kanban: linha fixa do Jurídico", () => {
  it("antes do Jurídico não aparece", () => {
    expect(statusJuridicoCard({}, "ENTRADA")).toBeNull();
    expect(statusJuridicoCard({}, "TRIAGEM")).toBeNull();
  });
  it("na coluna do Jurídico: aguardando parecer", () => {
    expect(statusJuridicoCard({}, "JURÍDICO")?.texto).toBe("Jurídico: aguardando parecer");
  });
  it("depois: o parecer, o pulo ou 'sem parecer registrado'", () => {
    expect(statusJuridicoCard({ juridico_nivel: "alto_risco" }, "SST + COMPRAS")?.texto).toBe("Jurídico: Alto risco");
    expect(statusJuridicoCard({ juridico_pulado: true }, "SST + COMPRAS")?.texto).toBe("Jurídico pulado");
    expect(statusJuridicoCard({}, "ENTREVISTA")?.texto).toBe("Jurídico: sem parecer registrado");
  });
  it("em Reprovado só se houve parecer ou pulo", () => {
    expect(statusJuridicoCard({}, "Reprovado")).toBeNull();
    expect(statusJuridicoCard({ juridico_pulado: true }, "Reprovado")?.texto).toBe("Jurídico pulado");
  });
});

describe("quadro do SST: resumo do agendamento", () => {
  it("data curta com dia da semana e horário", () => {
    expect(resumoAgendamentoAso({ sst_data_exame: "2026-10-19", sst_hora_exame: "11:00" })).toBe("19/10 (seg) · 11:00");
    expect(resumoAgendamentoAso({ sst_data_exame: "2026-10-19" })).toBe("19/10 (seg)");
    expect(resumoAgendamentoAso({})).toBe("");
  });
});

describe("botão Enviar agendamento: o que dizer ao recrutador", () => {
  it("enviado", () => {
    expect(mensagemEnvioAgendamento({ enviado: true }, "NATALIA DA SILVA")).toEqual({ ok: true, texto: "Agendamento enviado no WhatsApp de NATALIA." });
  });
  it("template ainda não aprovado na Meta (132001) ensina o caminho", () => {
    const r = mensagemEnvioAgendamento({ motivo: "falha_envio", detalhe: "(#132001) Template name does not exist in the translation" });
    expect(r.ok).toBe(false);
    expect(r.texto).toContain(TEMPLATE_AGENDAMENTO_ASO);
    expect(r.texto).toContain("Enviar textos para aprovação da Meta");
  });
  it("sem agendamento / sem telefone / outra falha", () => {
    expect(mensagemEnvioAgendamento({ motivo: "sem_agendamento" }).texto).toMatch(/ainda não agendou/);
    expect(mensagemEnvioAgendamento({ motivo: "sem_telefone" }, "Ana").texto).toBe("Ana está sem telefone válido.");
    expect(mensagemEnvioAgendamento({ motivo: "falha_envio", detalhe: "Rate limit" }).texto).toContain("Rate limit");
  });
});
