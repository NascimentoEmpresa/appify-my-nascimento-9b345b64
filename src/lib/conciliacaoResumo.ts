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
  // Mesmos números do "Resumo por Dia" da conciliação: total do Fluxo, total do extrato, diferença e o que explica a diferença.
  fluxoTotal: number;
  extratoTotal: number;
  diferenca: number;
  observacao: string;
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
      d = { dia: iso, fluxoEntradas: 0, fluxoSaidas: 0, extratoEntradas: 0, extratoSaidas: 0, conciliadoEntradas: 0, conciliadoSaidas: 0, qtdFluxo: 0, qtdConciliadas: 0, qtdExtrato: 0, ok: true, fluxoTotal: 0, extratoTotal: 0, diferenca: 0, observacao: "—" };
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
  // o que sobra em cada dia, por tipo de ocorrência (texto do "Resumo por Dia")
  const ocorrencias = new Map<string, { soExtrato: number; soFluxo: number; divergente: number }>();
  for (const l of resultado.lancamentos) {
    const iso = brParaIso(l.dia);
    const o = ocorrencias.get(iso) ?? { soExtrato: 0, soFluxo: 0, divergente: 0 };
    if (l.erro === "🚨 FLUXO - NÃO ENCONTRADO") o.soExtrato += 1;
    else if (l.erro === "⚠️ BANCO - NÃO ENCONTRADO") o.soFluxo += 1;
    else o.divergente += 1;
    ocorrencias.set(iso, o);
  }
  const textoObservacao = (iso: string): string => {
    const o = ocorrencias.get(iso);
    if (!o) return "—";
    const partes: string[] = [];
    if (o.soExtrato > 0) partes.push(`${o.soExtrato} no extrato, sem par no Fluxo`);
    if (o.soFluxo > 0) partes.push(`${o.soFluxo} no Fluxo, sem par no extrato`);
    if (o.divergente > 0) partes.push(`${o.divergente} com valor/tipo divergente`);
    return partes.length ? partes.join(" · ") : "—";
  };
  const resumoDoDia = new Map(resultado.resumo.map((r) => [r.diaISO, r]));
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
      fluxoTotal: r2(resumoDoDia.get(d.dia)?.totalPlanilha ?? d.fluxoEntradas + d.fluxoSaidas),
      extratoTotal: r2(Math.abs(resumoDoDia.get(d.dia)?.totalExtrato ?? -(d.extratoEntradas + d.extratoSaidas))),
      diferenca: r2(resumoDoDia.get(d.dia)?.diferenca ?? 0),
      ok: resumoDoDia.get(d.dia) ? resumoDoDia.get(d.dia)!.status === "OK" && d.ok : d.ok,
      observacao: textoObservacao(d.dia),
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
