// SIS-2026-0658: conciliação da origem dos dados (Sistema × Excel antigo). Regras puras das duas telas.

export type OrigemBase = "sistema" | "excel";

export interface ResumoBase {
  qtd: number;
  /** soma com sinal (Fluxo: entradas − saídas; Relatório de Serviços: valor líquido). */
  valor: number;
  entradas: number;
  saidas: number;
  /** menor e maior data das linhas (yyyy-mm-dd) */
  de: string | null;
  ate: string | null;
}

export interface Conciliacao {
  total: ResumoBase;
  sistema: ResumoBase;
  excel: ResumoBase;
  /** total − sistema − excel: zero quando toda linha pertence a exatamente uma origem. */
  diferenca: number;
}

export interface Leitura<L> {
  origem: (l: L) => OrigemBase;
  /** valor com sinal da linha */
  valor: (l: L) => number;
  data: (l: L) => string | null;
  /** false = linha aparece na lista mas não entra nos valores (ex.: NF cancelada); default true */
  contabiliza?: (l: L) => boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function vazio(): ResumoBase {
  return { qtd: 0, valor: 0, entradas: 0, saidas: 0, de: null, ate: null };
}

function somar(r: ResumoBase, valor: number, data: string | null, contabiliza: boolean) {
  r.qtd += 1;
  if (contabiliza) {
    r.valor += valor;
    if (valor >= 0) r.entradas += valor;
    else r.saidas += -valor;
  }
  if (data) {
    if (!r.de || data < r.de) r.de = data;
    if (!r.ate || data > r.ate) r.ate = data;
  }
}

function fechar(r: ResumoBase): ResumoBase {
  return { ...r, valor: r2(r.valor), entradas: r2(r.entradas), saidas: r2(r.saidas) };
}

/** Total, Sistema e Excel da mesma lista. O total é somado direto da lista, não das duas partes. */
export function conciliar<L>(linhas: L[], leitura: Leitura<L>): Conciliacao {
  const total = vazio();
  const sistema = vazio();
  const excel = vazio();
  for (const l of linhas) {
    const valor = leitura.valor(l);
    const data = leitura.data(l);
    const conta = leitura.contabiliza ? leitura.contabiliza(l) : true;
    somar(total, valor, data, conta);
    somar(leitura.origem(l) === "excel" ? excel : sistema, valor, data, conta);
  }
  const t = fechar(total);
  const s = fechar(sistema);
  const e = fechar(excel);
  return { total: t, sistema: s, excel: e, diferenca: r2(t.valor - s.valor - e.valor) };
}

/** Origem do Fluxo: a planilha antiga é a origem 'importacao_historica'; todo o resto é do sistema. */
export function origemDoFluxo(origemLinha: string): OrigemBase {
  return origemLinha === "importacao_historica" ? "excel" : "sistema";
}

/** Origem da NF: coluna `origem` (sistema | excel_antigo); sem a coluna (migration pendente) usa created_by nulo = planilha. */
export function origemDaNf(n: { origem?: string | null; created_by?: string | null }): OrigemBase {
  if (n.origem) return n.origem === "excel_antigo" ? "excel" : "sistema";
  return n.created_by ? "sistema" : "excel";
}

export interface SituacaoPlanilha {
  situacao: string;
  qtd: number;
  entradas: number;
  saidas: number;
}

export const ROTULO_SITUACAO_PLANILHA: Record<string, string> = {
  em_uso: "Em uso no Fluxo de Caixa",
  ja_existe_no_erp: "Ocultas: o ERP já tinha o lançamento (ago/set)",
  excluida_na_carga: "Excluídas pela carga/conferência",
  excluida_por_usuario: "Excluídas por usuário (lixeira do Fluxo)",
};

export interface ConferenciaPlanilha {
  carregada: { qtd: number; valor: number };
  emUso: { qtd: number; valor: number };
  /** valor em uso na planilha − valor que a tela do Fluxo mostra como Excel; ≠ 0 = há valores ajustados. */
  diferencaComTela: number;
  linhas: (SituacaoPlanilha & { valor: number })[];
}

/** Fecha as contas da planilha carregada: tudo o que subiu = em uso + ocultas + excluídas. */
export function conferirPlanilha(resumo: SituacaoPlanilha[], valorExcelNaTela: number): ConferenciaPlanilha {
  const ordem = Object.keys(ROTULO_SITUACAO_PLANILHA);
  const linhas = [...resumo]
    .map((s) => ({ ...s, valor: r2(s.entradas - s.saidas) }))
    .sort((a, b) => ordem.indexOf(a.situacao) - ordem.indexOf(b.situacao));
  const soma = (f: (s: (typeof linhas)[number]) => number) => r2(linhas.reduce((t, s) => t + f(s), 0));
  const uso = linhas.find((s) => s.situacao === "em_uso");
  return {
    carregada: { qtd: linhas.reduce((t, s) => t + s.qtd, 0), valor: soma((s) => s.valor) },
    emUso: { qtd: uso?.qtd ?? 0, valor: uso?.valor ?? 0 },
    diferencaComTela: r2((uso?.valor ?? 0) - valorExcelNaTela),
    linhas,
  };
}

// ── SIS-2026-0701: ponte da planilha importada com o que o ERP lê, mês a mês ─────────────────────────────────
export type BasePonte = "pagamento" | "competencia";

export interface SituacaoPlanilhaMes extends SituacaoPlanilha {
  /** yyyy-mm-01 */
  mes: string;
}

export interface LinhaPonteMes {
  mes: string; // yyyy-mm
  /** planilha carregada (todas as linhas, em uso ou não) */
  planilha: { qtd: number; entradas: number; saidas: number };
  /** parte da planilha que está em uso no Fluxo (valor da carga) */
  emUso: { qtd: number; entradas: number; saidas: number };
  /** ocultas (o ERP já tinha) + excluídas: a planilha tem, o Fluxo não mostra */
  foraDoUso: { qtd: number; entradas: number; saidas: number };
  /** o que a tela do Fluxo de Caixa lê como "Excel antigo" no mês */
  erpLe: { qtd: number; entradas: number; saidas: number };
  /** em uso − o que o ERP lê: diferente de zero = valor ajustado no Fluxo ou linha que a tela não mostra */
  difEntradas: number;
  difSaidas: number;
}

const zero3 = () => ({ qtd: 0, entradas: 0, saidas: 0 });

/**
 * Junta, por mês, a planilha carregada (situações) com as linhas "Excel antigo" que o Fluxo de Caixa lê. Os dois lados usam a mesma
 * base (data de pagamento ou competência). Meses só de um dos lados também aparecem.
 */
export function ponteDaPlanilhaPorMes(
  planilha: SituacaoPlanilhaMes[],
  fluxoExcel: { tipo: "entrada" | "saida"; valor: number; data_pagamento: string | null; competencia: string | null }[],
  base: BasePonte,
): LinhaPonteMes[] {
  const meses = new Map<string, LinhaPonteMes>();
  const doMes = (mes: string): LinhaPonteMes => {
    let l = meses.get(mes);
    if (!l) {
      l = { mes, planilha: zero3(), emUso: zero3(), foraDoUso: zero3(), erpLe: zero3(), difEntradas: 0, difSaidas: 0 };
      meses.set(mes, l);
    }
    return l;
  };
  for (const s of planilha) {
    const l = doMes(s.mes.slice(0, 7));
    const alvos = [l.planilha, s.situacao === "em_uso" ? l.emUso : l.foraDoUso];
    for (const a of alvos) { a.qtd += s.qtd; a.entradas += s.entradas; a.saidas += s.saidas; }
  }
  for (const f of fluxoExcel) {
    const data = base === "competencia" ? f.competencia : f.data_pagamento;
    if (!data) continue;
    const l = doMes(data.slice(0, 7));
    l.erpLe.qtd += 1;
    if (f.tipo === "entrada") l.erpLe.entradas += Number(f.valor) || 0; else l.erpLe.saidas += Number(f.valor) || 0;
  }
  const arred = (n: number) => Math.round(n * 100) / 100;
  return Array.from(meses.values())
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .map((l) => {
      for (const g of [l.planilha, l.emUso, l.foraDoUso, l.erpLe]) { g.entradas = arred(g.entradas); g.saidas = arred(g.saidas); }
      return { ...l, difEntradas: arred(l.emUso.entradas - l.erpLe.entradas), difSaidas: arred(l.emUso.saidas - l.erpLe.saidas) };
    });
}

// ── SIS-2026-0701: explicar a diferença do mês pelos ajustes feitos no Fluxo depois da carga ─────────────────────
export interface DiferencaDaLinha {
  tipo_planilha: "entrada" | "saida";
  valor_planilha: number;
  data_planilha: string;
  competencia_planilha: string;
  tipo_erp: "entrada" | "saida";
  valor_erp: number;
  data_erp: string;
  competencia_erp: string;
}

export type CategoriaDiferenca = "estorno" | "tipo" | "valor" | "mes";

export const ROTULO_CATEGORIA_DIFERENCA: Record<CategoriaDiferenca, string> = {
  estorno: "Estornos reclassificados (valor negativo na planilha virou positivo no ERP)",
  tipo: "Entrada/saída corrigida no ERP",
  valor: "Valor corrigido no ERP",
  mes: "Lançamento que mudou de mês",
};

/** A planilha guarda estorno como valor negativo; no ERP o ajuste costuma virar valor positivo (muitas vezes como o outro tipo). */
export function categoriaDaDiferenca(d: DiferencaDaLinha): CategoriaDiferenca {
  if (d.valor_planilha !== 0 && d.valor_planilha === -d.valor_erp) return "estorno";
  if (d.tipo_planilha !== d.tipo_erp) return "tipo";
  if (d.valor_planilha !== d.valor_erp) return "valor";
  return "mes";
}

export interface EfeitoDasDiferencas {
  qtd: number;
  /** quanto o ERP lê a mais (ou a menos) que a planilha neste mês por causa dessas linhas */
  entradas: number;
  saidas: number;
  porCategoria: Partial<Record<CategoriaDiferenca, { qtd: number; entradas: number; saidas: number }>>;
}

/** Efeito, num mês, das linhas ajustadas: soma do que o ERP lê no mês menos o que a planilha tinha no mês (mesma base da ponte). */
export function efeitoDasDiferencas(linhas: DiferencaDaLinha[], mes: string, base: BasePonte): EfeitoDasDiferencas {
  const r2c = (n: number) => Math.round(n * 100) / 100;
  const out: EfeitoDasDiferencas = { qtd: 0, entradas: 0, saidas: 0, porCategoria: {} };
  for (const d of linhas) {
    const naPlanilha = (base === "competencia" ? d.competencia_planilha : d.data_planilha).slice(0, 7) === mes;
    const noErp = (base === "competencia" ? d.competencia_erp : d.data_erp).slice(0, 7) === mes;
    if (!naPlanilha && !noErp) continue;
    let entradas = 0, saidas = 0;
    if (noErp) { if (d.tipo_erp === "entrada") entradas += d.valor_erp; else saidas += d.valor_erp; }
    if (naPlanilha) { if (d.tipo_planilha === "entrada") entradas -= d.valor_planilha; else saidas -= d.valor_planilha; }
    const cat = categoriaDaDiferenca(d);
    const c = (out.porCategoria[cat] ??= { qtd: 0, entradas: 0, saidas: 0 });
    c.qtd += 1; c.entradas = r2c(c.entradas + entradas); c.saidas = r2c(c.saidas + saidas);
    out.qtd += 1; out.entradas = r2c(out.entradas + entradas); out.saidas = r2c(out.saidas + saidas);
  }
  return out;
}
