// SIS-2026-0668: regras puras da Solicitação de Exceção do Malote (testáveis sem tela nem banco).
// A regra de verdade mora no banco (migration 20261015000001); aqui só o que a tela precisa para avisar
// ANTES de o banco recusar.

export type StatusExcecao = "em_analise" | "aprovada" | "reprovada" | "utilizada" | "cancelada";
export type StatusExcecaoExibido = StatusExcecao | "expirada";

export interface ExcecaoSolicitacao {
  id: string;
  numero: string;
  solicitante_id: string;
  tipo: "administrativo" | "contrato" | "dispensa_cotacao";
  classificacao_id: string;
  contrato_id: string | null;
  empresa_id: string;
  valor: number;
  data_pagamento: string;
  descricao: string;
  justificativa: string;
  status: StatusExcecao;
  decidido_por: string | null;
  decidido_em: string | null;
  motivo_decisao: string | null;
  senha: string | null;
  senha_expira_em: string | null;
  usada_em: string | null;
  despesa_id: string | null;
  arquivos: string[];
  created_at: string;
}

// O que a RPC malote_excecao_validar_senha devolve: a exceção que vai ser anexada à despesa.
export interface ExcecaoValidada {
  id: string;
  numero: string;
  tipo: string;
  classificacao_id: string;
  contrato_id: string | null;
  empresa_id: string;
  valor: number;
  data_pagamento: string;
  descricao: string;
  justificativa: string;
  senha_expira_em: string;
}

export const STATUS_EXCECAO_LABEL: Record<StatusExcecaoExibido, string> = {
  em_analise: "Em análise",
  aprovada: "Aprovada",
  reprovada: "Reprovada",
  utilizada: "Senha utilizada",
  cancelada: "Cancelada",
  expirada: "Senha expirada",
};

export const STATUS_EXCECAO_BADGE: Record<StatusExcecaoExibido, string> = {
  em_analise: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  aprovada: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  reprovada: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  utilizada: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  cancelada: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  expirada: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
};

export const TIPO_EXCECAO_LABEL: Record<string, string> = {
  administrativo: "Administrativo",
  contrato: "Contrato",
  dispensa_cotacao: "Dispensa de cotação",
};

/** "aprovada" com a senha vencida (24 h depois da aprovação) aparece como "expirada" — o banco não grava essa virada. */
export function statusExibidoExcecao(
  s: Pick<ExcecaoSolicitacao, "status" | "senha_expira_em">,
  agora: Date = new Date(),
): StatusExcecaoExibido {
  if (s.status === "aprovada" && s.senha_expira_em && agora.getTime() > new Date(s.senha_expira_em).getTime()) return "expirada";
  return s.status;
}

