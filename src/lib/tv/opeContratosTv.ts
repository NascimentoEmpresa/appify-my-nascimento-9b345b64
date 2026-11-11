// =====================================================================
// TV › Operacional — INDICADORES POR CONTRATO (11/11/2026)
//
// Pablo: "era só uma playlist da TV com gráficos — vai passando de contrato
// a contrato a cada 10 seg". Helena: "pelo menos os 5 mais impactantes".
// A TV abre com os 5 contratos que mais pedem atenção e depois passa um
// contrato por tela, 10 s cada, do pior para o melhor.
//
// As contas são as MESMAS da tela Operacional › Indicadores por Contrato
// (src/lib/operacional/indicadoresContratos.ts): aqui só se monta a entrada
// financeira a partir do que o banco manda (tv_ope_contratos_dados, mig
// 20261111130000) e se escolhe a ordem das páginas.
// =====================================================================

import {
  montarLinhas, ordenar, type DadosContratosRpc, type EntradaFinanceira, type Financeiro, type LinhaContrato,
} from "@/lib/operacional/indicadoresContratos";

export interface FinanceiroTv {
  competencia: string;
  /** Valor Líquido das notas da competência, por contrato. */
  receita: Record<string, number>;
  /** Saídas do Fluxo de Caixa por "contratoId|YYYY-MM", do começo do ano até a competência. */
  custo_por_mes: Record<string, number>;
}

export type DadosOpeContratosTv = DadosContratosRpc & { financeiro: FinanceiroTv };

/** Cada contrato fica 10 s na tela (pedido do Pablo). */
export const SEGUNDOS_POR_CONTRATO = 10;
/** A tela de abertura: os N que mais pedem atenção (Helena: "pelo menos os 5"). */
export const TOP_IMPACTO = 5;

export function entradaFinanceiraTv(f: FinanceiroTv | null | undefined): EntradaFinanceira {
  if (!f) return { doMes: null, custoPorMes: null };
  const custoPorMes = new Map(Object.entries(f.custo_por_mes ?? {}));
  const ids = new Set([...Object.keys(f.receita ?? {}), ...[...custoPorMes.keys()].map((k) => k.split("|")[0])]);
  const doMes = new Map<string, Financeiro>();
  ids.forEach((id) => doMes.set(id, { receita: f.receita?.[id] ?? 0, custo: custoPorMes.get(`${id}|${f.competencia}`) ?? 0 }));
  return { doMes, custoPorMes };
}

/** Contrato em operação: tem posto, efetivo ou nota no mês. Encerrado não vai para a TV. */
function emOperacao(d: DadosOpeContratosTv, l: LinhaContrato): boolean {
  const c = d.contratos.find((x) => x.id === l.id);
  if (!c || c.encerrado) return false;
  return (c.postos?.contratados ?? 0) > 0 || c.efetivo > 0 || (d.financeiro?.receita?.[c.id] ?? 0) > 0;
}

/** As linhas da TV: só contratos em operação, do pior para o melhor. */
export function linhasDaTv(d: DadosOpeContratosTv): LinhaContrato[] {
  const linhas = montarLinhas(d, entradaFinanceiraTv(d.financeiro));
  return ordenar(linhas.filter((l) => emOperacao(d, l)), "pior");
}

export interface PaginaOpe { chave: string; titulo: string; contrato?: LinhaContrato }

/** "Os 5 que mais pedem atenção" (se algum pede) e depois um contrato por página. */
export function paginasOpeContratos(linhas: LinhaContrato[]): PaginaOpe[] {
  const ps: PaginaOpe[] = [];
  if (linhas.some((l) => l.gravidade > 0)) ps.push({ chave: "ope-top", titulo: `Os ${TOP_IMPACTO} que mais pedem atenção` });
  linhas.forEach((l) => ps.push({ chave: `ope:${l.id}`, titulo: l.nome, contrato: l }));
  return ps;
}

/** Os N primeiros com algo fora do esperado (a lista já vem do pior para o melhor). */
export const topImpacto = (linhas: LinhaContrato[], n = TOP_IMPACTO) => linhas.filter((l) => l.gravidade > 0).slice(0, n);
