import { describe, expect, it } from "vitest";
import { divergenciaEntre, faltaDeFaturamento, excessoDeFaturamento, resumirFaturamento, statusCelula, type ParteFaturamento } from "@/pages/controladoria/faturamentoStatus";

const parte = (executavel: number, contabil: number, temNf = true): ParteFaturamento => ({
  executavel,
  contabil,
  naoEmitido: faltaDeFaturamento(executavel, contabil),
  excesso: excessoDeFaturamento(executavel, contabil),
  status: statusCelula(executavel, temNf, true, contabil),
});

describe("status da célula — faturado parcial", () => {
  it("NF cobrindo o executável = faturado; abaixo = parcial", () => {
    expect(statusCelula(1000, true, true, 1000)).toBe("NOTAS_LANCADAS");
    expect(statusCelula(1000, true, true, 1200)).toBe("NOTAS_LANCADAS");
    expect(statusCelula(1000, true, true, 400)).toBe("FATURADO_PARCIAL");
  });

  it("diferença de centavos (tolerância) não vira parcial", () => {
    expect(statusCelula(1000, true, true, 999.5)).toBe("NOTAS_LANCADAS");
  });

  it("sem NF continua pendente / sem dado / sem vigência", () => {
    expect(statusCelula(1000, false, true, 0)).toBe("NENHUM_LANCAMENTO");
    expect(statusCelula(1000, false, false, 0)).toBe("COMPETENCIA_SEM_DADOS");
    expect(statusCelula(0, false, true, 0)).toBe("SEM_VIGENCIA");
  });
});

describe("Não Emitido — soma das faltas por contrato (sem abater excessos)", () => {
  it("contrato com NF acima do executável não abate a falta dos outros", () => {
    const linhas = [parte(1000, 900), parte(500, 700), parte(300, 300)];
    const r = resumirFaturamento(linhas);
    expect(r.naoEmitido).toBe(100); // só a falta do 1º; o excesso de 200 do 2º não abate
    expect(r.excesso).toBe(200);
    expect(r.executavel - r.contabil).toBe(-100); // o cálculo antigo (líquido) daria 0
  });

  it("conta integrais, parciais e pendentes separados", () => {
    const r = resumirFaturamento([parte(1000, 1000), parte(1000, 300), parte(800, 0, false)]);
    expect(r.lancadas).toBe(1);
    expect(r.parciais).toBe(1);
    expect(r.pendentes).toBe(1);
    expect(r.naoEmitido).toBe(700 + 800);
  });
});

describe("SIS-2026-0648 · divergências do Controle de Faturamento", () => {
  it("referência − comparado: positivo quando ficou abaixo, negativo quando passou", () => {
    expect(divergenciaEntre(1000, 700)).toBe(300);
    expect(divergenciaEntre(1000, 1200)).toBe(-200);
  });

  it("centavos de arredondamento não contam como divergência", () => {
    expect(divergenciaEntre(1000, 999.5)).toBe(0);
    expect(divergenciaEntre(1000, 1000)).toBe(0);
  });

  it("resumirFaturamento soma o executado (Relatório N) junto com o resto", () => {
    const r = resumirFaturamento([
      { executavel: 1000, execRel: 900, contabil: 800, naoEmitido: 200, excesso: 0, status: "FATURADO_PARCIAL" },
      { executavel: 500, execRel: 500, contabil: 500, naoEmitido: 0, excesso: 0, status: "NOTAS_LANCADAS" },
    ]);
    expect(r.execRel).toBe(1400);
    expect(divergenciaEntre(r.executavel, r.execRel)).toBe(100);
    expect(divergenciaEntre(r.execRel, r.contabil)).toBe(100);
  });
});
