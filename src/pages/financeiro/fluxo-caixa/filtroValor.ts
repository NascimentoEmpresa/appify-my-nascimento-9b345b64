// Filtro "Valor" do Fluxo de Caixa: a pessoa digita o valor como fala ("1.234,56",
// "1234,56", "1234.56", "R$ 1.234,56") e o Fluxo mostra só os lançamentos desse
// valor exato. Sinal não importa: entrada e saída são guardadas positivas e o
// que diferencia é a coluna Tipo.
export function parseValorBR(texto: string | null | undefined): number | null {
  const t = (texto ?? "").replace(/R\$|\s/g, "").replace(/^[-+]/, "");
  if (!t) return null;
  let n: string;
  if (t.includes(",")) n = t.replace(/\./g, "").replace(",", ".");
  // "1.234" ou "1.234.567" é milhar no padrão brasileiro, não decimal.
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) n = t.replace(/\./g, "");
  else n = t;
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

// Compara em centavos para não depender de ponto flutuante (0,1 + 0,2).
export function valorConfere(valorLinha: number | string | null | undefined, filtro: number | null): boolean {
  if (filtro === null) return true;
  return Math.round(Math.abs(Number(valorLinha) || 0) * 100) === Math.round(Math.abs(filtro) * 100);
}
