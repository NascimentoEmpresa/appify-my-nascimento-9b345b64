import { reconciliar, transacoesNoPeriodo, type OFXTransaction, type ReconciliacaoResult } from "@/lib/conciliacaoBancariaEngine";
import { ehSaldoAnterior, linhasSaldoAnterior } from "@/lib/conciliacaoSaldoAnterior";
import { resumirConciliacao, type ResumoConciliacao } from "@/lib/conciliacaoResumo";
import { linhasFluxoParaPlanilhaRow } from "@/hooks/useConciliacaoFluxoCaixa";
import type { FluxoCaixaMaloteLinha } from "@/hooks/useFluxoCaixaMalote";

// Cálculo da Conciliação Bancária (Fluxo de Caixa × extrato OFX), separado da tela para a MESMA conta servir à conciliação nova e ao resumo
// das conciliações antigas (que refaz o cálculo com o .OFX guardado). Qualquer ajuste de regra vale para os dois.

/** "2026-10" → { de: "2026-10-01", ate: "2026-10-31" } (último dia do mês, inclusive fevereiro e ano bissexto). null se o mês for inválido. */
export function periodoDoMes(anoMes: string): { de: string; ate: string } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(anoMes);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const ultimo = new Date(ano, mes, 0).getDate();
  return { de: `${m[1]}-${m[2]}-01`, ate: `${m[1]}-${m[2]}-${String(ultimo).padStart(2, "0")}` };
}

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

const centavos = (v: number) => Math.round(Math.abs(Number(v) || 0) * 100);

/**
 * Rateio entre EMPRESAS pago de uma conta só. Cada fatia do Fluxo leva a empresa do contrato dela, e na maioria das despesas a fatia sai
 * mesmo da conta daquela empresa. Mas há boleto pago inteiro por uma empresa e rateado com outras (ex.: R$ 821,60 = 79,00 de uma empresa
 * + 742,60 de outra, pagos pela segunda): o extrato dessa conta traz o valor TOTAL. Aqui, para a empresa da conciliação, a despesa conta
 * pelo total (todas as fatias) quando o extrato tem uma transação do mesmo dia e tipo com o valor total e as fatias dela sozinhas não
 * fecham o total. Se o extrato não tem o total, vale só a fatia da empresa, como sempre foi (aí a fatia aparece como divergência, o que
 * é o certo: aquela conta não pagou).
 */
export function incluirRateioPagoPorUmaConta(
  doEscopo: FluxoCaixaMaloteLinha[],
  doBanco: FluxoCaixaMaloteLinha[],
  extrato: Pick<OFXTransaction, "dia" | "valor" | "tipo">[],
): FluxoCaixaMaloteLinha[] {
  const noEscopo = new Set(doEscopo);
  const grupos = new Map<string, FluxoCaixaMaloteLinha[]>();
  for (const l of doBanco) {
    if (l.origem !== "malote" || !l.despesa_id || !l.data_pagamento) continue;
    const chave = [l.despesa_id, l.numero_parcela ?? "", l.data_pagamento, l.tipo].join("|");
    const g = grupos.get(chave);
    if (g) g.push(l); else grupos.set(chave, [l]);
  }
  const extrasNoExtrato = new Set(extrato.map((t) => `${t.dia}|${t.tipo === "ENTRADA" ? "entrada" : "saida"}|${centavos(t.valor)}`));
  const adicionadas: FluxoCaixaMaloteLinha[] = [];
  for (const g of grupos.values()) {
    if (new Set(g.map((l) => l.empresa_id)).size < 2) continue;
    const dentro = g.filter((l) => noEscopo.has(l));
    const fora = g.filter((l) => !noEscopo.has(l));
    if (dentro.length === 0 || fora.length === 0) continue;
    const total = g.reduce((s, l) => s + (Number(l.valor) || 0), 0);
    const daEmpresa = dentro.reduce((s, l) => s + (Number(l.valor) || 0), 0);
    if (centavos(total) === centavos(daEmpresa)) continue;
    if (extrasNoExtrato.has(`${g[0].data_pagamento}|${g[0].tipo}|${centavos(total)}`) && !extrasNoExtrato.has(`${g[0].data_pagamento}|${g[0].tipo}|${centavos(daEmpresa)}`)) {
      adicionadas.push(...fora);
    }
  }
  return adicionadas.length ? [...doEscopo, ...adicionadas] : doEscopo;
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
  /** O Fluxo do banco no período de TODAS as empresas: só para o rateio pago de uma conta só (ver incluirRateioPagoPorUmaConta). */
  linhasDoBancoTodasEmpresas?: FluxoCaixaMaloteLinha[];
  trns: OFXTransaction[];
  dataDe: string;
  dataAte: string;
  saldoExtrato: number | null;
  bancoNome: string;
}): ProcessamentoConciliacao {
  const { linhasDoBancoEmpresa: linhasDaEmpresa, linhasDoBancoTodasEmpresas, trns, dataDe, dataAte, saldoExtrato, bancoNome } = args;
  // SIS-2026-0657: só entra do extrato o que está no período escolhido (igual ao lado Fluxo).
  const { dentro, fora } = transacoesNoPeriodo(trns, dataDe, dataAte);
  const linhasDoBancoEmpresa = linhasDoBancoTodasEmpresas
    ? incluirRateioPagoPorUmaConta(linhasDaEmpresa, linhasDoBancoTodasEmpresas, dentro)
    : linhasDaEmpresa;
  // "SALDO ANTERIOR" é o saldo de abertura (não movimento): fica fora da comparação normal e, se o saldo do extrato foi informado, entra como
  // uma linha dos dois lados (ver lib/conciliacaoSaldoAnterior.ts).
  const saldoLinhas = linhasSaldoAnterior(linhasDoBancoEmpresa.filter(ehSaldoAnterior), saldoExtrato, dataDe, bancoNome);
  const linhasPeriodoBanco = linhasDoBancoEmpresa.filter((l) => !ehSaldoAnterior(l));
  const planRows = [...linhasFluxoParaPlanilhaRow(linhasPeriodoBanco), ...saldoLinhas.plan];
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
