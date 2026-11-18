import type { NfEmissaoItemRow, NfEmissaoRow } from "@/hooks/useNfEmissao";
import type { AplicacaoFinanceiraLinha, AplicacaoFinanceiraResgateCaixa, AplicacaoHistoricoImportado } from "@/hooks/useAplicacaoFinanceira";
import { foraDoRelatorio, naoContabilizaKpi, valorPendenteNf } from "@/pages/financeiro/nf-emissao/shared";
import type { AnaliseDespesasRpc, TipoDataDespesa } from "./analiseDespesas";
import { kpisDoDashboard } from "@/pages/financeiro/relatorio-servicos/kpisDashboard";
import { kpisAplicacoes } from "@/pages/financeiro/aplicacao-financeira/kpis";
import { saldoPorConta, estaAtivo, type ContaGarantida, type MovimentoContaGarantida } from "@/pages/financeiro/conta-garantida/regras";

// SIS-2026-0871 — Fluxo de Caixa Gerencial (pedido do Ruan, Financeiro). Regras puras (sem React nem banco) para serem testadas: a tela lê os
// dados, chama estas funções e desenha. De onde vem cada número:
//   · notas (bruto, líquido, recebido, pendente) → Relatório de Serviços (mesma função do Dashboard, kpisDoDashboard);
//   · despesas pagas, malote, composição, projeção → RPC financeiro_fluxo_gerencial (Fluxo de Caixa, no servidor);
//   · empréstimos → Conta Garantida (limite contratado; saldo devedor = resgates − amortizações);
//   · aplicações → Aplicações Financeiras (mesma função da tela, kpisAplicacoes).

/** SIS-2026-0893 (etapa 1): data que define QUAIS notas entram no faturamento (bruto, líquido, pendente). O recebimento é SEMPRE pela data de pagamento. */
export type TipoDataGerencial = "emissao" | "competencia" | "vencimento";

export interface FiltroGerencial {
  ini: string; // YYYY-MM-DD
  fim: string;
  /** padrão: emissão */
  tipoData?: TipoDataGerencial;
  /** SIS-2026-0893: data que enquadra as DESPESAS nos indicadores do topo; padrão: pagamento */
  tipoDataDespesa?: TipoDataDespesa;
  /** etapa 3: vencimento calculado da nota (ajuste manual › prazo do contrato › emissão + 30); usado quando tipoData = "vencimento" */
  resolverVencimento?: (n: NfEmissaoRow) => string | null;
  empresaId: string; // "" = todas
  contratoId: string; // "" = todos
}

const arred = (n: number) => Math.round(n * 100) / 100;
const noPeriodo = (data: string | null | undefined, ini: string, fim: string) => !!data && data.slice(0, 10) >= ini && data.slice(0, 10) <= fim;
const mesDe = (data: string) => data.slice(0, 7);

// ── Período ────────────────────────────────────────────────────────────────
export function periodoDoMes(hoje: Date = new Date()): { ini: string; fim: string } {
  const p = (n: number) => String(n).padStart(2, "0");
  const y = hoje.getFullYear();
  const m = hoje.getMonth() + 1;
  const ultimo = new Date(y, m, 0).getDate();
  return { ini: `${y}-${p(m)}-01`, fim: `${y}-${p(m)}-${p(ultimo)}` };
}

/** Quantos meses (inteiros, no mínimo 1) o período abrange — base do "custo operacional mensal". */
export function mesesDoPeriodo(ini: string, fim: string): number {
  const [yi, mi] = ini.split("-").map(Number);
  const [yf, mf] = fim.split("-").map(Number);
  return Math.max(1, (yf - yi) * 12 + (mf - mi) + 1);
}

/** Os 12 meses (YYYY-MM) que terminam no mês de `fim`, do mais antigo ao mais recente. Mesma janela da RPC (por_mes). */
export function ultimos12Meses(fim: string): string[] {
  const [y, m] = fim.split("-").map(Number);
  const meses: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return meses;
}

