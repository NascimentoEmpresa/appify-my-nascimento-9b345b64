// =====================================================================
// CONFERÊNCIA DE 13º — o fluxo, longe do React
//
// Clone adaptado da Conferência de Ponto (src/lib/conferenciaPonto/
// conferencia.ts), 12/11/2026. Pedido do Pablo: "tira a parte do
// operacional e encarregados, vai ser apenas do RH e depois Financeiro. O
// décimo não depende do operacional."
//
// Uma linha por CONTRATO por PARCELA (1ª e 2ª separadas) por ANO:
//
//   Pendente RH → Em Conferência RH → Conferido RH
//        → Liberado Financeiro → Pago
//        ↘ Devolvido RH (o Financeiro devolve, com motivo)
//        ↘ Problema (o Financeiro marca, com motivo; continua com ele)
//
// O valor o RH digita ou importa da planilha da Senior (linhasDaPlanilha,
// abaixo; o banco acha o contrato) — a importação só grava enquanto o
// contrato está com o RH. Contratos: os ATIVOS da Licitação (mig
// 20261113001000), não mais o CONTRATOS da Senior.
//
// DIFERENÇA DE DESENHO EM RELAÇÃO AO PONTO: lá a tabela é aberta e a regra
// vive só na tela. Aqui a tabela é só leitura e toda escrita passa pelas RPCs
// `decimo_agir` / `decimo_importar_valores`, que repetem ORIGENS/DESTINO/
// MENU_DA_ACAO no banco (mig 20261112220000). Mudou aqui, muda lá.
//
// Testado em src/test/conferencia-decimo.test.ts.
// =====================================================================

import { ehDiaUtil } from "@/lib/conferenciaPonto/conferencia";

export { fmtBRL, fmtDataHora, faltaPara, pct } from "@/lib/conferenciaPonto/conferencia";

export const TABELA = "SISTEMA_CONFERENCIA_DECIMO";
export const TABELA_EVENTOS = "SISTEMA_CONFERENCIA_DECIMO_EVENTOS";

// ── Status ───────────────────────────────────────────────────────────
export type StatusDecimo =
  | "Pendente RH"
  | "Em Conferência RH"
  | "Conferido RH"
  | "Liberado Financeiro"
  | "Pago"
  | "Devolvido RH"
  | "Problema";

/** Contrato sem linha na parcela: a linha nasce na primeira ação. */
export const STATUS_INICIAL: StatusDecimo = "Pendente RH";

export const STATUS_TODOS: StatusDecimo[] = [
  "Pendente RH", "Em Conferência RH", "Conferido RH",
  "Liberado Financeiro", "Pago", "Devolvido RH", "Problema",
];

export type Parcela = 1 | 2;
export const rotuloParcela = (p: Parcela) => (p === 1 ? "1ª parcela" : "2ª parcela");

// ── As chaves de acesso ──────────────────────────────────────────────
/** Menus liberados em Administração › Acesso por Usuário. Nascem sem ninguém. */
export const MENU = {
  telaRh:         "rh_conferencia_decimo",
  telaFinanceiro: "financeiro_conferencia_decimo",
  confirmar:      "decimo_confirmar_conferencia",
  valor:          "decimo_informar_valor",
  pagar:          "decimo_marcar_pago",
} as const;

export type Acao =
  | "andamento" | "confirmar" | "reabrir"
  | "informar_valor" | "liberar"
  | "marcar_pago" | "devolver_rh" | "problema";

/**
 * Quem pode cada ação. Devolver é poder de quem RECEBEU (o Financeiro), como
 * no ponto — senão a fila seria empurrada de volta por quem nunca a teve.
 */
export const MENU_DA_ACAO: Record<Acao, string> = {
  andamento:      MENU.confirmar,
  confirmar:      MENU.confirmar,
  reabrir:        MENU.confirmar,
  informar_valor: MENU.valor,
  liberar:        MENU.valor,
  marcar_pago:    MENU.pagar,
  devolver_rh:    MENU.pagar,
  problema:       MENU.pagar,
};

