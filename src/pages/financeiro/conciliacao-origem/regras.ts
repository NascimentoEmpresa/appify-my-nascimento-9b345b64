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
