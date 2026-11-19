import type { AplicacaoFinanceiraLinha, AplicacaoFinanceiraResgateCaixa, AplicacaoHistoricoImportado } from "@/hooks/useAplicacaoFinanceira";
import { deltaDoMovimento, estaAtivo, type ContaGarantida, type MovimentoContaGarantida } from "@/pages/financeiro/conta-garantida/regras";
import { somarDias } from "./projecaoDiaria";

// SIS-2026-0893 (etapa 4) — Empréstimos (Conta Garantida) por instituição e detalhe das Aplicações Financeiras. Funções puras, sobre os dados que as telas
// de Conta Garantida e Aplicações Financeiras já carregam (o saldo devedor aqui é o MESMO delas: resgates − amortizações, estornados de fora).
// Modelo da Conta Garantida: resgate = utilização do limite (entra no banco); amortização = devolução (sai); juros = encargo pago (sai, não mexe no saldo devedor).

const arred = (n: number) => Math.round(n * 100) / 100;
const mesDe = (iso: string) => iso.slice(0, 7);
const noPeriodo = (d: string | null | undefined, ini: string, fim: string) => !!d && d.slice(0, 10) >= ini && d.slice(0, 10) <= fim;

export interface FiltroPeriodo { ini: string; fim: string; empresaId: string }

export type SituacaoVencimento = "vencida" | "vence_30" | "no_prazo" | "sem_vencimento";

export interface LinhaEmprestimo {
  contaId: string;
  instituicao: string;
  conta: string;
  numero: string;
  empresaId: string;
  status: ContaGarantida["status"];
  limite: number;
  /** saldo devedor: resgates − amortizações */
  utilizado: number;
  /** limite − utilizado (nunca negativo) */
  disponivel: number;
  pctUtilizado: number;
  taxa: string | null;
  vencimento: string | null;
  diasParaVencer: number | null;
  situacaoVencimento: SituacaoVencimento;
  utilizacoesNoPeriodo: number;
  amortizacoesNoPeriodo: number;
  jurosNoPeriodo: number;
  /** juros pagos desde o início da conta */
  jurosTotal: number;
}

export interface GrupoInstituicao {
  instituicao: string;
  contas: number;
  limite: number;
  utilizado: number;
  disponivel: number;
  utilizacoesNoPeriodo: number;
  amortizacoesNoPeriodo: number;
  jurosNoPeriodo: number;
  jurosTotal: number;
}

export function situacaoDoVencimento(dias: number | null): SituacaoVencimento {
  if (dias === null) return "sem_vencimento";
  if (dias < 0) return "vencida";
  return dias <= 30 ? "vence_30" : "no_prazo";
}

/** Dias entre a referência e o vencimento (negativo = vencida). */
export function diasAte(vencimento: string | null, referencia: string): number | null {
  if (!vencimento) return null;
  return Math.round((new Date(`${vencimento.slice(0, 10)}T00:00:00Z`).getTime() - new Date(`${referencia}T00:00:00Z`).getTime()) / 86_400_000);
}

export function emprestimosPorInstituicao(
  contas: ContaGarantida[],
  movimentos: MovimentoContaGarantida[],
  nomeBanco: (bancoId: string) => string,
  f: FiltroPeriodo,
  referencia: string,
): { contas: LinhaEmprestimo[]; instituicoes: GrupoInstituicao[] } {
  const doEmpresa = contas.filter((c) => !f.empresaId || c.empresa_id === f.empresaId);
  const linhas: LinhaEmprestimo[] = doEmpresa.map((c) => {
    const ms = movimentos.filter((m) => m.conta_garantida_id === c.id && estaAtivo(m));
    const utilizado = arred(ms.reduce((s, m) => s + deltaDoMovimento(m), 0));
    const noP = (tipo: MovimentoContaGarantida["tipo"]) => arred(ms.filter((m) => m.tipo === tipo && noPeriodo(m.data_movimento, f.ini, f.fim)).reduce((s, m) => s + m.valor, 0));
    const limite = Number(c.limite) || 0;
    const dias = diasAte(c.vencimento, referencia);
    return {
      contaId: c.id, instituicao: nomeBanco(c.banco_id), conta: c.conta, numero: c.numero, empresaId: c.empresa_id, status: c.status,
      limite, utilizado, disponivel: arred(Math.max(0, limite - utilizado)), pctUtilizado: limite > 0 ? utilizado / limite : 0,
      taxa: c.taxa, vencimento: c.vencimento, diasParaVencer: dias, situacaoVencimento: c.status === "ativa" ? situacaoDoVencimento(dias) : "sem_vencimento",
      utilizacoesNoPeriodo: noP("resgate"), amortizacoesNoPeriodo: noP("amortizacao"), jurosNoPeriodo: noP("juros"),
      jurosTotal: arred(ms.filter((m) => m.tipo === "juros").reduce((s, m) => s + m.valor, 0)),
    };
  });
  linhas.sort((a, b) => b.utilizado - a.utilizado || a.instituicao.localeCompare(b.instituicao, "pt-BR"));

  const mapa = new Map<string, GrupoInstituicao>();
  for (const l of linhas.filter((x) => x.status === "ativa")) {
    const g = mapa.get(l.instituicao) ?? { instituicao: l.instituicao, contas: 0, limite: 0, utilizado: 0, disponivel: 0, utilizacoesNoPeriodo: 0, amortizacoesNoPeriodo: 0, jurosNoPeriodo: 0, jurosTotal: 0 };
    g.contas += 1; g.limite = arred(g.limite + l.limite); g.utilizado = arred(g.utilizado + l.utilizado); g.disponivel = arred(g.disponivel + l.disponivel);
    g.utilizacoesNoPeriodo = arred(g.utilizacoesNoPeriodo + l.utilizacoesNoPeriodo); g.amortizacoesNoPeriodo = arred(g.amortizacoesNoPeriodo + l.amortizacoesNoPeriodo);
    g.jurosNoPeriodo = arred(g.jurosNoPeriodo + l.jurosNoPeriodo); g.jurosTotal = arred(g.jurosTotal + l.jurosTotal);
    mapa.set(l.instituicao, g);
  }
  return { contas: linhas, instituicoes: [...mapa.values()].sort((a, b) => b.utilizado - a.utilizado) };
}