/** Status que a ação produz; null = não muda o status (só grava o valor). */
const DESTINO: Record<Acao, StatusDecimo | null> = {
  andamento:      "Em Conferência RH",
  confirmar:      "Conferido RH",
  reabrir:        "Em Conferência RH",
  informar_valor: null,
  liberar:        "Liberado Financeiro",
  marcar_pago:    "Pago",
  devolver_rh:    "Devolvido RH",
  problema:       "Problema",
};

/** Status em que o contrato ainda está com o RH — e o valor ainda muda. */
export const ETAPA_RH: StatusDecimo[] = ["Pendente RH", "Em Conferência RH", "Conferido RH", "Devolvido RH"];

const ORIGENS: Record<Acao, StatusDecimo[]> = {
  andamento:      ["Pendente RH", "Devolvido RH"],
  confirmar:      ["Pendente RH", "Em Conferência RH", "Devolvido RH"],
  // Desfaz o "conferido" por engano, antes de liberar.
  reabrir:        ["Conferido RH"],
  informar_valor: ETAPA_RH,
  // Liberar exige a conferência confirmada — é o número que vira pagamento.
  liberar:        ["Conferido RH"],
  // Problema continua com o Financeiro: resolve e paga, ou devolve ao RH.
  marcar_pago:    ["Liberado Financeiro", "Problema"],
  devolver_rh:    ["Liberado Financeiro", "Problema"],
  problema:       ["Liberado Financeiro"],
};

/** A ação vale no status atual? */
export const acaoValeEm = (atual: StatusDecimo, acao: Acao) => ORIGENS[acao].includes(atual);

/** Para onde vai (o mesmo status, se a ação não o muda), ou null se não vale. */
export function proximoStatus(atual: StatusDecimo, acao: Acao): StatusDecimo | null {
  if (!acaoValeEm(atual, acao)) return null;
  return DESTINO[acao] ?? atual;
}

/** Por qual porta a pessoa entrou. Só duas: o 13º não passa pelo Operacional. */
export type Modulo = "rh" | "financeiro";

/** Onde o botão aparece — cada setor vê só o próprio passo, como no ponto. */
export const MODULO_DA_ACAO: Record<Acao, Modulo> = {
  andamento:      "rh",
  confirmar:      "rh",
  reabrir:        "rh",
  informar_valor: "rh",
  liberar:        "rh",
  marcar_pago:    "financeiro",
  devolver_rh:    "financeiro",
  problema:       "financeiro",
};

/** Módulo + chave + status. `pode` é o `can()` do PermissoesContext. */
export function podeAgir(
  atual: StatusDecimo,
  acao: Acao,
  pode: (menu: string) => boolean,
  modulo: Modulo,
): boolean {
  if (MODULO_DA_ACAO[acao] !== modulo) return false;
  if (!pode(MENU_DA_ACAO[acao])) return false;
  return acaoValeEm(atual, acao);
}

/** Ações que contam como "aguardando você" (andamento e reabrir não). */
export const ACOES_PRINCIPAIS: Acao[] = ["confirmar", "liberar", "marcar_pago"];

// ── Dono da bola e avanço ────────────────────────────────────────────
export type Etapa = "rh" | "financeiro" | "fim";

export function etapaDoStatus(s: StatusDecimo): Etapa {
  if (s === "Pago") return "fim";
  if (s === "Liberado Financeiro" || s === "Problema") return "financeiro";
  return "rh";
}

/**
 * O avanço acumulado, como no ponto: o RH "já fez" o que foi liberado ou
 * além; o Financeiro, o que foi pago. "Conferido RH" ainda não conta para o
 * RH — falta liberar.
 */
export function contaAvanco(status: StatusDecimo[]): { rh: number; financeiro: number; total: number } {
  return {
    rh:         status.filter(s => etapaDoStatus(s) !== "rh").length,
    financeiro: status.filter(s => s === "Pago").length,
    total:      status.length,
  };
}

