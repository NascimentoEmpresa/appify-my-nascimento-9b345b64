import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { montarPlanilhaVagas, resumoCandidatos, salarioNumero, nomeArquivoVagas } from "@/lib/recrutamento/exportarVagas";

describe("salarioNumero", () => {
  it("converte o salário escrito em reais para número (soma e filtro no Excel)", () => {
    expect(salarioNumero("R$ 1.605,33")).toBe(1605.33);
    expect(salarioNumero("1605,33")).toBe(1605.33);
    expect(salarioNumero("1605.33")).toBe(1605.33);
    expect(salarioNumero(2000)).toBe(2000);
  });
  it("texto que não é valor continua texto", () => {
    expect(salarioNumero("A combinar")).toBe("A combinar");
    expect(salarioNumero("")).toBeNull();
  });
});

describe("resumoCandidatos", () => {
  it("separa em andamento, reprovado e desistência e acha a etapa mais adiantada", () => {
    const r = resumoCandidatos([
      { vaga_id: 1, etapa_processo: "TRIAGEM" },
      { vaga_id: 1, etapa_processo: "DOCUMENTAÇÃO" },
      { vaga_id: 1, etapa_processo: "Reprovado" },
      { vaga_id: 1, etapa_processo: "Reprovado", desistiu: true },
      { vaga_id: 1, etapa_processo: null },
    ]);
    expect(r).toEqual({ total: 4, ativos: 2, reprovados: 1, desistencias: 1, etapaMaisAdiantada: "DOCUMENTAÇÃO" });
  });
});

describe("montarPlanilhaVagas", () => {
  const vagas = [
    { id: 10, status: "Pendente Analista", contrato: "TJ", cargo: "SERVENTE", salario: "1.605,33", created_at: "2026-09-11T12:00:00Z" },
    { id: 11, status: "Contratado", contrato: "TJ", cargo: "PORTEIRO", salario: null },
  ];

  it("gera Vagas, Candidatos e Resumo, com o rótulo de status da tela", () => {
    const wb = montarPlanilhaVagas(vagas, {
      rotuloStatus: (s) => (s === "Pendente Analista" ? "Pendente Operacional" : s),
      candidatos: [{ vaga_id: 10, nome: "ANA", etapa_processo: "TRIAGEM" }],
      filtros: [["Contratos", "TJ"]],
      agora: new Date(2026, 9, 14),
    });
    expect(wb.SheetNames).toEqual(["Vagas", "Candidatos", "Resumo"]);
    const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Vagas);
    expect(linhas).toHaveLength(2);
    expect(linhas[0]["Status"]).toBe("Pendente Operacional");
    expect(linhas[0]["Salário"]).toBe(1605.33);
    expect(linhas[0]["Candidatos no processo"]).toBe(1);
    expect(wb.Sheets.Vagas["!autofilter"]).toBeTruthy();
    const resumo = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Resumo, { header: 1 });
    expect(resumo).toContainEqual(["Contratos", "TJ"]);
    expect(resumo).toContainEqual(["TJ", 2]);
  });

  it("sem candidatos, não cria a aba nem as colunas de contagem", () => {
    const wb = montarPlanilhaVagas(vagas);
    expect(wb.SheetNames).toEqual(["Vagas", "Resumo"]);
    const [cab] = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Vagas, { header: 1 });
    expect(cab).not.toContain("Candidatos no processo");
  });

  it("nome do arquivo com a data", () => {
    expect(nomeArquivoVagas(new Date(2026, 9, 14))).toBe("vagas-recrutamento-2026-10-14.xlsx");
  });
});
