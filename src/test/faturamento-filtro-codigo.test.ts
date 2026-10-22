import { describe, expect, it } from "vitest";
import { agruparFaturamento, contaNoFaturamento, notaValidaNoFaturamento, type NfFaturamento } from "@/pages/controladoria/faturamento/regras";
import { CODIGO_TODOS, codigosDoFiltro } from "@/pages/controladoria/faturamento/FiltroCodigoNota";

// Filtro "Código" (tipo da nota) da Lucratividade, do Faturamento e do Fechamento: padrão N, como sempre.
const nf = (o: Partial<NfFaturamento>): NfFaturamento => ({
  contrato_id: "c1", competencia: "2026-01-01", tipo_nota: "N", valor_contrato_exec_total: 100, vlr_bruto_total: 100, vlr_liquido_total: 90,
  valor_pago: null, desconto_conta_vinculada: 0, ...o,
});

describe("filtro Código da nota", () => {
  it("sem filtro, só o Código N conta (comportamento de sempre)", () => {
    expect(contaNoFaturamento(nf({ tipo_nota: "N" }))).toBe(true);
    expect(contaNoFaturamento(nf({ tipo_nota: "R" }))).toBe(false);
  });

  it("com os códigos escolhidos, conta só esses; cancelada e substituída continuam de fora de qualquer código", () => {
    expect(contaNoFaturamento(nf({ tipo_nota: "R" }), ["R"])).toBe(true);
    expect(contaNoFaturamento(nf({ tipo_nota: "N" }), ["R"])).toBe(false);
    expect(contaNoFaturamento(nf({ tipo_nota: "M", status: "cancelada" }), ["M"])).toBe(false);
  });

  it("o filtro 'todos' libera todos os tipos de nota; um código libera só ele", () => {
    expect(codigosDoFiltro(CODIGO_TODOS).sort()).toEqual(["DH", "M", "N", "R"]);
    expect(codigosDoFiltro("R")).toEqual(["R"]);
  });

  it("as somas recebem notas já filtradas por código: não derrubam as de outro código", () => {
    expect(notaValidaNoFaturamento(nf({ tipo_nota: "R" }))).toBe(true);
    const mapa = agruparFaturamento([nf({ tipo_nota: "R", vlr_liquido_total: 50 }), nf({ tipo_nota: "M", vlr_liquido_total: 25, status: "cancelada" })], (n) => n.contrato_id);
    expect(mapa.get("c1")?.liquido).toBe(50);
  });
});
