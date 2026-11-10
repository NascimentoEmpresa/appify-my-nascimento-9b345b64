// =====================================================================
// Operacional › Indicadores › 3. LUCRATIVIDADE E ORÇAMENTO (09/11/2026)
//
// Mesma conta de Controladoria › Faturamento da Empresa e do Painel
// Executivo: receita = Valor Líquido das notas; custo = saídas do Fluxo de
// Caixa com contrato (por rubrica: salários, férias, rescisões, FGTS, INSS,
// VA, VT, outras); lucro bruto = líquido − custo.
//   · Rateio administrativo = saídas SEM contrato do Fluxo de Caixa no mês
//     (admPorMesRubrica do Fechamento). Parcial: o Fechamento ainda soma os
//     contratos ADMINISTRATIVO e tira IRPJ/CSLL.
//   · Margem líquida = (lucro bruto − rateio) ÷ líquido.
//   · Orçado × realizado: sem fonte — os orçamentos de contrato estão em
//     rascunho (conferido em 09/11/2026).
// =====================================================================
import { agruparFaturamento, RUBRICAS, custosVazios, type CustosPorRubrica, type NfFaturamento, type RubricaCusto } from "@/pages/controladoria/faturamento/regras";

export interface EntradaLucratividade {
  nfs: NfFaturamento[];
  contratos: Map<string, string>;
  /** Custo por rubrica, chave "contratoId|YYYY-MM". */
  custos: Map<string, CustosPorRubrica>;
  /** Despesa administrativa por mês (já somadas as rubricas). */
  admPorMes: Map<string, number>;
}

export interface ResumoMes {
  receita: number;
  custo: number;
  lucro: number;
  /** % (0–100); null sem receita. */
  margem: number | null;
  rateio: number;
  margemLiquida: number | null;
}

export interface ContratoMargem { id: string; nome: string; receita: number; custo: number; lucro: number; margem: number }

export interface DadosLucratividade {
  atual: ResumoMes | null;
  anterior: ResumoMes | null;
  composicao: { id: RubricaCusto; nome: string; valor: number }[];
  contratos: ContratoMargem[];
  /** Contratos com receita ≥ R$ 10 mil e margem abaixo de 10%. */
  abaixoDe10: number;
  /** Base do "x de y": contratos com receita ≥ R$ 10 mil. */
  classificados: number;
}

export const PISO_RECEITA = 10_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (num: number, den: number) => (den > 0 ? r2((num / den) * 100) : null);

function mesAnterior(c: string): string {
  const [a, m] = c.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

function somar(a: CustosPorRubrica, b: CustosPorRubrica): CustosPorRubrica {
  const out = { ...a };
  for (const r of RUBRICAS) out[r.id] += b[r.id];
  return out;
}
const total = (c: CustosPorRubrica) => RUBRICAS.reduce((s, r) => s + c[r.id], 0);

function doMes(e: EntradaLucratividade, mes: string) {
  const receitaPorContrato = new Map<string, number>();
  const nfs = e.nfs.filter((n) => e.contratos.has(n.contrato_id) && n.competencia.startsWith(mes));
  for (const [id, t] of agruparFaturamento(nfs, (n) => n.contrato_id)) receitaPorContrato.set(id, t.liquido);
  const custoPorContrato = new Map<string, CustosPorRubrica>();
  let composicao = custosVazios();
  for (const [chave, c] of e.custos) {
    const [id, m] = chave.split("|");
    if (m !== mes || !e.contratos.has(id)) continue;
    custoPorContrato.set(id, somar(custoPorContrato.get(id) ?? custosVazios(), c));
    composicao = somar(composicao, c);
  }
  const receita = [...receitaPorContrato.values()].reduce((s, v) => s + v, 0);
  const custo = total(composicao);
  const temDado = nfs.length > 0 || custo > 0;
  const rateio = e.admPorMes.get(mes) ?? 0;
  const resumo: ResumoMes | null = temDado ? {
    receita: r2(receita), custo: r2(custo), lucro: r2(receita - custo), margem: pct(receita - custo, receita),
    rateio: r2(rateio), margemLiquida: pct(receita - custo - rateio, receita),
  } : null;
  return { resumo, receitaPorContrato, custoPorContrato, composicao };
}

export function montarLucratividade(e: EntradaLucratividade, competencia: string): DadosLucratividade {
  const m = doMes(e, competencia);
  const ids = new Set([...m.receitaPorContrato.keys(), ...m.custoPorContrato.keys()]);
  const contratos: ContratoMargem[] = [...ids].map((id) => {
    const receita = m.receitaPorContrato.get(id) ?? 0;
    const custo = total(m.custoPorContrato.get(id) ?? custosVazios());
    return { id, nome: e.contratos.get(id) ?? id, receita: r2(receita), custo: r2(custo), lucro: r2(receita - custo), margem: pct(receita - custo, receita) ?? 0 };
  }).sort((a, b) => b.receita - a.receita);
  const classificados = contratos.filter((c) => c.receita >= PISO_RECEITA);
  return {
    atual: m.resumo,
    anterior: doMes(e, mesAnterior(competencia)).resumo,
    composicao: RUBRICAS.map((r) => ({ id: r.id, nome: r.label, valor: r2(m.composicao[r.id]) })).filter((c) => c.valor > 0),
    contratos,
    abaixoDe10: classificados.filter((c) => c.margem < 10).length,
    classificados: classificados.length,
  };
}
