// =====================================================================
// Relatórios › Turn-over › VARIAÇÃO DE EFETIVO (mig 20261025000010)
// Contas da aba (com teste em src/test/turnover-variacao-efetivo.test.ts).
//
// A RPC dir_turnover_variacao_efetivo manda, por empresa › contrato › mês,
// as CONTAGENS (previsto, trabalhando, admissões, demissões). Somas por
// empresa e do grupo, e o turnover, saem daqui:
//   turnover do mês = demissões ÷ efetivo no fim do mês × 100 (a taxa
//   mensal do Turn-over); turnover médio = média das taxas mensais.
//
// 26/10/2026 (migs 20261026000010 e 040): "trabalhando" é o "Tem" do
// Ativos/Contratos — só Situação "Trabalhando" (atestado, férias, auxílio-
// doença etc. não), sem fora da conta / RENDA TÉCNICA; no mês corrente é a
// foto de hoje. O cartão soma, como o de lá, só contratos com Planilha de
// Custo (`planilha`); "Pablo: um lado tem 2151, no outro 2.236 — os números
// têm que bater". O turnover segue no efetivo de antes (todos os ativos,
// afastados inclusive), que vem em `efetivo`; sem ele (RPC antiga), cai no
// trabalhando.
// =====================================================================

export interface MesEfetivo {
  mes: string; previsto: number; trabalhando: number; admissoes: number; demissoes: number;
  /** Todos os ativos no fim do mês, afastados inclusive — base do turnover. */
  efetivo?: number;
  /** O contrato tem posto vigente na Planilha de Custo no mês (o que o cartão do Ativos/Contratos soma). */
  planilha?: boolean;
}
export interface ContratoEfetivo { chave: string; nome: string; no_erp: boolean; meses: MesEfetivo[] }
export interface EmpresaEfetivo { empresa: string; contratos: ContratoEfetivo[] }
export interface VariacaoEfetivo { ano: number; meses: string[]; gerado_em?: string; empresas: EmpresaEfetivo[] }

export interface Registro { previsto: number; trabalhando: number; efetivo: number; admissoes: number; demissoes: number; turnover: number | null; vazio: boolean }

export const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const mesesDoAno = (ano: number) => Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`);
export const rotuloMes = (mes: string) => `${MESES_CURTOS[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;

const r2 = (n: number) => Math.round(n * 100) / 100;
export const taxaTurnover = (demissoes: number, efetivo: number): number | null =>
  efetivo > 0 ? r2((demissoes * 100) / efetivo) : demissoes > 0 ? null : 0;

const VAZIO: Registro = { previsto: 0, trabalhando: 0, efetivo: 0, admissoes: 0, demissoes: 0, turnover: null, vazio: true };

/** O registro de um contrato num mês (mês ainda não começado → vazio). */
export function registro(c: ContratoEfetivo, mes: string): Registro {
  const m = c.meses.find((x) => x.mes === mes);
  if (!m) return VAZIO;
  const efetivo = m.efetivo ?? m.trabalhando;
  return { ...m, efetivo, turnover: taxaTurnover(m.demissoes, efetivo), vazio: false };
}

/** Soma de vários contratos num mês. */
export function somar(contratos: ContratoEfetivo[], mes: string): Registro {
  let vazio = true;
  const s = { previsto: 0, trabalhando: 0, efetivo: 0, admissoes: 0, demissoes: 0 };
  for (const c of contratos) {
    const r = registro(c, mes);
    if (r.vazio) continue;
    vazio = false;
    s.previsto += r.previsto; s.trabalhando += r.trabalhando; s.efetivo += r.efetivo; s.admissoes += r.admissoes; s.demissoes += r.demissoes;
  }
  if (vazio) return VAZIO;
  return { ...s, turnover: taxaTurnover(s.demissoes, s.efetivo), vazio: false };
}

export const todosContratos = (v: VariacaoEfetivo) => v.empresas.flatMap((e) => e.contratos);

/** Último mês com dado (o "atual" dos cartões). */
export const ultimoMes = (v: Pick<VariacaoEfetivo, "meses">) => v.meses[v.meses.length - 1] ?? null;

export interface Resumo {
  mes: string | null; previsto: number;
  /** Trabalhando nos contratos com Planilha de Custo — o "Tem" do cartão do Ativos/Contratos. */
  trabalhando: number;
  /** Trabalhando em contrato sem planilha ou filial sem contrato (fora do cartão, como lá). */
  trabalhandoSemPlanilha: number;
  turnoverMedio: number | null; admissoes: number; demissoes: number;
}

/** Cartões do topo: quadro do último mês, turnover médio mensal e movimentos do ano. */
export function resumo(contratos: ContratoEfetivo[], meses: string[]): Resumo {
  const ult = meses[meses.length - 1] ?? null;
  const fim = ult ? somar(contratos, ult) : VAZIO;
  // RPC antiga (sem `planilha`): conta todos, como antes.
  const comPlanilha = ult ? contratos.filter((c) => c.meses.find((m) => m.mes === ult)?.planilha ?? true) : [];
  const trabalhando = ult ? somar(comPlanilha, ult).trabalhando : 0;
  const regs = meses.map((m) => somar(contratos, m)).filter((r) => !r.vazio);
  const taxas = regs.map((r) => r.turnover).filter((t): t is number => t != null);
  return {
    mes: ult, previsto: fim.previsto, trabalhando, trabalhandoSemPlanilha: fim.trabalhando - trabalhando,
    turnoverMedio: taxas.length ? r2(taxas.reduce((a, b) => a + b, 0) / taxas.length) : null,
    admissoes: regs.reduce((s, r) => s + r.admissoes, 0),
    demissoes: regs.reduce((s, r) => s + r.demissoes, 0),
  };
}

/** Leitura do contrato no mês: déficit / excedente / dentro do previsto. */
export function leituraDoMes(r: Pick<Registro, "previsto" | "trabalhando">): { tipo: "deficit" | "excedente" | "ok" | "sem_previsto"; diferenca: number } {
  if (r.previsto <= 0) return { tipo: "sem_previsto", diferenca: r.trabalhando };
  const d = r.trabalhando - r.previsto;
  return { tipo: d < 0 ? "deficit" : d > 0 ? "excedente" : "ok", diferenca: Math.abs(d) };
}

/** Filtro por nome de contrato (sem acento) — mantém só empresas com algum contrato. */
export function filtrarEmpresas(v: VariacaoEfetivo, busca: string): EmpresaEfetivo[] {
  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = n(busca.trim());
  if (!q) return v.empresas;
  return v.empresas
    .map((e) => ({ ...e, contratos: n(e.empresa).includes(q) ? e.contratos : e.contratos.filter((c) => n(c.nome).includes(q)) }))
    .filter((e) => e.contratos.length);
}

const fmtPct = (n: number | null) => (n == null ? "" : n.toFixed(2).replace(".", ",") + "%");

/** Linhas do CSV (Excel): uma por contrato e mês. */
export function linhasCsv(v: VariacaoEfetivo): (string | number)[][] {
  const out: (string | number)[][] = [["Empresa", "Contrato", "Mês", "Efetivo previsto", "Efetivo trabalhando", "Turnover (%)", "Demissões", "Admissões"]];
  for (const e of v.empresas) for (const c of e.contratos) for (const mes of v.meses) {
    const r = registro(c, mes);
    out.push([e.empresa, c.nome, rotuloMes(mes), r.previsto, r.trabalhando, fmtPct(r.turnover), r.demissoes, r.admissoes]);
  }
  return out;
}
