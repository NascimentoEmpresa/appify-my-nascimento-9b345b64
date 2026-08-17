import { describe, it, expect } from "vitest";
import {
  diasUteisEntre, somaDiasUteis, dataMinimaVaga, avaliarPrazo, grauPorDiasUteis,
  cargoExigeCnh, aplicarReqCnh, motivoLabel, MOTIVO_EXPANSAO,
  GRAU_ALTA, GRAU_MEDIA, GRAU_BAIXA, REQ_CNH_TEXTO,
} from "@/lib/recrutamento/vagaRegras";

// Datas fixas p/ o teste não depender de "hoje":
//   2026-08-14 é uma sexta-feira; 07/09 (Independência) é uma segunda-feira.
describe("dias úteis", () => {
  it("não conta sábado e domingo", () => {
    // sex 14/08 -> seg 17/08 = 1 dia útil (sáb e dom fora)
    expect(diasUteisEntre("2026-08-14", "2026-08-17")).toBe(1);
    // sex 14/08 -> sex 21/08 = 5 dias úteis
    expect(diasUteisEntre("2026-08-14", "2026-08-21")).toBe(5);
  });

  it("não conta feriado nacional", () => {
    // 07/09/2026 (segunda, Independência) não conta;
    // qui 03/09 -> ter 08/09 = sex 04, seg 07 (feriado, fora), ter 08 => 2
    expect(diasUteisEntre("2026-09-03", "2026-09-08")).toBe(2);
  });

  it("soma dias úteis pulando fim de semana", () => {
    // sex 14/08 + 7 dias úteis = ter 25/08
    expect(somaDiasUteis("2026-08-14", 7)).toBe("2026-08-25");
  });

  it("data mínima da vaga é hoje + 7 dias úteis", () => {
    expect(dataMinimaVaga("2026-08-14")).toBe("2026-08-25");
  });
});

describe("grau de urgência pelo prazo", () => {
  it("mapeia as faixas pedidas", () => {
    expect(grauPorDiasUteis(6)).toBeNull();      // abaixo do mínimo
    expect(grauPorDiasUteis(7)).toBe(GRAU_ALTA);
    expect(grauPorDiasUteis(13)).toBe(GRAU_ALTA);
    expect(grauPorDiasUteis(14)).toBe(GRAU_MEDIA);
    expect(grauPorDiasUteis(20)).toBe(GRAU_MEDIA);
    expect(grauPorDiasUteis(21)).toBe(GRAU_BAIXA);
    expect(grauPorDiasUteis(40)).toBe(GRAU_BAIXA);
  });

  it("barra data abaixo do mínimo e explica a primeira data possível", () => {
    const r = avaliarPrazo("2026-08-18", "2026-08-14");   // 2 dias úteis
    expect(r.ok).toBe(false);
    expect(r.grau).toBeNull();
    expect(r.erro).toContain("25/08/2026");
  });

  it("aceita exatamente 7 dias úteis como urgente", () => {
    const r = avaliarPrazo("2026-08-25", "2026-08-14");
    expect(r.ok).toBe(true);
    expect(r.dias).toBe(7);
    expect(r.grau).toBe(GRAU_ALTA);
  });

  it("data no passado não passa", () => {
    expect(avaliarPrazo("2026-08-10", "2026-08-14").ok).toBe(false);
  });
});

describe("CNH obrigatória por cargo", () => {
  it("pega os cargos da regra, com ou sem acento", () => {
    expect(cargoExigeCnh("MOTORISTA")).toBe("Motorista");
    expect(cargoExigeCnh("motorista de caminhão")).toBe("Motorista");
    expect(cargoExigeCnh("Tratorista")).toBe("Tratorista");
    expect(cargoExigeCnh("OPERADOR DE RETROESCAVADEIRA")).toBe("Operador de retroescavadeira");
    expect(cargoExigeCnh("Supervisor Operacional")).toBe("Supervisor operacional");
    expect(cargoExigeCnh("Supervisora Operacional")).toBe("Supervisor operacional");
  });

  it("não pega cargo que só parece", () => {
    expect(cargoExigeCnh("Auxiliar de Limpeza")).toBeNull();
    expect(cargoExigeCnh("Supervisor de Contratos")).toBeNull();
    expect(cargoExigeCnh("")).toBeNull();
  });

  it("injeta o requisito uma vez só", () => {
    const um = aplicarReqCnh("Experiência de 6 meses", "MOTORISTA");
    expect(um).toContain(REQ_CNH_TEXTO);
    expect(aplicarReqCnh(um, "MOTORISTA")).toBe(um);            // não duplica
    expect(aplicarReqCnh("CNH categoria D", "MOTORISTA")).toBe("CNH categoria D");  // já tinha
    expect(aplicarReqCnh("Ensino médio", "Auxiliar")).toBe("Ensino médio");         // cargo sem regra
  });
});

describe("motivo da vaga", () => {
  it("mostra as vagas antigas com o nome novo", () => {
    expect(motivoLabel("Expansão")).toBe(MOTIVO_EXPANSAO);
    expect(motivoLabel(MOTIVO_EXPANSAO)).toBe(MOTIVO_EXPANSAO);
    expect(motivoLabel("Substituição")).toBe("Substituição");
  });
});
