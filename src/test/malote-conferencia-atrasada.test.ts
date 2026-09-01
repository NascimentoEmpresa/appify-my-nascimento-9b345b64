import { describe, expect, it } from "vitest";
import { exigeJustificativaPorConferenciaAtrasada } from "@/hooks/useMaloteConfig";

// SIS-2026-0272 (Iury): "esta solicitando justificativa para o item pois
// passou do horario do item 1.2 porem hoje é sexta e o item é pra terça" —
// a regra 1.2 original olhava só o relógio, ignorando a data de pagamento
// da despesa. Cenário do chamado: sexta 16h, despesa pra terça seguinte.
describe("exigeJustificativaPorConferenciaAtrasada", () => {
  const sexta16h = new Date("2026-09-04T16:00:00");
  const sexta13h = new Date("2026-09-04T13:00:00");

  it("despesa pra daqui a dias (terça), aprovando sexta após o horário: NÃO exige (caso do chamado)", () => {
    expect(exigeJustificativaPorConferenciaAtrasada("2026-09-08", "15:00", sexta16h)).toBe(false);
  });

  it("despesa pra hoje, aprovando após o horário: exige", () => {
    expect(exigeJustificativaPorConferenciaAtrasada("2026-09-04", "15:00", sexta16h)).toBe(true);
  });

  it("despesa vencida (data de pagamento no passado), aprovando após o horário: exige", () => {
    expect(exigeJustificativaPorConferenciaAtrasada("2026-09-01", "15:00", sexta16h)).toBe(true);
  });

  it("despesa pra hoje, mas aprovando ANTES do horário: não exige", () => {
    expect(exigeJustificativaPorConferenciaAtrasada("2026-09-04", "15:00", sexta13h)).toBe(false);
  });

  it("sem data de pagamento: não exige (nada pra comparar)", () => {
    expect(exigeJustificativaPorConferenciaAtrasada(null, "15:00", sexta16h)).toBe(false);
    expect(exigeJustificativaPorConferenciaAtrasada(undefined, "15:00", sexta16h)).toBe(false);
  });

  it("sem horário configurado: não exige", () => {
    expect(exigeJustificativaPorConferenciaAtrasada("2026-09-04", null, sexta16h)).toBe(false);
  });
});
