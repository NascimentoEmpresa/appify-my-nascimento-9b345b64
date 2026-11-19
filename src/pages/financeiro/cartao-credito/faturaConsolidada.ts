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

// [SEM-CHAMADO] 19/11/2026: a mesma conferência com o boleto aparece também na lista de competências do cartão e no Classificar
// Lançamentos — antes só o Fluxo e o card "Faturas consolidadas" comparavam. Motivo: a BB HAGG 09/2026 ficou R$ 1.210,00 menor no
// Fluxo (parcela 4/10 da AZUL SEGUROS excluída por engano) e nada avisou, porque o valor do boleto não tinha sido informado e as
// telas só se comparavam entre si. Com o boleto informado, a diferença aparece onde a fatura é classificada.
export function textoConferenciaFatura(cmp: ComparacaoFatura, valorFatura: number | null | undefined, fmt: (n: number) => string): string {
  if (cmp.status === "sem_valor") return "valor da fatura não informado";
  if (cmp.status === "confere") return "confere com a fatura";
  const quanto = fmt(Math.abs(cmp.diferenca));
  return `fatura ${fmt(Number(valorFatura))} · ${cmp.diferenca > 0 ? `faltam ${quanto}` : `sobram ${quanto}`} nos itens`;
}