/** Totais das contas ATIVAS (o que vale como limite e dívida de hoje). Conta encerrada fica na lista, mas não soma. */
export function totaisEmprestimos(linhas: LinhaEmprestimo[]): { limite: number; utilizado: number; disponivel: number; jurosNoPeriodo: number; amortizacoesNoPeriodo: number; utilizacoesNoPeriodo: number } {
  const ativas = linhas.filter((l) => l.status === "ativa");
  const soma = (campo: "limite" | "utilizado" | "disponivel" | "jurosNoPeriodo" | "amortizacoesNoPeriodo" | "utilizacoesNoPeriodo") => arred(ativas.reduce((s, l) => s + l[campo], 0));
  return { limite: soma("limite"), utilizado: soma("utilizado"), disponivel: soma("disponivel"), jurosNoPeriodo: soma("jurosNoPeriodo"), amortizacoesNoPeriodo: soma("amortizacoesNoPeriodo"), utilizacoesNoPeriodo: soma("utilizacoesNoPeriodo") };
}

// ── Aplicações ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LinhaAplicacao {
  id: string;
  numero: string;
  instituicao: string;
  produto: string;
  descricao: string;
  empresaId: string;
  dataAplicacao: string;
  valorAplicado: number;
  rendimentoAcumulado: number;
  resgatadoPrincipal: number;
  resgatadoRendimento: number;
  saldoAtual: number;
  vencimento: string | null;
  diasParaVencer: number | null;
  /** texto livre do cadastro: a liquidez estruturada (carência, D+N) é da etapa 2 */
  liquidez: string | null;
  status: AplicacaoFinanceiraLinha["status"];
}

export interface GrupoAplicacao { instituicao: string; aplicacoes: number; valorAplicado: number; rendimento: number; resgatado: number; saldoAtual: number }

export function detalheAplicacoes(linhas: AplicacaoFinanceiraLinha[], f: FiltroPeriodo, referencia: string): { linhas: LinhaAplicacao[]; instituicoes: GrupoAplicacao[] } {
  const doEmpresa = linhas.filter((l) => !f.empresaId || l.empresa_id === f.empresaId);
  const detalhe: LinhaAplicacao[] = doEmpresa.map((l) => ({
    id: l.id, numero: l.numero, instituicao: l.banco_nome ?? "—", produto: l.produto, descricao: l.descricao, empresaId: l.empresa_id, dataAplicacao: l.data_aplicacao,
    valorAplicado: arred(Number(l.valor_aplicado) || 0), rendimentoAcumulado: arred(Number(l.rendimento_acumulado) || 0),
    resgatadoPrincipal: arred(Number(l.total_principal_resgatado) || 0), resgatadoRendimento: arred(Number(l.total_rendimento_resgatado) || 0),
    saldoAtual: arred(Number(l.saldo_atual) || 0), vencimento: l.data_vencimento, diasParaVencer: diasAte(l.data_vencimento, referencia), liquidez: l.liquidez, status: l.status,
  }));
  detalhe.sort((a, b) => b.saldoAtual - a.saldoAtual);

  const mapa = new Map<string, GrupoAplicacao>();
  for (const l of detalhe) {
    const g = mapa.get(l.instituicao) ?? { instituicao: l.instituicao, aplicacoes: 0, valorAplicado: 0, rendimento: 0, resgatado: 0, saldoAtual: 0 };
    g.aplicacoes += 1; g.valorAplicado = arred(g.valorAplicado + l.valorAplicado); g.rendimento = arred(g.rendimento + l.rendimentoAcumulado);
    g.resgatado = arred(g.resgatado + l.resgatadoPrincipal + l.resgatadoRendimento); g.saldoAtual = arred(g.saldoAtual + l.saldoAtual);
    mapa.set(l.instituicao, g);
  }
  return { linhas: detalhe, instituicoes: [...mapa.values()].sort((a, b) => b.saldoAtual - a.saldoAtual) };
}