// ── Notas (Relatório de Serviços) ──────────────────────────────────────────
/** Notas do relatório, no período (data de emissão) e nos filtros. Nota Cancelada/Substituída sem pagamento fica fora, como no relatório. */
export function notasDoPeriodo(nfs: NfEmissaoRow[], f: FiltroGerencial): NfEmissaoRow[] {
  return nfs.filter((n) => {
    if (foraDoRelatorio(n)) return false;
    if (f.empresaId && n.empresa_id !== f.empresaId) return false;
    if (f.contratoId && n.contrato_id !== f.contratoId) return false;
    return noPeriodo(dataDoFaturamento(n, f), f.ini, f.fim);
  });
}

/** Data usada para enquadrar a nota no faturamento: emissão (padrão) ou competência. */
export function dataDoFaturamento(n: NfEmissaoRow, f: Pick<FiltroGerencial, "tipoData" | "resolverVencimento">): string | null {
  if (f.tipoData === "vencimento") return f.resolverVencimento ? f.resolverVencimento(n) : null;
  return f.tipoData === "competencia" ? n.competencia : n.data_emissao;
}

/**
 * Notas que RECEBERAM dinheiro no período: data de pagamento dentro do período e valor pago > 0, qualquer que seja a emissão ou a competência.
 * (Hipótese do Ruan para o "recebido zerado": o KPI só somava o pago das notas EMITIDAS no período, e no mês corrente elas ainda não foram pagas.)
 * Nota cancelada/substituída não conta, como no Dashboard do Relatório de Serviços.
 */
export function notasRecebidasNoPeriodo(nfs: NfEmissaoRow[], f: FiltroGerencial): NfEmissaoRow[] {
  return nfs.filter((n) => {
    if (foraDoRelatorio(n) || naoContabilizaKpi(n)) return false;
    if (f.empresaId && n.empresa_id !== f.empresaId) return false;
    if (f.contratoId && n.contrato_id !== f.contratoId) return false;
    return Number(n.valor_pago) > 0 && noPeriodo(n.data_pagamento, f.ini, f.fim);
  });
}

export interface KpisNotas {
  qtd: number;
  bruto: number;
  liquido: number;
  recebido: number;
  pendente: number;
  pctRecebidoDoLiquido: number; // 0..1
  pctPendenteDoLiquido: number;
}

export function kpisNotas(notas: NfEmissaoRow[], itensPorNf: Map<string, NfEmissaoItemRow[]> | undefined, recebidasNoPeriodo?: NfEmissaoRow[]): KpisNotas {
  const k = kpisDoDashboard(notas, itensPorNf);
  // SIS-2026-0893: com `recebidasNoPeriodo` o recebido é o que ENTROU no período (data de pagamento); sem ele, vale o pago das notas do recorte (comportamento antigo).
  if (recebidasNoPeriodo) k.recebido = recebidasNoPeriodo.reduce((s, n) => s + (Number(n.valor_pago) || 0), 0);
  // líquido: mesma exclusão do Dashboard (Cancelada/Substituída não contam)
  const liquido = arred(notas.filter((n) => !naoContabilizaKpi(n)).reduce((s, n) => s + (Number(n.vlr_liquido_total) || 0), 0));
  return {
    qtd: notas.filter((n) => !naoContabilizaKpi(n)).length,
    bruto: arred(k.faturado),
    liquido,
    recebido: arred(k.recebido),
    pendente: arred(k.pendente),
    pctRecebidoDoLiquido: liquido ? k.recebido / liquido : 0,
    pctPendenteDoLiquido: liquido ? k.pendente / liquido : 0,
  };
}

// ── Detalhamento dos indicadores (SIS-2026-0893) ───────────────────────────
export interface LinhaDetalheNota {
  id: string;
  numero: string;
  empresaId: string;
  contratoId: string;
  competencia: string;
  emissao: string | null;
  pagamento: string | null;
  bruto: number;
  liquido: number;
  pago: number;
  pendente: number;
}

