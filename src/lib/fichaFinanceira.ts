// =====================================================================
// FINANCEIRO › FICHA FINANCEIRA — a conta (29/10/2026)
//
// Os eventos de pagamento da Senior (espelho."BiFichaFinanceira") chegam
// da RPC ff_ficha (mig 20261029004700) como linhas soltas: um evento por
// linha, de vários cálculos. Aqui eles viram:
//   · cálculos (uma folha paga: mensal, férias, 13º, rescisão, adiantamento),
//     cada um com proventos, descontos e líquido;
//   · os totais do período, do ano e a média mensal.
//
// PROVENTO / DESCONTO / INFORMATIVO
//   O tipo de verdade é o tipeve do R008EVC (1/2 provento, 3 desconto, o
//   resto é base/informativo — FGTS, base de INSS…). Mas o R008EVC que vem
//   da Senior tinha só 25 eventos em 07/10/2026, então quase sempre a
//   classe sai da DESCRIÇÃO (regras abaixo) e a tela marca como "estimada".
//   Valor negativo é desconto sempre.
//   Adiantamento é o caso chato: "Adiantamento Salarial" é PROVENTO na folha
//   de adiantamento e DESCONTO na mensal (é o que já foi pago). Regra: num
//   cálculo que só tem adiantamento, ele é provento; com outros proventos
//   junto, é desconto. O mesmo para "13o Salário Adiantado".
//
// TIPO DE FOLHA (por cálculo)
//   Rescisão quando qualquer evento fala de rescisão / aviso prévio / saldo
//   de salário. Senão, pelos proventos: todos de 13º → 13º; todos de
//   adiantamento → adiantamento; todos de férias → férias; o resto é mensal.
//   tipcal 31/32 do R044CAL (13º na Senior) também decide 13º.
//
// PERÍODO
//   Pelo MÊS DE PAGAMENTO (o que a pessoa recebeu naquele mês — a mesma base
//   do informe de rendimentos). A competência aparece ao lado; sem o cálculo
//   no R044CAL ela é estimada pelo mês do pagamento.
// =====================================================================

/** Linha posicional da RPC ff_ficha. */
export type LinhaFicha = [
  string,          // 0 data de pagamento (AAAA-MM-DD)
  number | null,   // 1 empresa
  number | null,   // 2 matrícula
  number | null,   // 3 cálculo
  string | null,   // 4 competência AAAA-MM (R044CAL)
  number | null,   // 5 tipcal
  number | null,   // 6 código do evento
  string | null,   // 7 descrição
  number | null,   // 8 valor R$ (null sem permissão ou sem valor)
  number | null,   // 9 referência
  number | null,   // 10 tipeve (R008EVC)
];

export type ClasseEvento = "provento" | "desconto" | "informativo";
export type TipoFolha = "mensal" | "ferias" | "decimo" | "rescisao" | "adiantamento";

export const ROTULO_FOLHA: Record<TipoFolha, string> = {
  mensal: "Mensal",
  ferias: "Férias",
  decimo: "13º salário",
  rescisao: "Rescisão",
  adiantamento: "Adiantamento",
};
export const TIPOS_FOLHA: TipoFolha[] = ["mensal", "ferias", "decimo", "rescisao", "adiantamento"];

export interface EventoFicha {
  pagamento: string;
  empresa: number | null;
  matricula: number | null;
  calculo: number | null;
  competencia: string | null;
  tipcal: number | null;
  codigo: number | null;
  descricao: string;
  valor: number | null;
  referencia: number | null;
  tipeve: number | null;
  classe: ClasseEvento;
  /** true quando a classe saiu da descrição, não do cadastro da Senior. */
  classeEstimada: boolean;
}

export interface CalculoFicha {
  chave: string;
  empresa: number | null;
  matricula: number | null;
  calculo: number | null;
  pagamento: string;
  /** AAAA-MM do pagamento — a base do período. */
  mesPagamento: string;
  competencia: string;
  competenciaEstimada: boolean;
  tipcal: number | null;
  tipo: TipoFolha;
  eventos: EventoFicha[];
  proventos: number;
  descontos: number;
  liquido: number;
  /** Eventos que vieram sem valor (sem permissão, ou a Senior não mandou). */
  semValor: number;
}

