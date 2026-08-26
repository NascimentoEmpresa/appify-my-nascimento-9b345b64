// =====================================================================
// TROCA DE FUNÇÃO — o fluxo, longe do React
//
// Encarregado abre → alguém aprova → SST marca o ASO → RH altera na
// Senior. Quem aprova depende de ONDE a pessoa trabalha: contrato vai
// para o Operacional, escritório vai para a dupla do administrativo.
//
//   Pendente Operacional ─┐
//                         ├→ Pendente SST → Pendente RH → Concluída
//   Pendente Escritório  ─┘
//          ↘ Reprovada (em qualquer uma das duas)
//
// Testado em src/test/troca-funcao.test.ts.
// =====================================================================

export const TABELA = "SISTEMA_SOLICITACOES_TROCA_FUNCAO";

export type StatusTroca =
  | "Pendente Operacional"
  | "Pendente Escritório"
  | "Pendente SST"
  | "Pendente RH"
  | "Concluída"
  | "Reprovada";

/** A etapa é o papel de quem está olhando a fila. */
export type Etapa = "operacional" | "escritorio" | "sst" | "rh";

export interface SolicitacaoTroca {
  id: number;
  solicitante_nome: string | null;
  solicitante_email: string | null;
  colaborador_id: number | null;
  colaborador_nome: string | null;
  colaborador_cpf: string | null;
  colaborador_admissao: string | null;
  /** Cargo de hoje, puxado de EMPREGADOS — o encarregado não digita. */
  cargo_atual: string | null;
  cargo_novo: string | null;
  local: string | null;
  posto: string | null;
  filial: string | null;
  /** true = escritório (aprova a dupla do administrativo); false = contrato. */
  e_escritorio: boolean;
  motivo: string | null;
  data_pretendida: string | null;
  status: StatusTroca;
  aprovador_nome: string | null;
  aprovador_em: string | null;
  aprovador_motivo: string | null;
  sst_por: string | null;
  sst_em: string | null;
  sst_aso_data: string | null;
  sst_observacao: string | null;
  rh_por: string | null;
  rh_em: string | null;
  rh_observacao: string | null;
  criado_em: string;
  atualizado_em: string | null;
}

/**
 * Locais que contam como ESCRITÓRIO.
 *
 * Sai da coluna "Descrição do Local" da EMPREGADOS. Conferido no banco em
 * 25/08/2026: 61 pessoas em ADMINISTRATIVO e 18 em "ESCRITÓRI0" — que está
 * grafado com ZERO no lugar do O, erro de digitação do cadastro que não dá
 * para corrigir daqui (a EMPREGADOS é espelho do Senior). Por isso a
 * comparação normaliza acento e caixa E trata o zero: escrever a variação
 * errada na lista resolveria hoje e quebraria no dia em que alguém
 * corrigisse o cadastro.
 *
 * Todo o resto — UFRGS, SAMU, prefeituras, hospitais — é contrato.
 */
const LOCAIS_ESCRITORIO = ["ADMINISTRATIVO", "ESCRITORIO"];

/** Sem acento, sem espaço sobrando, maiúsculo, e com 0 lido como O. */
export function normalizarLocal(local?: string | null): string {
  return String(local ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/0/g, "O")
    .replace(/\s+/g, " ")
    .trim();
}

export function localEhEscritorio(local?: string | null): boolean {
  const n = normalizarLocal(local);
  if (!n) return false;   // sem local, trata como contrato (é a maioria)
  return LOCAIS_ESCRITORIO.some(x => n === x || n.startsWith(`${x} `));
}

/**
 * Onde a solicitação nasce.
 *
 * Local desconhecido cai no Operacional de propósito: das ~2.200 pessoas
 * ativas, ~79 são de escritório. Errar para o lado do Operacional acerta
 * na esmagadora maioria, e a fila dele é a que tem gente olhando todo dia.
 */
export function statusInicial(eEscritorio: boolean): StatusTroca {
  return eEscritorio ? "Pendente Escritório" : "Pendente Operacional";
}

