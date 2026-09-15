import { describe, expect, it } from "vitest";
import { somarOrcadoContratosPorClassificacao, OrcamentoContratoGrupo, OrcamentoContratoRubrica } from "@/hooks/useOrcamentoContratos";

// SIS-2026-0379 (Iury): o Orçado de Pedidos de Compra passou a vir das
// classificações de cada contrato (bloco Contratos do Orçamento Geral), não
// mais do orçamento Administrativo.
function grupo(contratoId: string, rubricas: Partial<OrcamentoContratoRubrica>[]): OrcamentoContratoGrupo {
  const completas = rubricas.map((r, i) => ({
    campo: `campo_${i}`,
    label: `Rubrica ${i}`,
    grupo: "Teste",
    valor: 0,
    classificacaoMaloteId: null,
    ...r,
  }));
  return {
    contrato: { id: contratoId } as OrcamentoContratoGrupo["contrato"],
    rubricas: completas,
    valorTotal: completas.reduce((s, r) => s + r.valor, 0),
  };
}

describe("somarOrcadoContratosPorClassificacao", () => {
  it("soma a mesma classificação entre rubricas e contratos diferentes", () => {
    const soma = somarOrcadoContratosPorClassificacao([
      grupo("contrato-A", [
        { valor: 1000, classificacaoMaloteId: "salario" },
        { valor: 250, classificacaoMaloteId: "salario" },
        { valor: 80, classificacaoMaloteId: "va" },
      ]),
      grupo("contrato-B", [{ valor: 500, classificacaoMaloteId: "salario" }]),
    ]);
    expect(Object.fromEntries(soma)).toEqual({ salario: 1750, va: 80 });
  });

  it("ignora rubrica sem ligação com Classificação do Malote", () => {
    const soma = somarOrcadoContratosPorClassificacao([
      grupo("contrato-A", [
        { valor: 1000, classificacaoMaloteId: null },
        { valor: 300, classificacaoMaloteId: "diaria" },
      ]),
    ]);
    expect(Object.fromEntries(soma)).toEqual({ diaria: 300 });
  });

  it("deduções (valor negativo) abatem o Orçado da classificação ligada", () => {
    const soma = somarOrcadoContratosPorClassificacao([
      grupo("contrato-A", [
        { valor: 1000, classificacaoMaloteId: "salario" },
        { valor: -100, classificacaoMaloteId: "salario" },
      ]),
    ]);
    expect(soma.get("salario")).toBe(900);
  });

  it("sem contratos, nenhuma classificação tem Orçado", () => {
    expect(somarOrcadoContratosPorClassificacao([]).size).toBe(0);
  });
});