/** Uma linha por nota (sem cancelada/substituída) com os valores que compõem Bruto, Líquido, Recebido e Pendente. Somando a coluna dá o KPI. */
export function linhasDetalheNotas(notas: NfEmissaoRow[], itensPorNf: Map<string, NfEmissaoItemRow[]> | undefined): LinhaDetalheNota[] {
  return notas
    .filter((n) => !naoContabilizaKpi(n))
    .map((n) => ({
      id: n.id, numero: n.numero_nf ?? "—", empresaId: n.empresa_id, contratoId: n.contrato_id, competencia: n.competencia, emissao: n.data_emissao, pagamento: n.data_pagamento,
      bruto: arred(Number(n.vlr_bruto_total) || 0), liquido: arred(Number(n.vlr_liquido_total) || 0), pago: arred(Number(n.valor_pago) || 0),
      pendente: arred(valorPendenteNf(n, itensPorNf?.get(n.id) ?? [])),
    }))
    .sort((a, b) => (b.emissao ?? "").localeCompare(a.emissao ?? "") || a.numero.localeCompare(b.numero, "pt-BR", { numeric: true }));
}

export interface ConciliacaoMalote {
  malote: number;
  /** despesas pagas que NÃO vieram do Malote (Débito Automático, fatura de cartão, planilha importada...) */
  demais: number;
  pctMalote: number; // 0..1
  /** o Malote já está DENTRO das despesas pagas: nunca pode passar do total (senão haveria duplicidade) */
  ok: boolean;
}

/** Conciliação das despesas do Malote com o total de despesas pagas: Total = Malote + demais origens; Malote maior que o total indica duplicidade. */
export function conciliacaoMalote(despesasPagas: number, malotePago: number): ConciliacaoMalote {
  const ok = malotePago <= despesasPagas + 0.005;
  return { malote: arred(malotePago), demais: arred(Math.max(despesasPagas - malotePago, 0)), pctMalote: despesasPagas > 0 ? malotePago / despesasPagas : 0, ok };
}

export interface PontoMensal { mes: string; bruto: number; liquido: number; recebido: number }

/** Série dos 12 meses: bruto/líquido por mês de emissão e recebido por mês de pagamento. Respeita Empresa/Contrato, mas não o período. */
export function serieNotas(nfs: NfEmissaoRow[], f: FiltroGerencial): PontoMensal[] {
  const meses = ultimos12Meses(f.fim);
  const mapa = new Map<string, PontoMensal>(meses.map((m) => [m, { mes: m, bruto: 0, liquido: 0, recebido: 0 }]));
  for (const n of nfs) {
    if (foraDoRelatorio(n) || naoContabilizaKpi(n)) continue;
    if (f.empresaId && n.empresa_id !== f.empresaId) continue;
    if (f.contratoId && n.contrato_id !== f.contratoId) continue;
    const dataFat = dataDoFaturamento(n, f);
    if (dataFat) {
      const p = mapa.get(mesDe(dataFat));
      if (p) { p.bruto += Number(n.vlr_bruto_total) || 0; p.liquido += Number(n.vlr_liquido_total) || 0; }
    }
    if (n.data_pagamento && Number(n.valor_pago) > 0) {
      const p = mapa.get(mesDe(n.data_pagamento));
      if (p) p.recebido += Number(n.valor_pago) || 0;
    }
  }
  return meses.map((m) => { const p = mapa.get(m)!; return { mes: m, bruto: arred(p.bruto), liquido: arred(p.liquido), recebido: arred(p.recebido) }; });
}

// ── Conta Garantida (empréstimos) ──────────────────────────────────────────
export interface KpisEmprestimos { contratado: number; saldoDevedor: number }

/** Contratado = limite das contas ativas; saldo devedor = resgates − amortizações (estornados ficam de fora), como na tela da Conta Garantida. */
export function kpisEmprestimos(contas: ContaGarantida[], movimentos: MovimentoContaGarantida[], empresaId: string): KpisEmprestimos {
  const ativas = contas.filter((c) => c.status === "ativa" && (!empresaId || c.empresa_id === empresaId));
  const ids = new Set(ativas.map((c) => c.id));
  const saldos = saldoPorConta(movimentos.filter((m) => ids.has(m.conta_garantida_id)));
  return {
    contratado: arred(ativas.reduce((s, c) => s + (Number(c.limite) || 0), 0)),
    saldoDevedor: arred([...saldos.values()].reduce((s, v) => s + v, 0)),
  };
}