// ── Regras de descrição ─────────────────────────────────────────────
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const RX_INFORMATIVO = /(^|\W)base(\W|$)|fgts|liquido|salario (base|contribuicao)|dependente|informativ|^total|valor do salario|salario familia base/;
const RX_DESCONTO = new RegExp([
  "(^|\\W)inss(\\W|$)", "irrf", "imposto de renda", "(^|\\W)i\\.?r\\.?r?\\.?f", "^desc", "desconto",
  "vale[\\s-]*transp", "(^|\\W)v\\.?t\\.?(\\W|$)", "falta", "atraso", "contribui", "mensalidade", "pensao",
  "emprestimo", "consignad", "devolu", "plano (de )?(saude|odonto)", "odontol", "unimed", "seguro",
  "farmacia", "copartic", "sindic", "assistencial", "confederativ", "vale[\\s-]*(refei|alim)",
  "refeitorio", "cesta", "arredond.*anterior", "liquido negativo", "saldo devedor",
].join("|"));
const RX_ADIANT = /adiant/;
const RX_RESCISAO = /rescis|aviso previo|saldo de salario|art\.?\s*4(77|79|80)|indeniza/;
const RX_DECIMO = /(^|\D)13\s*[o°ºª]?(\W|$|sal)|decimo/;
const RX_FERIAS = /ferias|abono pecuni|1\/3/;

/** Classe pela Senior (tipeve), pelo sinal, ou pela descrição. Adiantamento sai "provento" aqui e é resolvido no cálculo. */
export function classificarEvento(descricao: string, tipeve: number | null, valor: number | null): { classe: ClasseEvento; estimada: boolean } {
  if (tipeve === 1 || tipeve === 2) return { classe: "provento", estimada: false };
  if (tipeve === 3) return { classe: "desconto", estimada: false };
  if (tipeve != null) return { classe: "informativo", estimada: false };
  if (valor != null && valor < 0) return { classe: "desconto", estimada: false };
  const d = norm(descricao);
  if (RX_INFORMATIVO.test(d)) return { classe: "informativo", estimada: true };
  if (RX_DESCONTO.test(d)) return { classe: "desconto", estimada: true };
  return { classe: "provento", estimada: true };
}

export function tipoDaFolha(eventos: Pick<EventoFicha, "descricao" | "classe">[], tipcal: number | null): TipoFolha {
  const ds = eventos.map((e) => norm(e.descricao));
  if (ds.some((d) => RX_RESCISAO.test(d))) return "rescisao";
  if (tipcal === 31 || tipcal === 32) return "decimo";
  const prov = eventos.filter((e) => e.classe === "provento").map((e) => norm(e.descricao));
  const base = prov.length ? prov : ds;
  if (!base.length) return "mensal";
  if (base.every((d) => RX_DECIMO.test(d))) return "decimo";
  if (base.every((d) => RX_ADIANT.test(d))) return "adiantamento";
  if (base.every((d) => RX_FERIAS.test(d))) return "ferias";
  return "mensal";
}

const arred = (n: number) => Math.round(n * 100) / 100;

/** Das linhas da RPC aos cálculos, do mais recente para o mais antigo. */
export function montarCalculos(linhas: LinhaFicha[]): CalculoFicha[] {
  const grupos = new Map<string, EventoFicha[]>();
  for (const l of linhas) {
    const valor = l[8] == null ? null : Number(l[8]);
    const descricao = String(l[7] ?? "").trim() || `Evento ${l[6] ?? "?"}`;
    const { classe, estimada } = classificarEvento(descricao, l[10] == null ? null : Number(l[10]), valor);
    const ev: EventoFicha = {
      pagamento: String(l[0]).slice(0, 10), empresa: l[1], matricula: l[2], calculo: l[3],
      competencia: l[4], tipcal: l[5] == null ? null : Number(l[5]), codigo: l[6], descricao,
      valor, referencia: l[9] == null ? null : Number(l[9]), tipeve: l[10], classe, classeEstimada: estimada,
    };
    const chave = `${ev.empresa}-${ev.matricula}-${ev.calculo}-${ev.pagamento}`;
    const g = grupos.get(chave);
    if (g) g.push(ev); else grupos.set(chave, [ev]);
  }

  const out: CalculoFicha[] = [];
  for (const [chave, eventos] of grupos) {
    // Adiantamento: provento só se o cálculo não tem outro provento.
    const outros = eventos.some((e) => e.classe === "provento" && e.classeEstimada && !RX_ADIANT.test(norm(e.descricao)))
      || eventos.some((e) => e.classe === "provento" && !e.classeEstimada);
    if (outros) {
      for (const e of eventos) {
        if (e.classeEstimada && e.classe === "provento" && RX_ADIANT.test(norm(e.descricao))) e.classe = "desconto";
      }
    }
    const p = eventos[0];
    const tipcal = eventos.find((e) => e.tipcal != null)?.tipcal ?? null;
    const comp = eventos.find((e) => e.competencia)?.competencia ?? null;
    let proventos = 0, descontos = 0, semValor = 0;
    for (const e of eventos) {
      if (e.valor == null) { if (e.classe !== "informativo") semValor++; continue; }
      if (e.classe === "provento") proventos += e.valor;
      else if (e.classe === "desconto") descontos += Math.abs(e.valor);
    }
    eventos.sort((a, b) => ordemClasse(a.classe) - ordemClasse(b.classe) || (a.codigo ?? 0) - (b.codigo ?? 0));
    out.push({
      chave, empresa: p.empresa, matricula: p.matricula, calculo: p.calculo, pagamento: p.pagamento,
      mesPagamento: p.pagamento.slice(0, 7), competencia: comp ?? p.pagamento.slice(0, 7), competenciaEstimada: !comp,
      tipcal, tipo: tipoDaFolha(eventos, tipcal), eventos,
      proventos: arred(proventos), descontos: arred(descontos), liquido: arred(proventos - descontos), semValor,
    });
  }
  return out.sort((a, b) => b.pagamento.localeCompare(a.pagamento) || (b.calculo ?? 0) - (a.calculo ?? 0));
}

