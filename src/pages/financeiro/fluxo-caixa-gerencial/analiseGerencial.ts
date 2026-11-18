import type { PontoNatureza } from "./emprestimosAplicacoes";

// SIS-2026-XXXX (etapa 4) — Análises gerenciais mês a mês. Funções puras sobre a série por natureza (operacional × empréstimos × aplicações).
// Definições (para quem for mexer, e para o infobox da tela):
//   · Resultado do mês           = recebimentos operacionais − despesas pagas (empréstimo e aplicação ficam de fora).
//   · Necessidade de capital de giro do mês = déficit operacional = max(0, despesas − recebimentos).
//   · Utilização de capital de giro = utilização LÍQUIDA da Conta Garantida no mês = max(0, utilizado − amortizado).
//   · Cobertura das despesas     = recebimentos ÷ despesas (nulo quando não houve despesa).
//   · Dependência de recursos bancários = utilização líquida de crédito ÷ despesas (quanto das despesas do mês foi financiado por banco).

const arred = (n: number) => Math.round(n * 100) / 100;
const razao = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export interface PontoAnalise {
  mes: string;
  faturamentoLiquido: number;
  recebimentos: number;
  despesas: number;
  resultado: number;
  necessidadeCapitalGiro: number;
  utilizacaoCapitalGiro: number;
  saldoDevedorFim: number;
  cobertura: number | null;
  dependenciaBancaria: number | null;
  /** variação sobre o mês anterior; null no primeiro mês ou quando o anterior foi zero */
  variacaoFaturamentoPct: number | null;
  variacaoRecebimentosPct: number | null;
  variacaoDespesasPct: number | null;
}

const variacaoPct = (atual: number, anterior: number | undefined): number | null => (anterior === undefined || anterior <= 0 ? null : (atual - anterior) / anterior);

export function analiseMensal(natureza: PontoNatureza[], faturamentoLiquidoPorMes: Map<string, number>): PontoAnalise[] {
  return natureza.map((p, i) => {
    const ant = natureza[i - 1];
    const fat = arred(faturamentoLiquidoPorMes.get(p.mes) ?? 0);
    const fatAnt = ant ? arred(faturamentoLiquidoPorMes.get(ant.mes) ?? 0) : undefined;
    const utilizacaoLiquida = arred(Math.max(0, p.emprestimoUtilizado - p.emprestimoAmortizado));
    return {
      mes: p.mes, faturamentoLiquido: fat, recebimentos: p.recebimentosOperacionais, despesas: p.despesasOperacionais, resultado: p.resultadoOperacional,
      necessidadeCapitalGiro: arred(Math.max(0, p.despesasOperacionais - p.recebimentosOperacionais)), utilizacaoCapitalGiro: utilizacaoLiquida, saldoDevedorFim: p.saldoDevedorFim,
      cobertura: razao(p.recebimentosOperacionais, p.despesasOperacionais), dependenciaBancaria: razao(utilizacaoLiquida, p.despesasOperacionais),
      variacaoFaturamentoPct: variacaoPct(fat, fatAnt), variacaoRecebimentosPct: variacaoPct(p.recebimentosOperacionais, ant?.recebimentosOperacionais), variacaoDespesasPct: variacaoPct(p.despesasOperacionais, ant?.despesasOperacionais),
    };
  });
}

export interface PeriodoInsuficiencia {
  mes: string;
  /** quanto as despesas passaram dos recebimentos no mês */
  deficit: number;
  cobertura: number | null;
  /** parte do déficit coberta por utilização líquida de crédito (0..1; pode passar de 1 se tomou mais do que faltou) */
  financiadoPorCredito: number | null;
}

/** Os meses de maior insuficiência de caixa operacional (despesas acima dos recebimentos), do pior para o menos pior. */
export function periodosDeInsuficiencia(pontos: PontoAnalise[], limite = 3): PeriodoInsuficiencia[] {
  return pontos
    .filter((p) => p.necessidadeCapitalGiro > 0.005)
    .map((p) => ({ mes: p.mes, deficit: p.necessidadeCapitalGiro, cobertura: p.cobertura, financiadoPorCredito: razao(p.utilizacaoCapitalGiro, p.necessidadeCapitalGiro) }))
    .sort((a, b) => b.deficit - a.deficit)
    .slice(0, limite);
}

export interface ResumoGerencial {
  /** cobertura do período inteiro: Σ recebimentos ÷ Σ despesas */
  coberturaPeriodo: number | null;
  /** dependência do período inteiro: Σ utilização líquida de crédito ÷ Σ despesas */
  dependenciaPeriodo: number | null;
  mesesComDeficit: number;
  maiorDeficit: number;
  mesDoMaiorDeficit: string | null;
  saldoDevedorFim: number;
  /** variação do saldo devedor entre o primeiro e o último mês da série (positivo = endividamento crescendo) */
  variacaoSaldoDevedor: number;
}

export function resumoGerencial(pontos: PontoAnalise[]): ResumoGerencial {
  const soma = (f: (p: PontoAnalise) => number) => pontos.reduce((s, p) => s + f(p), 0);
  const insuf = periodosDeInsuficiencia(pontos, 1)[0];
  const primeiro = pontos[0];
  const ultimo = pontos[pontos.length - 1];
  return {
    coberturaPeriodo: razao(soma((p) => p.recebimentos), soma((p) => p.despesas)),
    dependenciaPeriodo: razao(soma((p) => p.utilizacaoCapitalGiro), soma((p) => p.despesas)),
    mesesComDeficit: pontos.filter((p) => p.necessidadeCapitalGiro > 0.005).length,
    maiorDeficit: insuf?.deficit ?? 0,
    mesDoMaiorDeficit: insuf?.mes ?? null,
    saldoDevedorFim: ultimo?.saldoDevedorFim ?? 0,
    variacaoSaldoDevedor: primeiro && ultimo ? arred(ultimo.saldoDevedorFim - primeiro.saldoDevedorFim) : 0,
  };
}
