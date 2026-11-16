import type { NfEmissaoItemRow, NfEmissaoRow } from "@/hooks/useNfEmissao";

export function lerPercentualNfse(valor: string): number | null {
  const texto = valor.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(texto)) return null;
  const numero = Number(texto);
  return numero <= 100 ? numero : null;
}
export const baseItensPisCofins = (itens: NfEmissaoItemRow[]) => [...itens].sort((a, b) => a.id.localeCompare(b.id)).map(i => ({
  id: i.id, bruto: Number(i.vlr_bruto), pis: Number(i.pis), cofins: Number(i.cofins), liquido: Number(i.vlr_liquido),
}));
export function preverPisCofins(nf: NfEmissaoRow, itens: NfEmissaoItemRow[], pisPct: number, cofinsPct: number) {
  const centavos = (v: number) => Math.round((v + Number.EPSILON) * 100);
  // Mesmo arredondamento decimal do PostgreSQL, inclusive no meio centavo.
  const tributo = (bruto: number, percentual: number) => Number((BigInt(centavos(bruto)) * BigInt(Math.round(percentual * 100)) + 5000n) / 10000n);
  const total = (campo: "vlr_bruto" | "pis" | "cofins" | "vlr_liquido") => itens.reduce((s, i) => s + centavos(Number(i[campo])), 0);
  const campos = [["vlr_bruto", "vlr_bruto_total"], ["pis", "pis_total"], ["cofins", "cofins_total"], ["vlr_liquido", "vlr_liquido_total"]] as const;
  if (!itens.length || campos.some(([item, nota]) => Math.abs(total(item) - centavos(Number(nf[nota]))) > 1)) {
    throw new Error("Os itens divergem dos valores salvos. Revise e salve a preparação em Emissão de NF.");
  }
  const calculados = itens.map(i => {
    const pis = tributo(Number(i.vlr_bruto), pisPct);
    const cofins = tributo(Number(i.vlr_bruto), cofinsPct);
    const liquido = centavos(Number(i.vlr_liquido)) + centavos(Number(i.pis)) + centavos(Number(i.cofins)) - pis - cofins;
    if (liquido < 0) throw new Error("Os percentuais informados deixam o líquido de um item negativo.");
    return { pis, cofins };
  });
  const pis = calculados.reduce((s, i) => s + i.pis, 0) / 100;
  const cofins = calculados.reduce((s, i) => s + i.cofins, 0) / 100;
  const liquido = (centavos(Number(nf.vlr_liquido_total)) + centavos(Number(nf.pis_total)) + centavos(Number(nf.cofins_total)) - centavos(pis) - centavos(cofins)) / 100;
  if (liquido < 0) throw new Error("Os percentuais informados deixam o líquido negativo.");
  return { pis, cofins, liquido };
}
