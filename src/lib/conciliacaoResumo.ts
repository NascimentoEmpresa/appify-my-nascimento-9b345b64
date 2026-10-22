import type { OFXTransaction, PlanilhaRow, ReconciliacaoResult } from "@/lib/conciliacaoBancariaEngine";

// Resumo do que foi CONCILIADO (bateu entre Fluxo de Caixa e extrato), gravado junto da conciliação salva. Quando tudo bate a conciliação não
// tem nenhuma linha de divergência para mostrar; sem este resumo a lista de "Conciliações Salvas" aparecia toda zerada, sem dizer o que foi
// conferido. Conciliado = o que está no Fluxo do período MENOS as linhas do Fluxo que ainda aparecem como divergência (as ignoradas).
export interface DiaConciliado {
  /** yyyy-mm-dd */
  dia: string;
  fluxoEntradas: number;
  fluxoSaidas: number;
  extratoEntradas: number;
  extratoSaidas: number;
  conciliadoEntradas: number;
  conciliadoSaidas: number;
  qtdFluxo: number;
  qtdConciliadas: number;
  qtdExtrato: number;
  /** nenhuma divergência (nem ignorada) neste dia */
  ok: boolean;
}

export interface ResumoConciliacao {
  fluxoEntradas: number;
  fluxoSaidas: number;
  qtdFluxo: number;
  qtdExtrato: number;
  conciliadoEntradas: number;
  conciliadoSaidas: number;
  qtdConciliadas: number;
  diasTotal: number;
  diasOk: number;
  /** dia a dia, em ordem de data */
  dias: DiaConciliado[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const brParaIso = (br: string) => { const [d, m, y] = br.split("/"); return `${y}-${m}-${d}`; };

export function resumirConciliacao(
  planRows: PlanilhaRow[],
  ofxRows: Pick<OFXTransaction, "dia" | "valor" | "tipo">[],
  resultado: ReconciliacaoResult,
): ResumoConciliacao {
  const dias = new Map<string, DiaConciliado>();
  const dia = (iso: string): DiaConciliado => {
    let d = dias.get(iso);
    if (!d) {
      d = { dia: iso, fluxoEntradas: 0, fluxoSaidas: 0, extratoEntradas: 0, extratoSaidas: 0, conciliadoEntradas: 0, conciliadoSaidas: 0, qtdFluxo: 0, qtdConciliadas: 0, qtdExtrato: 0, ok: true };
      dias.set(iso, d);
    }
    return d;
  };
  for (const p of planRows) {
    const d = dia(p.dia);
    d.qtdFluxo += 1;
    if (p.tipo === "ENTRADA") d.fluxoEntradas += p.valor;
    else if (p.tipo === "SAÍDA") d.fluxoSaidas += p.valor;
  }
  for (const e of ofxRows) {
    const d = dia(e.dia);
    d.qtdExtrato += 1;
    if (e.tipo === "ENTRADA") d.extratoEntradas += e.valor;
    else d.extratoSaidas += e.valor;
  }
  // conciliado = Fluxo do dia menos o que ainda é divergência do lado do Fluxo (a linha tem o tipo da planilha)
  const divEntradas = new Map<string, number>();
  const divSaidas = new Map<string, number>();
  const divQtd = new Map<string, number>();
  for (const l of resultado.lancamentos) {
    const iso = brParaIso(l.dia);
    dia(iso).ok = false;
    if (!l.tipoPlanilha) continue;
    divQtd.set(iso, (divQtd.get(iso) ?? 0) + 1);
    if (l.tipoPlanilha === "ENTRADA") divEntradas.set(iso, (divEntradas.get(iso) ?? 0) + l.valor);
    else if (l.tipoPlanilha === "SAÍDA") divSaidas.set(iso, (divSaidas.get(iso) ?? 0) + l.valor);
  }
  const lista = [...dias.values()]
    .sort((a, b) => a.dia.localeCompare(b.dia))
    .map<DiaConciliado>((d) => ({
      ...d,
      fluxoEntradas: r2(d.fluxoEntradas),
      fluxoSaidas: r2(d.fluxoSaidas),
      extratoEntradas: r2(d.extratoEntradas),
      extratoSaidas: r2(d.extratoSaidas),
      conciliadoEntradas: r2(d.fluxoEntradas - (divEntradas.get(d.dia) ?? 0)),
      conciliadoSaidas: r2(d.fluxoSaidas - (divSaidas.get(d.dia) ?? 0)),
      qtdConciliadas: Math.max(0, d.qtdFluxo - (divQtd.get(d.dia) ?? 0)),
    }));
  const soma = (f: (d: DiaConciliado) => number) => r2(lista.reduce((s, d) => s + f(d), 0));
  return {
    fluxoEntradas: soma((d) => d.fluxoEntradas),
    fluxoSaidas: soma((d) => d.fluxoSaidas),
    qtdFluxo: planRows.length,
    qtdExtrato: ofxRows.length,
    conciliadoEntradas: soma((d) => d.conciliadoEntradas),
    conciliadoSaidas: soma((d) => d.conciliadoSaidas),
    qtdConciliadas: lista.reduce((s, d) => s + d.qtdConciliadas, 0),
    diasTotal: resultado.totalDias,
    diasOk: resultado.diasOk,
    dias: lista,
  };
}
