import { reconciliar, transacoesNoPeriodo, type OFXTransaction, type ReconciliacaoResult } from "@/lib/conciliacaoBancariaEngine";
import { ehSaldoAnterior, linhasSaldoAnterior } from "@/lib/conciliacaoSaldoAnterior";
import { resumirConciliacao, type ResumoConciliacao } from "@/lib/conciliacaoResumo";
import { linhasFluxoParaPlanilhaRow } from "@/hooks/useConciliacaoFluxoCaixa";
import type { FluxoCaixaMaloteLinha } from "@/hooks/useFluxoCaixaMalote";

// Cálculo da Conciliação Bancária (Fluxo de Caixa × extrato OFX), separado da tela para a MESMA conta servir à conciliação nova e ao resumo
// das conciliações antigas (que refaz o cálculo com o .OFX guardado). Qualquer ajuste de regra vale para os dois.

export interface EscopoConciliacao {
  bancoId: string;
  todasEmpresas: boolean;
  empresaIds: string[];
  dataDe: string;
  dataAte: string;
}

/** Lançamentos do Fluxo do período que são do banco (e das empresas escolhidas) — o lado "Fluxo" da conciliação. */
export function linhasDoFluxoParaConciliacao(linhasBrutas: FluxoCaixaMaloteLinha[], e: EscopoConciliacao): FluxoCaixaMaloteLinha[] {
  return linhasBrutas.filter((l) => {
    if (!l.data_pagamento) return false;
    if (e.dataDe && l.data_pagamento < e.dataDe) return false;
    if (e.dataAte && l.data_pagamento > e.dataAte) return false;
    return l.banco_id === e.bancoId && (e.todasEmpresas || (!!l.empresa_id && e.empresaIds.includes(l.empresa_id)));
  });
}

export interface ProcessamentoConciliacao {
  resultado: ReconciliacaoResult;
  resumo: ResumoConciliacao;
  totaisExtrato: { entradas: number; saidas: number };
  /** transações do OFX fora do período (desconsideradas) */
  fora: number;
}

export function processarConciliacao(args: {
  linhasDoBancoEmpresa: FluxoCaixaMaloteLinha[];
  trns: OFXTransaction[];
  dataDe: string;
  dataAte: string;
  saldoExtrato: number | null;
  bancoNome: string;
}): ProcessamentoConciliacao {
  const { linhasDoBancoEmpresa, trns, dataDe, dataAte, saldoExtrato, bancoNome } = args;
  // "SALDO ANTERIOR" é o saldo de abertura (não movimento): fica fora da comparação normal e, se o saldo do extrato foi informado, entra como
  // uma linha dos dois lados (ver lib/conciliacaoSaldoAnterior.ts).
  const saldoLinhas = linhasSaldoAnterior(linhasDoBancoEmpresa.filter(ehSaldoAnterior), saldoExtrato, dataDe, bancoNome);
  const linhasPeriodoBanco = linhasDoBancoEmpresa.filter((l) => !ehSaldoAnterior(l));
  const planRows = [...linhasFluxoParaPlanilhaRow(linhasPeriodoBanco), ...saldoLinhas.plan];
  // SIS-2026-0637: só entra do extrato o que está no período escolhido (igual ao lado Fluxo).
  const { dentro, fora } = transacoesNoPeriodo(trns, dataDe, dataAte);
  const ofxRows = [...dentro, ...saldoLinhas.ofx];
  const resultado = reconciliar(planRows, ofxRows);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    resultado,
    resumo: resumirConciliacao(planRows, ofxRows, resultado),
    totaisExtrato: {
      entradas: r2(dentro.filter((t) => t.tipo === "ENTRADA").reduce((s, t) => s + t.valor, 0)),
      saidas: r2(dentro.filter((t) => t.tipo === "SAÍDA").reduce((s, t) => s + t.valor, 0)),
    },
    fora,
  };
}