// ── Fluxo por natureza, mês a mês ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PontoNatureza {
  mes: string;
  /** operacional: o que entrou das notas (data de pagamento) e as despesas pagas — sem empréstimo nem aplicação */
  recebimentosOperacionais: number;
  despesasOperacionais: number;
  resultadoOperacional: number;
  /** empréstimos (Conta Garantida) */
  emprestimoUtilizado: number;
  emprestimoAmortizado: number;
  jurosPagos: number;
  saldoDevedorFim: number;
  /** aplicações financeiras */
  aplicado: number;
  resgatadoAplicacoes: number;
  rendimentos: number;
}

/**
 * Separa, mês a mês, o fluxo OPERACIONAL do dos EMPRÉSTIMOS e do das APLICAÇÕES, para que um empréstimo nunca pareça receita nem uma aplicação pareça despesa.
 * `recebidoPorMes` e `despesasPorMes` já vêm do recorte da tela (empresa/contrato); empréstimos e aplicações seguem só a empresa.
 */
export function fluxoPorNatureza(p: {
  meses: string[];
  recebidoPorMes: Map<string, number>;
  despesasPorMes: Map<string, number>;
  contas: ContaGarantida[];
  movimentos: MovimentoContaGarantida[];
  aplicacoes: AplicacaoFinanceiraLinha[];
  resgates: AplicacaoFinanceiraResgateCaixa[];
  historico: AplicacaoHistoricoImportado[];
  empresaId: string;
}): PontoNatureza[] {
  const ids = new Set(p.contas.filter((c) => !p.empresaId || c.empresa_id === p.empresaId).map((c) => c.id));
  const ms = p.movimentos.filter((m) => estaAtivo(m) && ids.has(m.conta_garantida_id));
  const doEmpresa = <T extends { empresa_id: string }>(x: T) => !p.empresaId || x.empresa_id === p.empresaId;
  const ls = p.aplicacoes.filter(doEmpresa);
  const rs = p.resgates.filter(doEmpresa);
  const hs = p.historico.filter(doEmpresa);
  const somaMes = <T,>(xs: T[], mes: string, data: (x: T) => string, valor: (x: T) => number) => arred(xs.filter((x) => mesDe(data(x)) === mes).reduce((s, x) => s + valor(x), 0));
  const ultimoDia = (mes: string) => somarDias(`${mes}-01`, new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate() - 1);

  return p.meses.map((mes) => {
    const recebimentos = arred(p.recebidoPorMes.get(mes) ?? 0);
    const despesas = arred(p.despesasPorMes.get(mes) ?? 0);
    const fim = ultimoDia(mes);
    const hist = (mov: string) => hs.filter((h) => h.movimento === mov && mesDe(h.data_pagamento) === mes).reduce((s, h) => s + h.valor, 0);
    return {
      mes, recebimentosOperacionais: recebimentos, despesasOperacionais: despesas, resultadoOperacional: arred(recebimentos - despesas),
      emprestimoUtilizado: somaMes(ms.filter((m) => m.tipo === "resgate"), mes, (m) => m.data_movimento, (m) => m.valor),
      emprestimoAmortizado: somaMes(ms.filter((m) => m.tipo === "amortizacao"), mes, (m) => m.data_movimento, (m) => m.valor),
      jurosPagos: somaMes(ms.filter((m) => m.tipo === "juros"), mes, (m) => m.data_movimento, (m) => m.valor),
      saldoDevedorFim: arred(ms.filter((m) => m.data_movimento.slice(0, 10) <= fim).reduce((s, m) => s + deltaDoMovimento(m), 0)),
      aplicado: arred(somaMes(ls, mes, (l) => l.data_aplicacao, (l) => Number(l.valor_aplicado) || 0) + hist("aplicacao")),
      resgatadoAplicacoes: arred(somaMes(rs, mes, (r) => r.data_resgate, (r) => Number(r.valor_principal) || 0) + hist("resgate")),
      rendimentos: arred(somaMes(rs, mes, (r) => r.data_resgate, (r) => Number(r.valor_rendimento) || 0) + hist("rendimento")),
    };
  });
}