// ── Aparência ────────────────────────────────────────────────────────
export function corDoStatus(s: string): string {
  const cores: Record<string, string> = {
    "Pendente RH":         "bg-orange-100 text-orange-800 border-orange-200",
    "Em Conferência RH":   "bg-violet-100 text-violet-800 border-violet-200",
    "Conferido RH":        "bg-sky-100 text-sky-800 border-sky-200",
    "Liberado Financeiro": "bg-indigo-100 text-indigo-800 border-indigo-200",
    "Pago":                "bg-emerald-100 text-emerald-800 border-emerald-200",
    "Devolvido RH":        "bg-red-100 text-red-800 border-red-200",
    "Problema":            "bg-red-200 text-red-900 border-red-300",
  };
  return cores[s] ?? "bg-blue-100 text-blue-700 border-blue-200";
}

export function explicaStatus(s: string): string {
  const t: Record<string, string> = {
    "Pendente RH":         "Aguardando o RH conferir o 13º do contrato.",
    "Em Conferência RH":   "O RH está conferindo.",
    "Conferido RH":        "Conferência confirmada. Falta o valor e liberar ao Financeiro.",
    "Liberado Financeiro": "Valor liberado. Aguardando o Financeiro pagar.",
    "Pago":                "Parcela paga. Contrato fechado nesta parcela.",
    "Devolvido RH":        "Devolvido pelo Financeiro ao RH — veja o motivo.",
    "Problema":            "O Financeiro marcou problema no pagamento — veja o motivo.",
  };
  return t[s] ?? "";
}

const PRIORIDADE: Record<string, number> = {
  "Problema": 1, "Devolvido RH": 2, "Pendente RH": 3, "Em Conferência RH": 4,
  "Conferido RH": 5, "Liberado Financeiro": 6, "Pago": 9,
};
export const ordemDoStatus = (s: string) => PRIORIDADE[s] ?? 99;

// ── O registro ───────────────────────────────────────────────────────
/** Uma pessoa ativa ligada ao contrato (rh_ac_ativos, a ligação do Ativos/Contratos). */
export interface PessoaDecimo {
  cadastro: string | null;
  nome: string;
  cargo: string | null;
  situacao: string | null;
  admissao: string | null;
}

/** O contrato como decimo_contratos() devolve — da LICITAÇÃO, não da Senior (13/11/2026). */
export interface ContratoDecimo {
  contrato_id: string;
  nome: string;
  cliente: string | null;
  empresa: string | null;
  status_contrato: "ativo" | "suspenso" | "encerrado" | string;
  pessoas: PessoaDecimo[];
}

export interface LinhaDecimo {
  /** null enquanto ninguém agiu no contrato nesta parcela. */
  id: number | null;
  /** Contrato da Licitação (public.contratos). Desde a mig 20261113001000. */
  contrato_id: string;
  contrato_nome: string | null;
  nome_empresa: string | null;
  cliente?: string | null;
  status_contrato?: string;
  pessoas?: PessoaDecimo[];
  ano: number;
  parcela: Parcela;
  status: StatusDecimo;
  valor: number | null;
  qtd_colaboradores: number | null;
  valor_origem: "manual" | "planilha" | null;
  planilha_nome: string | null;
  devolucao_motivo: string | null;
  conferindo_por: string | null; conferindo_em: string | null;
  confirmado_por: string | null; confirmado_em: string | null;
  valor_por: string | null;      valor_em: string | null;
  liberado_por: string | null;   liberado_em: string | null;
  pago_por: string | null;       pago_em: string | null;
  atualizado_em: string | null;
  atualizado_por: string | null;
}

export interface EventoDecimo {
  id: number;
  conferencia_id: number;
  acao: string;
  de_status: string | null;
  para_status: string | null;
  observacao: string | null;
  usuario_nome: string | null;
  criado_em: string;
}

// ── Competência e prazo ──────────────────────────────────────────────
/**
 * A parcela que se confere agora: até novembro é a 1ª; de dezembro em diante,
 * a 2ª. Em janeiro ainda se fecha o 13º do ano que passou — o ano padrão
 * volta um.
 */
export function competenciaPadrao(hoje = new Date()): { ano: number; parcela: Parcela } {
  const m = hoje.getMonth() + 1;
  if (m === 1) return { ano: hoje.getFullYear() - 1, parcela: 2 };
  return { ano: hoje.getFullYear(), parcela: m === 12 ? 2 : 1 };
}

