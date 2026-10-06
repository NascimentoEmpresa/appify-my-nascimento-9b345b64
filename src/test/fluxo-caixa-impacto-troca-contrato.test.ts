import { describe, expect, it } from "vitest";
import { calcularImpactoTroca, type LinhaUtilizado } from "@/pages/financeiro/fluxo-caixa/impactoTrocaContrato";

const l = (despesa_id: string, contrato_id: string, valor: number, mes = "2026-09", cls = "C1"): LinhaUtilizado => ({
  despesa_id, contrato_id, classificacao_id: cls, competencia: `${mes}-01`, valor,
});

describe("impacto da troca de contrato no Orçamento (SIS-2026-0552)", () => {
  it("dentro do orçado: sem excesso", () => {
    const util = [l("D1", "A", 1000), l("D2", "B", 500)];
    const r = calcularImpactoTroca(util, "D1", "B", "2026-09", () => 2000)!;
    expect(r.valorQueEntra).toBe(1000);
    expect(r.utilizadoNovoContrato).toBe(500);
    expect(r.aposTroca).toBe(1500);
    expect(r.excesso).toBe(0);
  });

  it("estoura o orçado do contrato novo: informa o excesso", () => {
    const util = [l("D1", "A", 1000), l("D2", "B", 1500)];
    const r = calcularImpactoTroca(util, "D1", "B", "2026-09", () => 2000)!;
    expect(r.aposTroca).toBe(2500);
    expect(r.excesso).toBe(500);
  });

  it("só conta a mesma classificação e o mesmo mês no contrato novo", () => {
    const util = [l("D1", "A", 1000), l("D2", "B", 900, "2026-09", "OUTRA"), l("D3", "B", 900, "2026-10")];
    const r = calcularImpactoTroca(util, "D1", "B", "2026-09", () => 1000)!;
    expect(r.utilizadoNovoContrato).toBe(0);
    expect(r.excesso).toBe(0);
  });

  it("despesa parcelada: soma só as parcelas do mês avaliado", () => {
    const util = [l("D1", "A", 300, "2026-09"), l("D1", "A", 300, "2026-10"), l("D1", "A", 300, "2026-11")];
    const r = calcularImpactoTroca(util, "D1", "B", "2026-10", () => 250)!;
    expect(r.valorQueEntra).toBe(300);
    expect(r.excesso).toBe(50);
  });

  it("orçado desconhecido não gera excesso; despesa fora do Utilizado não tem o que checar", () => {
    expect(calcularImpactoTroca([l("D1", "A", 100)], "D1", "B", "2026-09", () => null)!.excesso).toBe(0);
    expect(calcularImpactoTroca([], "D9", "B", "2026-09", () => 1)).toBeNull();
  });
});
