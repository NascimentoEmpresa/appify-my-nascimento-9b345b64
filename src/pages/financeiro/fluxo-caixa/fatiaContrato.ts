import type { LinhaParaExport } from "./exportRateio";

// Despesa rateada entre contratos aparece no Fluxo como UMA linha ("Rateio", valor inteiro). Com um contrato escolhido no filtro, só a fatia
// dele pertence ao filtro: os KPIs e totais somam essa fatia (ex.: 6 mil de um rateio de 10 mil entram nos 6 mil do contrato filtrado,
// somados ao que o contrato tem de lançamentos próprios), e a linha leva o valor do lançamento inteiro em `valorLancamentoRateio`.
type ParteClassificacao = { classificacaoId: string | null; valor: number };
type LinhaComPartes = LinhaParaExport & { partesClassificacao?: ParteClassificacao[] };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function fatiaDoContratoNaLinha<L extends LinhaComPartes>(l: L, contratoIds: string[]): L & { valorLancamentoRateio?: number } {
  if (contratoIds.length === 0 || l.fatura_cartao_id || !l.rateioDetalhe?.length) return l;
  if (l.contrato_id && contratoIds.includes(l.contrato_id)) return l;
  const total = Number(l.valor) || 0;
  const fatia = r2(l.rateioDetalhe.filter((c) => contratoIds.includes(c.id)).reduce((s, c) => s + (Number(c.valor) || 0), 0));
  if (fatia === r2(total) || total === 0) return l;
  const fator = fatia / total;
  return {
    ...l,
    valor: fatia,
    valorLancamentoRateio: total,
    partesClassificacao: l.partesClassificacao?.map((p) => ({ ...p, valor: p.valor * fator })),
  } as L & { valorLancamentoRateio?: number };
}