/**
 * O prazo legal de pagamento (Lei 4.749/65): 1ª parcela até 30/11, 2ª até
 * 20/12. Caindo em fim de semana ou feriado, o pagamento tem que ser
 * ANTECIPADO — então o prazo é o último dia útil até a data, às 17h.
 */
export function prazoDaParcela(ano: number, parcela: Parcela): Date {
  const d = parcela === 1 ? new Date(ano, 10, 30) : new Date(ano, 11, 20);
  while (!ehDiaUtil(d)) d.setDate(d.getDate() - 1);
  d.setHours(17, 0, 0, 0);
  return d;
}

// ── Importação da planilha da Senior ─────────────────────────────────
/** "Valor Líquido 13º" → "valor liquido 13o" — para casar cabeçalho. */
export function normalizaCabecalho(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/º|ª/g, "o").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Número de célula: número do Excel, "1.234,56", "1234.56" ou "R$ 1.234,56". */
export function numeroDaCelula(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v ?? "").replace(/[R$\s]/g, "").trim();
  if (!s) return null;
  const negativo = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

/** Código de empresa/filial: 10, "10" ou "10 - PREFEITURA A" (a Senior junta). */
export function codigoDaCelula(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  const m = String(v ?? "").trim().match(/^(\d+)(\s*[-–:]\s*.*|\s+.*)?$/);
  return m ? Number(m[1]) : null;
}

const ehEmpresa  = (h: string) => /^(cod(igo)? )?(empresa|emp|numemp|codemp)$/.test(h) || h === "codigo da empresa";
const ehFilial   = (h: string) => /^(cod(igo)? )?(filial|fil|codfil)$/.test(h) || h === "codigo da filial";
const ehCadastro = (h: string) => /^(cadastro|matricula|numcad|cad|codigo do colaborador|cod colaborador)$/.test(h);
const ehQtd      = (h: string) => /^(qtd|quantidade|qtde)( de)?( colaboradores| funcionarios| empregados)?$/.test(h) || h === "colaboradores";

/** Ordem de preferência da coluna de valor quando a planilha tem várias. */
function pesoDoValor(h: string): number {
  if (!h || ehEmpresa(h) || ehFilial(h) || ehCadastro(h) || ehQtd(h)) return 0;
  if (/liquido/.test(h)) return 5;
  if (/(13|decimo)/.test(h) && /(valor|vlr|total)/.test(h)) return 4;
  if (/^(valor|vlr)$/.test(h)) return 3;
  if (/(valor|vlr)/.test(h)) return 2;
  if (/total/.test(h)) return 1;
  return 0;
}

export interface CabecalhoPlanilha {
  linhaCabecalho: number;
  colunas: string[];
  colEmpresa: number | null;
  colFilial: number;
  colCadastro: number | null;
  colQtd: number | null;
  /** Colunas que podem ser o valor, na ordem de preferência. A tela deixa trocar. */
  candidatasValor: number[];
}

/**
 * Acha o cabeçalho nas primeiras 15 linhas: a primeira que tem uma coluna de
 * filial e pelo menos uma de valor. Relatório da Senior costuma vir com
 * título e filtros antes da tabela.
 */
export function acharCabecalho(linhas: unknown[][]): CabecalhoPlanilha | null {
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const cols = (linhas[i] ?? []).map(normalizaCabecalho);
    const colFilial = cols.findIndex(ehFilial);
    if (colFilial < 0) continue;
    const candidatasValor = cols.map((h, j) => [j, pesoDoValor(h)] as const)
      .filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([j]) => j);
    if (!candidatasValor.length) continue;
    const achar = (f: (h: string) => boolean) => { const j = cols.findIndex(f); return j >= 0 ? j : null; };
    return {
      linhaCabecalho: i,
      colunas: (linhas[i] ?? []).map(c => String(c ?? "")),
      colEmpresa: achar(ehEmpresa),
      colFilial,
      colCadastro: achar(ehCadastro),
      colQtd: achar(ehQtd),
      candidatasValor,
    };
  }
  return null;
}

