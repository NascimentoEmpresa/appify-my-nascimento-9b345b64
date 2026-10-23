import { describe, expect, it } from "vitest";
import { exemploPrazo, proximoDiaUtil, rotuloDia, somarPrazo } from "@/pages/malote/exemploPrazo";

// Exemplos das Regras Gerais do Malote, sempre com a data de hoje. 22/10/2026 é uma quinta-feira.
const QUINTA = new Date(2026, 9, 22);
const fimDeSemana = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
const nenhum = () => false;

describe("exemplos das Regras Gerais do Malote", () => {
  it("rótulo do dia: dd/mm e dia da semana", () => {
    expect(rotuloDia(QUINTA)).toBe("22/10 (qui)");
  });

  it("dias úteis pulam fim de semana e feriado; corridos não", () => {
    expect(somarPrazo(QUINTA, 1, "util", fimDeSemana).getDate()).toBe(23);
    expect(somarPrazo(QUINTA, 2, "util", fimDeSemana).getDate()).toBe(26); // sex 23, sáb/dom, seg 26
    expect(somarPrazo(QUINTA, 2, "corrido", fimDeSemana).getDate()).toBe(24);
    const feriadoSexta = (d: Date) => fimDeSemana(d) || (d.getMonth() === 9 && d.getDate() === 23);
    expect(somarPrazo(QUINTA, 1, "util", feriadoSexta).getDate()).toBe(26);
    expect(proximoDiaUtil(QUINTA, feriadoSexta).getDate()).toBe(26);
  });

  it("1.1 no dia de hoje: até o horário paga hoje; depois, dia seguinte; pede exceção/chave", () => {
    const l = exemploPrazo({ numero: "1.1", modo: "hoje", horario: "12:00", dias: 1, unidade: "util", hoje: QUINTA, bloqueado: nenhum });
    expect(l[0]).toContain("22/10 (qui)");
    expect(l[0]).toContain("até as 12:00");
    expect(l[1]).toContain("23/10 (sex)");
    expect(l.join(" ")).toMatch(/Exceção.*chave/);
  });

  it("1.1 no dia de hoje: avisa quando o dia seguinte é bloqueado", () => {
    const sexta = new Date(2026, 9, 23);
    const l = exemploPrazo({ numero: "1.1", modo: "hoje", horario: "12:00", dias: 1, unidade: "util", hoje: sexta, bloqueado: fimDeSemana });
    expect(l.join(" ")).toContain("24/10 (sáb) é dia bloqueado");
    expect(l.join(" ")).toContain("26/10 (seg)");
  });

  it("1.1 em até N dias úteis: antes do horário conta de hoje, depois conta de amanhã", () => {
    const l = exemploPrazo({ numero: "1.1", modo: "dias_uteis", horario: "12:00", dias: 1, unidade: "util", hoje: QUINTA, bloqueado: fimDeSemana });
    expect(l[0]).toContain("em até 1 dia útil: 23/10 (sex)");
    expect(l[1]).toContain("26/10 (seg)"); // base sex 23 + 1 útil = seg 26
  });

  it("1.2: pagamento no mesmo dia ou em até N dias, e o reagendamento só se estiver ligado", () => {
    const base = { numero: "1.2" as const, horario: "00:01", dias: 2, unidade: "util" as const, hoje: QUINTA, bloqueado: fimDeSemana };
    const hojeMsg = exemploPrazo({ ...base, modo: "hoje", reagendamentoAtivo: true });
    expect(hojeMsg[0]).toContain("é paga no mesmo dia (22/10 (qui))");
    expect(hojeMsg.join(" ")).toContain("reagendado para o próximo dia útil (23/10 (sex))");
    const diasMsg = exemploPrazo({ ...base, modo: "dias_uteis", reagendamentoAtivo: false });
    expect(diasMsg[0]).toContain("em até 2 dias úteis após a aprovação: 26/10 (seg)");
    expect(diasMsg.join(" ")).toContain("reagendamento automático está desligado");
  });
});
