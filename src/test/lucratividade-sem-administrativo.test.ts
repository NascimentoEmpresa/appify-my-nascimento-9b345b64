import { describe, expect, it } from "vitest";
import { ehContratoAdministrativo, semClassificacao } from "@/pages/controladoria/faturamento/regras";

// Lucratividade de Contratos não mostra nem soma os contratos "ADMINISTRATIVO - ..." (centros de custo da empresa).
describe("contrato administrativo na Lucratividade", () => {
  it("casa pelo início do nome, sem acento nem caixa", () => {
    expect(ehContratoAdministrativo("ADMINISTRATIVO - HAGG")).toBe(true);
    expect(ehContratoAdministrativo("  administrativo - canaa")).toBe(true);
    expect(ehContratoAdministrativo("Administrativo - LF")).toBe(true);
  });

  it("contrato de cliente que só cita 'administrativo' no meio do nome continua na tela", () => {
    expect(ehContratoAdministrativo("UFRGS - AUXILIAR ADMINISTRATIVO - 034/2022")).toBe(false);
    expect(ehContratoAdministrativo("TJRS - 023/2025")).toBe(false);
    expect(ehContratoAdministrativo(null)).toBe(false);
  });

  it("o aviso de lançamento sem classificação não conta o administrativo quando a tela o filtra antes", () => {
    const linha = (contrato_id: string) => ({ tipo: "saida" as const, data_pagamento: "2026-10-01", contrato_id, classificacao_nome: null, valor: 100 });
    const ids = new Set(["adm"]);
    const todas = [linha("adm"), linha("cliente")];
    expect(semClassificacao(todas.filter((l) => !ids.has(l.contrato_id))).valor).toBe(100);
  });
});