const ordemClasse = (c: ClasseEvento) => (c === "provento" ? 0 : c === "desconto" ? 1 : 2);

export interface FiltroFicha {
  /** AAAA-MM inclusive (mês de pagamento). */
  de?: string | null;
  ate?: string | null;
  /** Vazio = todos. */
  tipos?: TipoFolha[];
}

export function filtrarCalculos(calculos: CalculoFicha[], f: FiltroFicha): CalculoFicha[] {
  const tipos = f.tipos?.length ? new Set(f.tipos) : null;
  return calculos.filter((c) =>
    (!f.de || c.mesPagamento >= f.de) && (!f.ate || c.mesPagamento <= f.ate) && (!tipos || tipos.has(c.tipo)));
}

export interface MesFicha { mes: string; proventos: number; descontos: number; liquido: number; calculos: number }
export interface ResumoFicha {
  proventos: number;
  descontos: number;
  /** Total recebido (líquido) no período filtrado. */
  liquido: number;
  /** Líquido do ano `ano` (pelos mesmos filtros de tipo, ignorando o período). */
  ano: number;
  liquidoAno: number;
  /** Líquido ÷ meses com pagamento no período (mês sem pagamento não puxa a média para baixo). */
  mediaMensal: number;
  meses: MesFicha[];
  calculos: number;
  semValor: number;
}

/**
 * Totais. `todos` são os cálculos carregados (para o total do ano); `noPeriodo`
 * os que passaram no filtro. `ano` padrão: o do último pagamento do período.
 */
export function resumir(noPeriodo: CalculoFicha[], todos: CalculoFicha[], tipos: TipoFolha[] = [], ano?: number): ResumoFicha {
  const porMes = new Map<string, MesFicha>();
  let proventos = 0, descontos = 0, semValor = 0;
  for (const c of noPeriodo) {
    proventos += c.proventos; descontos += c.descontos; semValor += c.semValor;
    const m = porMes.get(c.mesPagamento) ?? { mes: c.mesPagamento, proventos: 0, descontos: 0, liquido: 0, calculos: 0 };
    m.proventos = arred(m.proventos + c.proventos);
    m.descontos = arred(m.descontos + c.descontos);
    m.liquido = arred(m.liquido + c.liquido);
    m.calculos++;
    porMes.set(c.mesPagamento, m);
  }
  const liquido = arred(proventos - descontos);
  const anoRef = ano ?? (noPeriodo.length
    ? Math.max(...noPeriodo.map((c) => Number(c.mesPagamento.slice(0, 4))))
    : new Date().getFullYear());
  const doAno = filtrarCalculos(todos, { de: `${anoRef}-01`, ate: `${anoRef}-12`, tipos });
  const liquidoAno = arred(doAno.reduce((s, c) => s + c.liquido, 0));
  const meses = [...porMes.values()].sort((a, b) => b.mes.localeCompare(a.mes));
  return {
    proventos: arred(proventos), descontos: arred(descontos), liquido,
    ano: anoRef, liquidoAno,
    mediaMensal: meses.length ? arred(liquido / meses.length) : 0,
    meses, calculos: noPeriodo.length, semValor,
  };
}

export interface EventoSomado { codigo: number | null; descricao: string; classe: ClasseEvento; vezes: number; total: number }

/** Quanto cada evento somou no período — "quanto já recebeu de hora extra". */
export function somarPorEvento(calculos: CalculoFicha[]): EventoSomado[] {
  const m = new Map<string, EventoSomado>();
  for (const c of calculos) for (const e of c.eventos) {
    const k = `${e.codigo}|${e.classe}`;
    const s = m.get(k) ?? { codigo: e.codigo, descricao: e.descricao, classe: e.classe, vezes: 0, total: 0 };
    s.vezes++;
    s.total = arred(s.total + Math.abs(e.valor ?? 0));
    m.set(k, s);
  }
  return [...m.values()].sort((a, b) => ordemClasse(a.classe) - ordemClasse(b.classe) || b.total - a.total);
}

// ── Formatação ──────────────────────────────────────────────────────
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const rotuloMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1] ?? "?"}/${m.slice(0, 4)}`;
export const fmtMoeda = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const fmtRef = (v: number | null | undefined) =>
  v == null ? "" : v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const fmtData = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—";