/** Uma linha da planilha como vai para decimo_importar_valores. */
export interface LinhaPlanilhaDecimo {
  empresa: number | null;
  filial: number;
  cadastro: string | null;
  valor: number;
  qtd: number | null;
}

/**
 * Lê as linhas da planilha (`sheet_to_json(..., { header: 1 })`) SEM somar.
 *
 * Desde 13/11/2026 quem acha o contrato é o banco: a lista do 13º é dos
 * contratos da LICITAÇÃO, e o elo entre a filial/matrícula da Senior e o
 * contrato da Licitação é o mesmo do RH › Ativos/Contratos (rh_ac_ativos),
 * que só existe lá. A tela manda as linhas cruas e mostra a prévia que
 * `decimo_importar_valores(..., p_simular := true)` devolve.
 *
 * Fica de fora o que não tem filial ou valor (título, total, linha vazia).
 */
export function linhasDaPlanilha(
  linhas: unknown[][],
  cab: CabecalhoPlanilha,
  colValor: number,
): { linhas: LinhaPlanilhaDecimo[]; ignoradas: number; total: number } {
  const out: LinhaPlanilhaDecimo[] = [];
  let ignoradas = 0;
  for (const linha of linhas.slice(cab.linhaCabecalho + 1)) {
    const filial = codigoDaCelula(linha?.[cab.colFilial]);
    const valor = numeroDaCelula(linha?.[colValor]);
    if (filial == null || valor == null || valor === 0) { ignoradas++; continue; }
    const cad = cab.colCadastro != null ? String(linha?.[cab.colCadastro] ?? "").trim() : "";
    out.push({
      empresa: cab.colEmpresa != null ? codigoDaCelula(linha?.[cab.colEmpresa]) : null,
      filial,
      cadastro: /^\d+$/.test(cad) ? cad : null,
      valor: Math.round(valor * 100) / 100,
      qtd: cab.colQtd != null ? numeroDaCelula(linha?.[cab.colQtd]) : null,
    });
  }
  return { linhas: out, ignoradas, total: Math.round(out.reduce((t, l) => t + l.valor * 100, 0)) / 100 };
}

// ── Situação das pessoas do contrato ─────────────────────────────────
/** "Trabalhando" conta como em atividade; o resto (Auxílio Doença, Férias…) é situação a olhar. */
export const emAtividade = (situacao?: string | null) => /^trabalhando$/i.test(String(situacao ?? "").trim());

/** [{ situacao, n }] — Trabalhando primeiro, depois do maior para o menor. */
export function resumoSituacoes(pessoas: PessoaDecimo[]): { situacao: string; n: number }[] {
  const m = new Map<string, number>();
  for (const p of pessoas) {
    const s = String(p.situacao ?? "").trim() || "Sem situação";
    m.set(s, (m.get(s) ?? 0) + 1);
  }
  return [...m.entries()].map(([situacao, n]) => ({ situacao, n }))
    .sort((a, b) => Number(emAtividade(b.situacao)) - Number(emAtividade(a.situacao)) || b.n - a.n || a.situacao.localeCompare(b.situacao));
}

/**
 * O alerta do contrato na lista. Pedido do Pablo: "tem uns que tem só uma
 * pessoa com aux doença, aí tem que mostrar essa situação". Sem ninguém
 * trabalhando o alerta é forte; com parte afastada, informativo.
 */
export function alertaDoContrato(pessoas: PessoaDecimo[]): { nivel: "forte" | "info"; texto: string } | null {
  if (!pessoas.length) return { nivel: "forte", texto: "Nenhuma pessoa ativa ligada ao contrato" };
  const fora = resumoSituacoes(pessoas).filter(s => !emAtividade(s.situacao));
  if (!fora.length) return null;
  const texto = fora.map(s => `${s.n} em ${s.situacao}`).join(" · ");
  return pessoas.every(p => !emAtividade(p.situacao))
    ? { nivel: "forte", texto: `Ninguém trabalhando: ${texto}` }
    : { nivel: "info", texto };
}
