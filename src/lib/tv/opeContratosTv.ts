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
  MARGEM_PADRAO, PISO_RECEITA, RECLAMACOES_CRITICO, TURNOVER_META_MES, type ChaveInd, type StatusInd,
} from "@/lib/operacional/indicadoresContratos";

export interface FinanceiroTv {
  competencia: string;
  /** Valor Líquido das notas da competência, por contrato. */
  receita: Record<string, number>;
  /** Saídas do Fluxo de Caixa por "contratoId|YYYY-MM", do começo do ano até a competência. */
  custo_por_mes: Record<string, number>;
  /**
   * A linha do mês no Faturamento da Empresa: Valor Líquido − Despesas de
   * TODOS os contratos (mig 20261113005100). É o que o cartão "Lucratividade"
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
  // Sem ele (banco ainda sem a mig 20261113005100), a conta antiga por contrato.
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

// ── Indicadores gerenciais = a TV (14/11/2026) ──────────────────────────
// Pablo: "os indicadores gerenciais das TVs têm que estar assim, as
// informações têm que bater". A TV da Gerência Operacional toca a
// 'ope-contratos' (mig 20261111130000) e a tela TV's › Indicadores gerenciais
// mostrava os cards do tvg_calc (DRE, outra régua): 51,2% de lucratividade
// na tela contra ~10% na TV. Aqui os 7 cards saem dos MESMOS totais da TV
// (totaisOpe), com as metas e o semáforo dela. Dono, nome, ordem e medida
// continuam os do cadastro do indicador.

/** O que substitui, no card do indicador gerencial, o cálculo do tvg. */
export interface CardOpe {
  unidade: "qtd" | "pct" | "brl"; sentido: "menor" | "maior"; meta: number; alerta: number | null; meta_texto: string;
  valor: number | null; afetado: string | null; causa: string | null; base: string;
  detalhe: { nome: string; valor: number | null; a?: number | null; b?: number | null }[];
}

const pctBr = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

export function cardsOpeGerencial(d: DadosOpeContratosTv): Record<string, CardOpe> {
  const linhas = linhasDaTv(d);
  const t = totaisOpe(d, linhas);
  const comp = d.competencia ? `${d.competencia.slice(5, 7)}/${d.competencia.slice(0, 4)}` : "";
  const ruins = (k: ChaveInd) => linhas.filter((l) => fora(l.ind[k].status));
  // Os contratos do gráfico: os piores primeiro, só com número.
  const top = (k: ChaveInd, maiorPior = true) => linhas.filter((l) => l.ind[k].valor != null)
    .sort((a, b) => (maiorPior ? (b.ind[k].valor ?? 0) - (a.ind[k].valor ?? 0) : (a.ind[k].valor ?? 0) - (b.ind[k].valor ?? 0)))
    .slice(0, 6).map((l) => ({ nome: l.nome, valor: l.ind[k].valor }));
  const onde = (k: ChaveInd, maiorPior = true) => {
    const r = ruins(k).sort((a, b) => (maiorPior ? (b.ind[k].valor ?? 0) - (a.ind[k].valor ?? 0) : (a.ind[k].valor ?? 0) - (b.ind[k].valor ?? 0)));
    return r.length ? `${r.length} contrato(s) · pior: ${r[0].nome} (${r[0].ind[k].texto})` : "Nenhum contrato fora";
  };
  const causa = (k: ChaveInd, maiorPior = true) => {
    const r = ruins(k).sort((a, b) => (maiorPior ? (b.ind[k].valor ?? 0) - (a.ind[k].valor ?? 0) : (a.ind[k].valor ?? 0) - (b.ind[k].valor ?? 0)));
    return r[0]?.ind[k].detalhe ?? null;
  };
  const cs = new Map(d.contratos.map((c) => [c.id, c]));
  const faltaPostos = linhas.map((l) => ({ l, p: cs.get(l.id)?.postos }))
    .filter((x) => x.p && x.p.contratados > 0 && x.p.cobertos < x.p.contratados)
    .sort((a, b) => (b.p!.contratados - b.p!.cobertos) - (a.p!.contratados - a.p!.cobertos));
  const gc = glosasPorCausa(d);
  return {
    op_postos: {
      unidade: "pct", sentido: "maior", meta: 100, alerta: COBERTURA_CRITICA, meta_texto: "100% de cobertura",
      valor: t.postos.pct, base: `${t.postos.cobertos} de ${t.postos.contratados} postos cobertos`,
      afetado: faltaPostos.length ? `${faltaPostos.length} contrato(s) com falta · maior: ${faltaPostos[0].l.nome} (−${faltaPostos[0].p!.contratados - faltaPostos[0].p!.cobertos})` : "Todos os postos cobertos",
      causa: faltaPostos.length ? `${t.postos.contratados - t.postos.cobertos} posto(s) sem pessoa trabalhando` : null,
      detalhe: faltaPostos.slice(0, 6).map((x) => ({ nome: x.l.nome, valor: x.p!.contratados - x.p!.cobertos, a: x.p!.contratados, b: x.p!.cobertos })),
    },
    op_lucratividade: {
      unidade: "pct", sentido: "maior", meta: MARGEM_PADRAO, alerta: 0, meta_texto: `≥ ${MARGEM_PADRAO}% (ou a margem prevista do contrato)`,
      valor: t.lucratividade.margem, base: `Faturamento da Empresa, competência ${comp}`,
      afetado: onde("lucratividade", false), causa: causa("lucratividade", false), detalhe: top("lucratividade", false),
    },
    op_custo_direto: {
      unidade: "pct", sentido: "menor", meta: CUSTO_ATENCAO, alerta: CUSTO_CRITICO, meta_texto: `≤ ${CUSTO_ATENCAO}% acima do orçado`,
      valor: t.custo.desvio, base: `Realizado × Planilha de Custo, ${comp.slice(3)}`,
      afetado: onde("custo"), causa: causa("custo"), detalhe: top("custo"),
    },
    op_glosas: {
      unidade: "brl", sentido: "menor", meta: 0, alerta: Number.MAX_SAFE_INTEGER, meta_texto: "R$ 0 em glosas", // a TV: glosa = atenção
      valor: t.glosas.valor, base: "Últimos 90 dias",
      afetado: t.glosas.contratos ? `${t.glosas.contratos} contrato(s)` : "Nenhum contrato", causa: gc[0]?.causa ?? null,
      detalhe: linhas.filter((l) => (l.ind.glosas.valor ?? 0) > 0).sort((a, b) => (b.ind.glosas.valor ?? 0) - (a.ind.glosas.valor ?? 0)).slice(0, 6)
        .map((l) => ({ nome: l.nome, valor: l.ind.glosas.valor })),
    },
    op_faltas: {
      unidade: "pct", sentido: "menor", meta: FALTAS_ATENCAO, alerta: FALTAS_CRITICO, meta_texto: `≤ ${FALTAS_ATENCAO}% de faltas`,
      valor: t.faltas.pct, base: `Atestados na competência ${comp}`,
      afetado: onde("faltas"), causa: causa("faltas"), detalhe: top("faltas"),
    },
    op_turnover: {
      unidade: "pct", sentido: "menor", meta: TURNOVER_META_MES, alerta: TURNOVER_META_MES * 2, meta_texto: `≤ ${pctBr(TURNOVER_META_MES)} ao mês (41% no ano)`,
      valor: t.turnover.pct, base: `Demissões ÷ efetivo, ${comp}`,
      afetado: onde("turnover"), causa: causa("turnover"), detalhe: top("turnover"),
    },
    op_reclamacoes: {
      unidade: "qtd", sentido: "menor", meta: 0, alerta: RECLAMACOES_CRITICO - 1, meta_texto: "0 reclamações e ≥ 90% de satisfação",
      valor: t.reclamacoes.qtd, base: "Notificações do cliente, 90 dias",
      afetado: t.reclamacoes.contratos ? onde("reclamacoes") : "Nenhum contrato", causa: causa("reclamacoes"),
      detalhe: linhas.filter((l) => (l.ind.reclamacoes.valor ?? 0) > 0).sort((a, b) => (b.ind.reclamacoes.valor ?? 0) - (a.ind.reclamacoes.valor ?? 0)).slice(0, 6)
        .map((l) => ({ nome: l.nome, valor: l.ind.reclamacoes.valor })),
    },
  };
}