/** "23 h 10 min" / "42 min" / "expirada". */
export function restanteDaSenha(expiraEm: string | null, agora: Date = new Date()): string {
  if (!expiraEm) return "";
  const ms = new Date(expiraEm).getTime() - agora.getTime();
  if (ms <= 0) return "expirada";
  const min = Math.floor(ms / 60_000);
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${String(min % 60).padStart(2, "0")} min` : `${min} min`;
}

export interface DadosDespesaParaExcecao {
  classificacaoId: string | null;
  dataPagamento: string;
  valor: number;
}

/**
 * A senha vale só para a data e a classificação pedidas e até o valor pedido (o banco reforça).
 * Devolve a mensagem do primeiro problema, ou null se a despesa cabe na exceção.
 */
export function conferirExcecaoComDespesa(exc: ExcecaoValidada, d: DadosDespesaParaExcecao): string | null {
  if (d.classificacaoId && d.classificacaoId !== exc.classificacao_id) {
    return `A exceção ${exc.numero} é de outra classificação.`;
  }
  if (d.dataPagamento && d.dataPagamento !== exc.data_pagamento) {
    return `A exceção ${exc.numero} libera só a data ${exc.data_pagamento.split("-").reverse().join("/")} — ajuste a data de pagamento.`;
  }
  if (Number(d.valor) > Number(exc.valor) + 0.005) {
    return `A exceção ${exc.numero} libera até ${Number(exc.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} — a despesa passa desse valor.`;
  }
  return null;
}

/**
 * Excluir: quem pediu ou o aprovador das exceções; nunca depois de a senha ter sido usada numa despesa
 * (a exceção fica ligada a ela). O banco reforça (malote_excecao_excluir).
 */
export function podeExcluirExcecao(s: Pick<ExcecaoSolicitacao, "status" | "solicitante_id">, userId: string | null | undefined, ehAprovador: boolean): boolean {
  if (!userId || s.status === "utilizada") return false;
  return s.solicitante_id === userId || ehAprovador;
}

/** Parâmetro da URL do Criar Despesa que traz o id da solicitação de exceção aprovada (a senha é validada pela tela). */
export const PARAM_EXCECAO = "excecao";

/**
 * Link do botão "Criar despesa" numa exceção aprovada: abre o Criar Despesa com o que o pedido já sabe
 * (classificação pelo nome, descrição, valor e data) e o id da exceção, para a senha entrar sozinha.
 */
export function urlCriarDespesaDaExcecao(s: Pick<ExcecaoSolicitacao, "id" | "descricao" | "valor" | "data_pagamento">, nomeClassificacao: string | null): string {
  const q = new URLSearchParams();
  if (nomeClassificacao) q.set("rubrica", nomeClassificacao);
  q.set("nome", s.descricao);
  q.set("valor", String(s.valor));
  q.set("pagamento", s.data_pagamento);
  q.set(PARAM_EXCECAO, s.id);
  return `/app/malote/criar-despesa?${q.toString()}`;
}

/** Só dá para criar a despesa enquanto a exceção está aprovada e a senha não venceu nem foi usada. */
export function podeCriarDespesaDaExcecao(s: Pick<ExcecaoSolicitacao, "status" | "senha_expira_em">, agora: Date = new Date()): boolean {
  return statusExibidoExcecao(s, agora) === "aprovada";
}

/** Normaliza o que a pessoa digita/cola: espaços fora, caixa alta. */
export function normalizarSenhaExcecao(txt: string): string {
  return txt.trim().toUpperCase();
}

// ── Tela Autorizações de Exceção (fase 2): KPIs e filtros ─────────────────────────────────────────

export interface FiltroExcecoes {
  de: string;
  ate: string;
  status: "" | StatusExcecaoExibido;
  empresaId: string;
  contratoId: string;
  solicitanteId: string;
  busca: string;
}

export const FILTRO_EXCECOES_VAZIO: FiltroExcecoes = { de: "", ate: "", status: "", empresaId: "", contratoId: "", solicitanteId: "", busca: "" };

const diaLocal = (iso: string) => new Date(iso).toLocaleDateString("sv-SE"); // YYYY-MM-DD no fuso do navegador

export function filtrarExcecoes(lista: ExcecaoSolicitacao[], f: FiltroExcecoes, agora: Date = new Date()): ExcecaoSolicitacao[] {
  const q = f.busca.trim().toLowerCase();
  return lista.filter((s) => {
    if (f.de && diaLocal(s.created_at) < f.de) return false;
    if (f.ate && diaLocal(s.created_at) > f.ate) return false;
    if (f.status && statusExibidoExcecao(s, agora) !== f.status) return false;
    if (f.empresaId && s.empresa_id !== f.empresaId) return false;
    if (f.contratoId && s.contrato_id !== f.contratoId) return false;
    if (f.solicitanteId && s.solicitante_id !== f.solicitanteId) return false;
    if (q && !`${s.numero} ${s.descricao} ${s.justificativa}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export interface ResumoExcecoes {
  total: number;
  emAnalise: number;
  aprovadas: number; // aprovadas pelo aprovador das exceções, inclusive as de senha já usada ou vencida
  reprovadas: number;
}

export function resumirExcecoes(lista: ExcecaoSolicitacao[]): ResumoExcecoes {
  return {
    total: lista.length,
    emAnalise: lista.filter((s) => s.status === "em_analise").length,
    aprovadas: lista.filter((s) => s.status === "aprovada" || s.status === "utilizada").length,
    reprovadas: lista.filter((s) => s.status === "reprovada").length,
  };
}

/** 0 quando não há nada (evita NaN no KPI). */
export function percentualDoTotal(parte: number, total: number): number {
  return total > 0 ? Math.round((parte / total) * 100) : 0;
}

export const TIPO_EVENTO_EXCECAO_LABEL: Record<string, string> = {
  solicitada: "Solicitada",
  aprovada: "Aprovada",
  reprovada: "Reprovada",
  senha_utilizada: "Senha utilizada",
  cancelada: "Cancelada",
};
