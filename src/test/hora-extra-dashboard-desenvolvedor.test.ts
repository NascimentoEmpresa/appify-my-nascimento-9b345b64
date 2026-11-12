import { describe, expect, it } from "vitest";
import {
  hojeSaoPaulo, mesDe, resumoMesHe, seriePrevistoRealizado, somarMeses, statusMesHe, type LinhaHeDev,
} from "@/pages/sistemas/hora-extra/heDoDesenvolvedor";

// Mesmas regras da RPC hora_extra_dashboard (mig 20261008000009).
const L = (data_he: string, status: string, prev: number, real: number | null = null): LinhaHeDev =>
  ({ data_he, status, total_previsto_min: prev, total_real_min: real });

const linhas: LinhaHeDev[] = [
  L("2026-11-03", "concluida", 120, 150),
  L("2026-11-04", "aguardando_validacao", 60, 90),
  L("2026-11-05", "aprovada", 180),            // data passada → pendente
  L("2026-11-20", "aprovada", 240),            // futura → aprovada
  L("2026-11-06", "reprovada", 600),           // não conta
  L("2026-11-07", "aguardando_liberacao", 300),// não conta
  L("2026-10-30", "concluida", 60, 45),        // outro mês
];
const HOJE = "2026-11-11";

describe("Meu Dashboard — HE pelas regras do Dashboard de Hora Extra", () => {
  it("cards do mês: aprovadas = previsto, realizadas = real, pendentes = aprovadas vencidas", () => {
    expect(resumoMesHe(linhas, "2026-11", HOJE)).toEqual({
      aprovadas_min: 120 + 60 + 180 + 240,
      realizadas_min: 150 + 90,
      pendentes: 1,
      solicitacoes: 6,
    });
  });

  it("série mensal termina no mês escolhido e mantém meses vazios em zero", () => {
    const s = seriePrevistoRealizado(linhas, "2026-11", 12);
    expect(s).toHaveLength(12);
    expect(s[0].mes).toBe("2025-12");
    expect(s[11]).toEqual({ mes: "2026-11", previsto_min: 600, realizado_min: 240 });
    expect(s[10]).toEqual({ mes: "2026-10", previsto_min: 60, realizado_min: 45 });
    expect(s[3]).toEqual({ mes: "2026-03", previsto_min: 0, realizado_min: 0 });
  });

  it("rosca de status em horas, real quando houver", () => {
    const st = Object.fromEntries(statusMesHe(linhas, "2026-11", HOJE).map((f) => [f.chave, f.minutos]));
    expect(st).toEqual({ aprovadas: 90 + 240, concluidas: 150, pendentes: 180 });
  });

  it("aritmética de mês e fuso de São Paulo", () => {
    expect(somarMeses("2026-01", -1)).toBe("2025-12");
    expect(somarMeses("2026-11", 2)).toBe("2027-01");
    expect(mesDe("2026-09-30")).toBe("2026-09");
    // 01/12 às 01h UTC ainda é 30/11 em São Paulo.
    expect(hojeSaoPaulo(new Date("2026-12-01T01:00:00Z"))).toBe("2026-11-30");
  });
});
