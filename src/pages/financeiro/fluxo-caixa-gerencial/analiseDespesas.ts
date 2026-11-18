// SIS-2026-0893 (etapa 3) — Análise das despesas: por classificação, contrato/centro de custo e origem, com o período anterior. Regras puras.
// Os valores vêm da função financeiro_fluxo_gerencial_despesas (migration 20261119120000); aqui só se normaliza o JSON e se calculam variações e participações.

export type TipoDataDespesa = "pagamento" | "competencia";

export interface ItemAnaliseRpc { nome: string; valor: number; valor_anterior: number; contrato_id?: string | null }

export interface AnaliseDespesasRpc {
  tipo_data: TipoDataDespesa;
  periodo_anterior: { ini: string; fim: string };
  total: number;
  total_anterior: number;
  qtd: number;
  por_classificacao: ItemAnaliseRpc[];
  por_contrato: ItemAnaliseRpc[];
  por_origem: ItemAnaliseRpc[];
  /** despesas dos 12 meses que terminam no mês do fim do período, pela mesma data de referência (migration 20261119130000) */
  por_mes: { mes: string; despesas: number }[];
}

export const ANALISE_VAZIA: AnaliseDespesasRpc = {
  tipo_data: "pagamento", periodo_anterior: { ini: "", fim: "" }, total: 0, total_anterior: 0, qtd: 0, por_classificacao: [], por_contrato: [], por_origem: [], por_mes: [],
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

const ROTULO_ORIGEM: Record<string, string> = {
  malote: "Malote", debito_automatico: "Débito Automático", cartao_fatura: "Fatura de cartão", importacao_historica: "Importação (planilha)", unificado: "Lançamento unificado",
};

function itens(raw: unknown, nomeDe: (o: Record<string, unknown>) => string): ItemAnaliseRpc[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((o) => {
    const x = (o ?? {}) as Record<string, unknown>;
    return { nome: nomeDe(x), valor: num(x.valor), valor_anterior: num(x.valor_anterior), contrato_id: (x.contrato_id as string | null | undefined) ?? null };
  });
}

export function normalizarAnalise(raw: unknown): AnaliseDespesasRpc {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ant = (r.periodo_anterior ?? {}) as Record<string, unknown>;
  return {
    tipo_data: r.tipo_data === "competencia" ? "competencia" : "pagamento",
    periodo_anterior: { ini: String(ant.ini ?? ""), fim: String(ant.fim ?? "") },
    total: num(r.total), total_anterior: num(r.total_anterior), qtd: num(r.qtd),
    por_classificacao: itens(r.por_classificacao, (o) => String(o.nome ?? "Sem classificação")),
    por_contrato: itens(r.por_contrato, (o) => String(o.nome ?? "Sem contrato (administrativo)")),
    por_origem: itens(r.por_origem, (o) => ROTULO_ORIGEM[String(o.origem)] ?? String(o.origem ?? "—")),
    por_mes: Array.isArray(r.por_mes) ? (r.por_mes as Record<string, unknown>[]).map((m) => ({ mes: String(m.mes ?? ""), despesas: num(m.despesas) })) : [],
  };
}

export interface Variacao {
  /** atual − anterior (positivo = a despesa subiu) */
  valor: number;
  /** variação relativa; `null` quando não havia nada no período anterior (não existe base de comparação) */
  pct: number | null;
  situacao: "subiu" | "caiu" | "igual" | "novo" | "zerou";
}

export function variacao(atual: number, anterior: number): Variacao {
  const valor = r2(atual - anterior);
  if (anterior <= 0 && atual > 0) return { valor, pct: null, situacao: "novo" };
  if (anterior > 0 && atual <= 0) return { valor, pct: -1, situacao: "zerou" };
  if (anterior <= 0) return { valor: 0, pct: 0, situacao: "igual" };
  const pct = valor / anterior;
  return { valor, pct, situacao: Math.abs(valor) < 0.005 ? "igual" : valor > 0 ? "subiu" : "caiu" };
}

export interface LinhaComparativo extends ItemAnaliseRpc {
  variacao: Variacao;
  /** participação no total do período atual (0..1) */
  pctDoTotal: number;
}

/** Linhas com variação e participação, da maior despesa atual para a menor. Quem tinha despesa só no período anterior continua aparecendo (variação −100%). */
export function montarComparativo(linhas: ItemAnaliseRpc[], totalAtual: number): LinhaComparativo[] {
  return linhas
    .map((l) => ({ ...l, variacao: variacao(l.valor, l.valor_anterior), pctDoTotal: totalAtual > 0 ? l.valor / totalAtual : 0 }))
    .sort((a, b) => b.valor - a.valor || b.valor_anterior - a.valor_anterior);
}

/** As três quebras somam o mesmo total (cada despesa cai em exatamente uma linha de cada quebra): a conferência que evita número divergente na tela. */
export function quebrasConciliam(a: AnaliseDespesasRpc): boolean {
  const soma = (xs: ItemAnaliseRpc[], campo: "valor" | "valor_anterior") => r2(xs.reduce((s, x) => s + x[campo], 0));
  return [a.por_classificacao, a.por_contrato, a.por_origem].every((q) => Math.abs(soma(q, "valor") - r2(a.total)) < 0.01 && Math.abs(soma(q, "valor_anterior") - r2(a.total_anterior)) < 0.01);
}
