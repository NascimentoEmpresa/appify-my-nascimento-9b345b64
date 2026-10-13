// SIS-2026-0632: cartão com fatura consolidada no Fluxo de Caixa (Sicredi 2719).
// O Fluxo mostra 1 linha por fatura, no vencimento, com a soma das despesas do
// Malote; o Financeiro digita o VALOR REAL da fatura (do boleto) e a tela compara.

export function chaveFatura(cartaoId: string, faturaMes: string): string {
  return `${cartaoId}:${faturaMes.slice(0, 7)}`;
}

export type StatusComparacaoFatura = "sem_valor" | "confere" | "divergente";

export interface ComparacaoFatura {
  status: StatusComparacaoFatura;
  // valor da fatura − soma das despesas (positivo = faltam despesas lançadas)
  diferenca: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function compararFatura(somaDespesas: number, valorFatura: number | null | undefined): ComparacaoFatura {
  if (valorFatura == null || !Number.isFinite(Number(valorFatura))) return { status: "sem_valor", diferenca: 0 };
  const diferenca = r2(Number(valorFatura) - somaDespesas);
  return { status: Math.abs(diferenca) < 0.01 ? "confere" : "divergente", diferenca };
}