/** A etapa tem trabalho a fazer neste status? */
const STATUS_DE_ACAO: Record<Etapa, StatusTroca> = {
  operacional: "Pendente Operacional",
  escritorio: "Pendente Escritório",
  sst: "Pendente SST",
  rh: "Pendente RH",
};

export const statusDeAcao = (etapa: Etapa) => STATUS_DE_ACAO[etapa];

/**
 * O que cada fila enxerga.
 *
 * Operacional e Escritório veem a própria fila do começo ao fim (a pergunta
 * que mais chega é "e a do fulano, andou?"), mas NÃO veem a fila um do
 * outro. SST e RH não enxergam o que ainda está em aprovação nem o que foi
 * reprovado: para eles a solicitação só existe depois de aprovada.
 */
const STATUS_VISIVEIS: Record<Etapa, StatusTroca[]> = {
  operacional: ["Pendente Operacional", "Pendente SST", "Pendente RH", "Concluída", "Reprovada"],
  escritorio:  ["Pendente Escritório", "Pendente SST", "Pendente RH", "Concluída", "Reprovada"],
  sst:         ["Pendente SST", "Pendente RH", "Concluída"],
  rh:          ["Pendente RH", "Concluída"],
};

export const statusVisiveis = (etapa: Etapa) => STATUS_VISIVEIS[etapa];

/**
 * A fila do Operacional e a do Escritório dividem os mesmos status daqui
 * para a frente, então filtrar só por status misturaria as duas. Depois da
 * aprovação o recorte é a origem da solicitação.
 */
export function pertenceAFila(s: Pick<SolicitacaoTroca, "status" | "e_escritorio">, etapa: Etapa): boolean {
  if (!STATUS_VISIVEIS[etapa].includes(s.status)) return false;
  if (etapa === "operacional") return !s.e_escritorio;
  if (etapa === "escritorio") return s.e_escritorio;
  return true;   // SST e RH tratam as duas origens
}

export type Acao = "aprovar" | "reprovar" | "aso" | "concluir";

/**
 * Para onde a solicitação vai. Devolve null quando a ação não vale no
 * estado atual — a tela não deve nem oferecer, mas quem garante é isto.
 */
export function proximoStatus(atual: StatusTroca, acao: Acao): StatusTroca | null {
  const emAprovacao = atual === "Pendente Operacional" || atual === "Pendente Escritório";
  if (acao === "aprovar")  return emAprovacao ? "Pendente SST" : null;
  if (acao === "reprovar") return emAprovacao ? "Reprovada" : null;
  if (acao === "aso")      return atual === "Pendente SST" ? "Pendente RH" : null;
  if (acao === "concluir") return atual === "Pendente RH" ? "Concluída" : null;
  return null;
}

/** Cor do selo. Mesma paleta das outras solicitações do encarregado. */
export function corDoStatus(s: StatusTroca): string {
  switch (s) {
    case "Concluída":  return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "Reprovada":  return "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300";
    case "Pendente SST": return "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300";
    case "Pendente RH":  return "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300";
    default:           return "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
  }
}

/** O que o status quer dizer, em português de gente. */
export function explicaStatus(s: StatusTroca): string {
  switch (s) {
    case "Pendente Operacional": return "Aguardando o Operacional aprovar a troca.";
    case "Pendente Escritório":  return "Aguardando a aprovação do administrativo.";
    case "Pendente SST":         return "Aprovada. O SST vai marcar o ASO de mudança de função.";
    case "Pendente RH":          return "ASO marcado. O RH vai fazer a alteração na Senior.";
    case "Concluída":            return "Alteração feita na Senior. Troca concluída.";
    case "Reprovada":            return "Não aprovada — veja o motivo no detalhe.";
  }
}

export const fmtData = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00`);
  return isNaN(+d) ? "—" : d.toLocaleDateString("pt-BR");
};

export const fmtDataHora = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};