/** Utilização do limite (resgates) por mês: entra no caixa como empréstimo no gráfico de entradas × saídas. */
export function emprestimosPorMes(contas: ContaGarantida[], movimentos: MovimentoContaGarantida[], empresaId: string, fim: string): Map<string, number> {
  const ids = new Set(contas.filter((c) => !empresaId || c.empresa_id === empresaId).map((c) => c.id));
  const meses = new Set(ultimos12Meses(fim));
  const mapa = new Map<string, number>();
  for (const m of movimentos) {
    if (!estaAtivo(m) || m.tipo !== "resgate" || !ids.has(m.conta_garantida_id)) continue;
    const mes = mesDe(m.data_movimento);
    if (meses.has(mes)) mapa.set(mes, arred((mapa.get(mes) ?? 0) + m.valor));
  }
  return mapa;
}

// ── Aplicações financeiras ─────────────────────────────────────────────────
export interface KpisAplicacoesGerencial {
  saldoAtual: number;
  rendimentoNoPeriodo: number;
  aplicadoNoPeriodo: number;
  resgatadoNoPeriodo: number;
}

export function kpisAplicacoesGerencial(
  linhas: AplicacaoFinanceiraLinha[], resgates: AplicacaoFinanceiraResgateCaixa[], historico: AplicacaoHistoricoImportado[], f: FiltroGerencial,
): KpisAplicacoesGerencial {
  const doEmpresa = <T extends { empresa_id: string }>(l: T) => !f.empresaId || l.empresa_id === f.empresaId;
  const ls = linhas.filter(doEmpresa);
  const rs = resgates.filter(doEmpresa);
  const hs = historico.filter(doEmpresa);
  const k = kpisAplicacoes(ls, rs, hs);
  const histNoPeriodo = (mov: string) => hs.filter((h) => h.movimento === mov && noPeriodo(h.data_pagamento, f.ini, f.fim)).reduce((s, h) => s + h.valor, 0);
  const resgNoPeriodo = rs.filter((r) => noPeriodo(r.data_resgate, f.ini, f.fim));
  return {
    saldoAtual: arred(k.totalAplicado + k.rendimentoAcumulado),
    aplicadoNoPeriodo: arred(ls.filter((l) => noPeriodo(l.data_aplicacao, f.ini, f.fim)).reduce((s, l) => s + Number(l.valor_aplicado), 0) + histNoPeriodo("aplicacao")),
    resgatadoNoPeriodo: arred(resgNoPeriodo.reduce((s, r) => s + Number(r.valor_principal), 0) + histNoPeriodo("resgate")),
    rendimentoNoPeriodo: arred(resgNoPeriodo.reduce((s, r) => s + Number(r.valor_rendimento), 0) + histNoPeriodo("rendimento")),
  };
}

// ── Fluxo (RPC) ────────────────────────────────────────────────────────────
export interface FluxoGerencialRpc {
  despesas_pagas: number;
  qtd_despesas: number;
  malote_pago: number;
  por_mes: { mes: string; despesas: number }[];
  composicao: { nome: string; valor: number }[];
  projecao: Record<"d30" | "d60" | "d90", { recebimentos: number; pagamentos: number }>;
}

/**
 * Indicadores de despesas pela data escolhida. Por pagamento valem os totais da função original; por COMPETÊNCIA, os da função de análise das despesas
 * (mesma regra de "despesa", só muda a data de enquadramento). A projeção 30/60/90 dias é sempre a da função original: não depende dessa escolha.
 */
export function fluxoPorTipoData(original: FluxoGerencialRpc, analise: AnaliseDespesasRpc | undefined, tipo: TipoDataDespesa): FluxoGerencialRpc {
  if (tipo !== "competencia" || !analise) return original;
  return {
    ...original,
    despesas_pagas: analise.total,
    qtd_despesas: analise.qtd,
    malote_pago: analise.por_origem.filter((o) => o.nome === "Malote").reduce((s, o) => s + o.valor, 0),
    composicao: analise.por_classificacao.filter((c) => c.valor > 0).map((c) => ({ nome: c.nome, valor: c.valor })),
    por_mes: analise.por_mes,
  };
}

export const FLUXO_VAZIO: FluxoGerencialRpc = {
  despesas_pagas: 0, qtd_despesas: 0, malote_pago: 0, por_mes: [], composicao: [],
  projecao: { d30: { recebimentos: 0, pagamentos: 0 }, d60: { recebimentos: 0, pagamentos: 0 }, d90: { recebimentos: 0, pagamentos: 0 } },
};

