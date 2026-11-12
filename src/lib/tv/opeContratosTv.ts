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
import {
  COBERTURA_CRITICA, CUSTO_ATENCAO, CUSTO_CRITICO, EFETIVO_MIN_FALTAS, EFETIVO_MIN_TURNOVER, FALTAS_ATENCAO, FALTAS_CRITICO,
  MARGEM_PADRAO, PISO_RECEITA, TURNOVER_META_MES, type ChaveInd, type StatusInd,
} from "@/lib/operacional/indicadoresContratos";

export interface FinanceiroTv {
  competencia: string;
  /** Valor Líquido das notas da competência, por contrato. */
  receita: Record<string, number>;
  /** Saídas do Fluxo de Caixa por "contratoId|YYYY-MM", do começo do ano até a competência. */
  custo_por_mes: Record<string, number>;
  /**
   * A linha do mês no Faturamento da Empresa: Valor Líquido − Despesas de
   * TODOS os contratos (mig 20261113005000). É o que o cartão "Lucratividade"
   * mostra — antes ele somava só os contratos com receita ≥ R$ 10 mil e custo
   * lançado, e deu 19,5% na TV contra 10,43% no Faturamento (set/26).
   */
  empresa?: { liquido: number; despesas: number; lucro: number; margem: number | null };
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

// ── Layout "TV da Gerência Operacional" (11/11/2026) ────────────────────
// Pablo, com o modelo: os 7 totais no topo, a tabela "Contratos que precisam
// de ação" (a ÚNICA coisa que troca: 5 contratos a cada 10 s, do pior para o
// melhor), "Onde agir agora" e 4 gráficos fixos. Os totais somam as MESMAS
// bases dos indicadores por contrato (nada de média de percentuais).


export const CONTRATOS_POR_TELA = 5;

export interface TotaisOpe {
  postos: { contratados: number; cobertos: number; pct: number | null; status: StatusInd };
  lucratividade: { margem: number | null; abaixo: number; status: StatusInd };
  custo: { desvio: number | null; acima: number; status: StatusInd };
  glosas: { valor: number; contratos: number; status: StatusInd };
  faltas: { pct: number | null; status: StatusInd };
  turnover: { pct: number | null; status: StatusInd };
  reclamacoes: { qtd: number; contratos: number; status: StatusInd };
}

const r1t = (v: number) => Math.round(v * 10) / 10;
const fora = (s: StatusInd) => s === "critico" || s === "atencao";

export function totaisOpe(d: DadosOpeContratosTv, linhas: LinhaContrato[] = linhasDaTv(d)): TotaisOpe {
  const ids = new Set(linhas.map((l) => l.id));
  const cs = d.contratos.filter((c) => ids.has(c.id));
  const fin = entradaFinanceiraTv(d.financeiro);

  const comPosto = cs.filter((c) => (c.postos?.contratados ?? 0) > 0);
  const contratados = comPosto.reduce((a, c) => a + (c.postos?.contratados ?? 0), 0);
  const cobertos = comPosto.reduce((a, c) => a + Math.min(c.postos?.cobertos ?? 0, c.postos?.contratados ?? 0), 0);
  const pPostos = contratados > 0 ? r1t((cobertos / contratados) * 100) : null;

  // A margem do cartão é a do Faturamento da Empresa (bloco `empresa` do banco).
  // Sem ele (banco ainda sem a mig 20261113005000), a conta antiga por contrato.
  let margem: number | null;
  const emp = d.financeiro?.empresa;
  if (emp) {
    margem = emp.margem == null ? null : r1t(emp.margem);
  } else {
    let rec = 0, cus = 0;
    cs.forEach((c) => { const f = fin.doMes?.get(c.id); if (f && f.receita >= PISO_RECEITA && f.custo > 0) { rec += f.receita; cus += f.custo; } });
    margem = rec > 0 ? r1t(((rec - cus) / rec) * 100) : null;
  }

  let orc = 0, real = 0;
  const ano = d.competencia.slice(0, 4);
  cs.forEach((c) => Object.entries(c.orcado?.custo_direto_por_mes ?? {}).forEach(([mes, o]) => {
    if (!mes.startsWith(ano) || mes > d.competencia || !(o > 0)) return;
    const r = fin.custoPorMes?.get(`${c.id}|${mes}`) ?? 0;
    if (r > 0) { orc += o; real += r; }
  }));
  const desvio = orc > 0 ? r1t(((real - orc) / orc) * 100) : null;

  const glosaValor = cs.reduce((a, c) => a + (c.glosas?.valor ?? 0), 0);
  const fal = cs.filter((c) => c.efetivo >= EFETIVO_MIN_FALTAS);
  const diasBase = fal.reduce((a, c) => a + c.efetivo * d.dias, 0);
  const pFaltas = diasBase > 0 ? r1t((fal.reduce((a, c) => a + c.atestados.dias_pessoa, 0) / diasBase) * 100) : null;
  const tur = cs.filter((c) => c.efetivo >= EFETIVO_MIN_TURNOVER);
  const ef = tur.reduce((a, c) => a + c.efetivo, 0);
  const pTurn = ef > 0 ? r1t((tur.reduce((a, c) => a + c.demissoes, 0) / ef) * 100) : null;
  const recl = cs.reduce((a, c) => a + (c.reclamacoes?.qtd ?? 0), 0);
  const conta = (k: ChaveInd) => linhas.filter((l) => fora(l.ind[k].status)).length;

  return {
    postos: { contratados, cobertos, pct: pPostos, status: pPostos == null ? "sem_fonte" : pPostos >= 100 ? "ok" : pPostos >= COBERTURA_CRITICA ? "atencao" : "critico" },
    lucratividade: { margem, abaixo: conta("lucratividade"), status: margem == null ? "sem_dado" : margem < 0 ? "critico" : margem < MARGEM_PADRAO ? "atencao" : "ok" },
    custo: { desvio, acima: conta("custo"), status: desvio == null ? "sem_dado" : desvio > CUSTO_CRITICO ? "critico" : desvio > CUSTO_ATENCAO ? "atencao" : "ok" },
    glosas: { valor: glosaValor, contratos: cs.filter((c) => (c.glosas?.qtd ?? 0) > 0).length, status: glosaValor > 0 ? "atencao" : "ok" },
    faltas: { pct: pFaltas, status: pFaltas == null ? "sem_dado" : pFaltas > FALTAS_CRITICO ? "critico" : pFaltas > FALTAS_ATENCAO ? "atencao" : "ok" },
    turnover: { pct: pTurn, status: pTurn == null ? "sem_dado" : pTurn > TURNOVER_META_MES * 2 ? "critico" : pTurn > TURNOVER_META_MES ? "atencao" : "ok" },
    reclamacoes: { qtd: recl, contratos: conta("reclamacoes"), status: recl === 0 ? "ok" : linhas.some((l) => l.ind.reclamacoes.status === "critico") ? "critico" : "atencao" },
  };
}

const ALERTA: Record<ChaveInd, string> = {
  postos: "Postos descobertos", lucratividade: "Margem abaixo da prevista", custo: "Custo acima do orçado",
  glosas: "Glosas no contrato", faltas: "Faltas recorrentes", turnover: "Equipe instável", reclamacoes: "Reclamações do cliente",
};

/** O alerta mais grave do contrato (crítico antes de atenção, na ordem dos indicadores); null se está tudo bem. */
export function alertaPrincipal(l: LinhaContrato): { texto: string; status: StatusInd } | null {
  const ordem: ChaveInd[] = ["postos", "lucratividade", "custo", "glosas", "faltas", "turnover", "reclamacoes"];
  for (const s of ["critico", "atencao"] as StatusInd[]) {
    const k = ordem.find((x) => l.ind[x].status === s);
    if (k) {
      const texto = k === "lucratividade" && (l.ind.lucratividade.valor ?? 0) < 0 ? "Prejuízo no contrato" : ALERTA[k];
      return { texto, status: s };
    }
  }
  return null;
}

/** Glosas por causa (a causa principal de cada contrato, somando o valor). */
export function glosasPorCausa(d: DadosOpeContratosTv): { causa: string; valor: number }[] {
  const m = new Map<string, number>();
  d.contratos.filter((c) => !c.encerrado && (c.glosas?.valor ?? 0) > 0)
    .forEach((c) => { const k = (c.glosas.causa ?? "").trim() || "Sem causa informada"; m.set(k, (m.get(k) ?? 0) + c.glosas.valor); });
  const lista = [...m.entries()].map(([causa, valor]) => ({ causa, valor })).sort((a, b) => b.valor - a.valor);
  if (lista.length <= 4) return lista;
  const outros = lista.slice(3).reduce((a, x) => a + x.valor, 0);
  return [...lista.slice(0, 3), { causa: "Outras", valor: outros }];
}
