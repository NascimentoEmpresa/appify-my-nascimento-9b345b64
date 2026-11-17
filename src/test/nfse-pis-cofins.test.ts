import { describe, expect, it } from "vitest";
import { baseItensPisCofins, lerPercentualNfse, preverPisCofins } from "@/pages/financeiro/controle-notas/pisCofinsNfse";
import type { NfEmissaoItemRow, NfEmissaoRow } from "@/hooks/useNfEmissao";

const item = { id: "a", vlr_bruto: 29848.96, pis: 194.02, cofins: 895.47, vlr_liquido: 22795.93 } as NfEmissaoItemRow;
const nf = { vlr_bruto_total: item.vlr_bruto, pis_total: item.pis, cofins_total: item.cofins, vlr_liquido_total: item.vlr_liquido } as NfEmissaoRow;
describe("PIS/COFINS antes da emissão", () => {
  it.each([["0,65", .65], ["3", 3], ["0", 0], ["100.00", 100], ["", null], ["-1", null], ["101", null], ["0.655", null], ["abc", null], ["1,000.00", null]])("lê percentual %s sem assumir código fiscal", (valor, esperado) => {
    expect(lerPercentualNfse(valor as string)).toBe(esperado);
  });
  it("reproduz os valores da nota e preserva retenções ao zerar ou trocar percentuais", () => {
    const antes = JSON.stringify({ nf, item });
    expect(preverPisCofins(nf, [item], .65, 3)).toEqual({ pis: 194.02, cofins: 895.47, liquido: 22795.93 });
    expect(preverPisCofins(nf, [item], 0, 0)).toEqual({ pis: 0, cofins: 0, liquido: 23885.42 });
    expect(preverPisCofins(nf, [item], 1, 2)).toEqual({ pis: 298.49, cofins: 596.98, liquido: 22989.95 });
    expect(JSON.stringify({ nf, item })).toBe(antes);
  });
  it("arredonda por item e não calcula sobre o líquido nem duplica a retenção", () => {
    const itens = ["b", "a"].map(id => ({ id, vlr_bruto: 1, pis: 0, cofins: 0, vlr_liquido: .8 } as NfEmissaoItemRow));
    const nota = { vlr_bruto_total: 2, pis_total: 0, cofins_total: 0, vlr_liquido_total: 1.6 } as NfEmissaoRow;
    expect(preverPisCofins(nota, itens, .5, .5)).toEqual({ pis: .02, cofins: .02, liquido: 1.56 });
    expect(baseItensPisCofins(itens).map(i => i.id)).toEqual(["a", "b"]);
  });
  it("bloqueia líquido negativo e itens desatualizados ou ausentes", () => {
    expect(() => preverPisCofins(nf, [item], 100, 100)).toThrow("negativo");
    expect(() => preverPisCofins(nf, [], .65, 3)).toThrow("divergem");
    expect(() => preverPisCofins(nf, [{ ...item, pis: 0 }], .65, 3)).toThrow("divergem");
  });
});