/** Normaliza o jsonb (números chegam como número ou texto) para o formato da tela. */
export function normalizarFluxo(r: unknown): FluxoGerencialRpc {
  const o = (r ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const n = (v: unknown) => Number(v ?? 0) || 0;
  const proj = (k: string) => ({ recebimentos: n(o.projecao?.[k]?.recebimentos), pagamentos: n(o.projecao?.[k]?.pagamentos) });
  return {
    despesas_pagas: n(o.despesas_pagas),
    qtd_despesas: n(o.qtd_despesas),
    malote_pago: n(o.malote_pago),
    por_mes: ((o.por_mes ?? []) as { mes: string; despesas: unknown }[]).map((p) => ({ mes: p.mes, despesas: n(p.despesas) })),
    composicao: ((o.composicao ?? []) as { nome: string; valor: unknown }[]).map((p) => ({ nome: p.nome, valor: n(p.valor) })),
    projecao: { d30: proj("d30"), d60: proj("d60"), d90: proj("d90") },
  };
}

/** Maiores classificações (até `max`) e o restante agrupado em "Outras". */
export function composicaoTop(composicao: { nome: string; valor: number }[], max = 5): { nome: string; valor: number; pct: number }[] {
  const total = composicao.reduce((s, c) => s + c.valor, 0);
  if (total <= 0) return [];
  const ordenada = [...composicao].filter((c) => c.valor > 0).sort((a, b) => b.valor - a.valor);
  const topo = ordenada.slice(0, max);
  const resto = ordenada.slice(max).reduce((s, c) => s + c.valor, 0);
  const itens = resto > 0 ? [...topo, { nome: "Outras", valor: resto }] : topo;
  return itens.map((c) => ({ ...c, valor: arred(c.valor), pct: c.valor / total }));
}

export interface PontoEntradasSaidas { mes: string; entradas: number; saidas: number }

/** Entradas = recebimentos das notas + empréstimos (utilização da Conta Garantida); saídas = despesas pagas. */
export function serieEntradasSaidas(notas: PontoMensal[], emprestimos: Map<string, number>, despesas: { mes: string; despesas: number }[]): PontoEntradasSaidas[] {
  const saidas = new Map(despesas.map((d) => [d.mes, d.despesas]));
  return notas.map((p) => ({ mes: p.mes, entradas: arred(p.recebido + (emprestimos.get(p.mes) ?? 0)), saidas: arred(saidas.get(p.mes) ?? 0) }));
}

// ── Indicadores e necessidade de caixa ─────────────────────────────────────
export interface Indicadores {
  conversaoCaixa: number; // recebido / bruto emitido
  coberturaDespesas: number; // recebido / despesas pagas
  dependenciaEmprestimos: number; // saldo devedor / despesas pagas
}

const razao = (a: number, b: number) => (b > 0 ? a / b : 0);

export function indicadores(notas: KpisNotas, despesasPagas: number, emprestimos: KpisEmprestimos): Indicadores {
  return {
    conversaoCaixa: razao(notas.recebido, notas.bruto),
    coberturaDespesas: razao(notas.recebido, despesasPagas),
    dependenciaEmprestimos: razao(emprestimos.saldoDevedor, despesasPagas),
  };
}

export interface NecessidadeCaixa { custoMensal: number; recebimentosPrevistos: number; necessidade: number }

/**
 * Custo operacional mensal = despesas pagas do período (o Malote já está dentro delas; não se soma de novo) ÷ meses do período.
 * Necessidade = custo mensal − recebimentos previstos dos próximos 30 dias. Positivo = falta caixa; negativo = sobra.
 */
export function necessidadeDeCaixa(despesasPagas: number, ini: string, fim: string, recebimentosPrevistos30d: number): NecessidadeCaixa {
  const custoMensal = arred(despesasPagas / mesesDoPeriodo(ini, fim));
  return { custoMensal, recebimentosPrevistos: arred(recebimentosPrevistos30d), necessidade: arred(custoMensal - recebimentosPrevistos30d) };
}

export function saldoProjetado(p: { recebimentos: number; pagamentos: number }): number {
  return arred(p.recebimentos - p.pagamentos);
}
