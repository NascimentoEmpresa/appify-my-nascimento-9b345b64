// =====================================================================
// CONFERÊNCIA DE PONTO — o fluxo, longe do React
//
// Portado do sistema Flask (`sistema_rh/conferencia_ponto`). Uma linha por
// CONTRATO por MÊS, e ela atravessa três setores:
//
//   Operacional confere o ponto  → aprova e manda para o RH
//   RH confirma                  → informa o valor da folha → manda ao Financeiro
//   Financeiro paga              → marca como pago
//
//   Pendente Operacional → Pendente RH → Conferido RH
//        → Liberado Financeiro → Pago
//        ↘ Devolvido (volta uma casa, com motivo)  ↘ Problema
//
// O QUE MUDOU EM RELAÇÃO AO FLASK, e por quê:
//
// 1. Lá o acesso saía do SETOR da pessoa (`SETOR_PERFIL`: quem é do setor
//    'RH' ganhava os poderes de RH). Aqui NÃO — este ERP concede acesso por
//    usuário, nunca por cargo/setor/papel (ver README.md da raiz). Cada ação
//    virou um menu próprio em `app_menu`, liberado em Administração › Acesso
//    por Usuário, exatamente como o Pablo pediu:
//
//      ponto_aprovar_contrato     → quem pode aprovar os contratos
//      ponto_confirmar_aprovacao  → quem pode confirmar a aprovação
//      ponto_informar_valor       → quem informa o valor e envia ao financeiro
//      ponto_marcar_pago          → quem pode marcar como pago
//
//    Isso desamarra o fluxo do organograma: dá para o financeiro confirmar
//    no lugar do RH numa semana de férias sem mexer no cadastro de ninguém.
//
// 2. Lá havia um perfil 'ADMIN' que furava tudo (`if perfil == 'ADMIN'`).
//    Aqui não existe bypass: quem concede tudo já é resolvido pelo
//    PermissoesContext, e o resto passa pelas mesmas quatro chaves.
//
// 3. Status em português com acento e caixa normal, como o resto do ERP
//    (`Pendente RH`, não `PENDENTE - RH`).
//
// Testado em src/test/conferencia-ponto.test.ts.
// =====================================================================

export const TABELA = "SISTEMA_CONFERENCIA_PONTO";
export const TABELA_EVENTOS = "SISTEMA_CONFERENCIA_PONTO_EVENTOS";

// ── Status ───────────────────────────────────────────────────────────
export type StatusPonto =
  | "Pendente Operacional"
  | "Em Andamento Operacional"
  | "Pendente RH"
  | "Em Andamento RH"
  | "Conferido RH"
  | "Liberado Financeiro"
  | "Pago"
  | "Devolvido Operacional"
  | "Devolvido RH"
  | "Problema";

export const STATUS_INICIAL: StatusPonto = "Pendente Operacional";

export const STATUS_TODOS: StatusPonto[] = [
  "Pendente Operacional", "Em Andamento Operacional",
  "Pendente RH", "Em Andamento RH", "Conferido RH",
  "Liberado Financeiro", "Pago",
  "Devolvido Operacional", "Devolvido RH", "Problema",
];

// ── As quatro chaves de acesso ───────────────────────────────────────
/** Os menus que o Acesso por Usuário libera. Um por ação do fluxo. */
export const MENU = {
  tela:      "rh_conferencia_ponto",
  painel:    "rh_conferencia_ponto_painel",
  aprovar:   "ponto_aprovar_contrato",
  confirmar: "ponto_confirmar_aprovacao",
  valor:     "ponto_informar_valor",
  pagar:     "ponto_marcar_pago",
} as const;

export type Acao = "andamento_op" | "aprovar" | "andamento_rh" | "confirmar"
                 | "informar_valor" | "marcar_pago" | "devolver_op" | "devolver_rh"
                 | "problema";

/**
 * Quem pode cada ação.
 *
 * Devolver é sempre poder de quem RECEBEU: só devolve para o Operacional
 * quem confirma (o RH está com a bola), e só devolve para o RH quem paga. Sem
 * isso, devolver viraria uma quinta permissão para gerenciar e a fila poderia
 * ser empurrada de volta por quem nunca a teve na mão.
 */
export const MENU_DA_ACAO: Record<Acao, string> = {
  andamento_op:   MENU.aprovar,
  aprovar:        MENU.aprovar,
  andamento_rh:   MENU.confirmar,
  confirmar:      MENU.confirmar,
  informar_valor: MENU.valor,
  marcar_pago:    MENU.pagar,
  devolver_op:    MENU.confirmar,
  devolver_rh:    MENU.pagar,
  problema:       MENU.pagar,
};

/** O status que a ação produz. */
const DESTINO: Record<Acao, StatusPonto> = {
  andamento_op:   "Em Andamento Operacional",
  aprovar:        "Pendente RH",
  andamento_rh:   "Em Andamento RH",
  confirmar:      "Conferido RH",
  informar_valor: "Liberado Financeiro",
  marcar_pago:    "Pago",
  devolver_op:    "Devolvido Operacional",
  devolver_rh:    "Devolvido RH",
  problema:       "Problema",
};

/**
 * De quais status cada ação pode partir.
 *
 * Devolvido volta a ser fila de quem devolveu para: `Devolvido Operacional`
 * é trabalho do Operacional de novo, então ele reaparece na origem.
 */
const ORIGENS: Record<Acao, StatusPonto[]> = {
  andamento_op:   ["Pendente Operacional", "Devolvido Operacional", "Problema"],
  aprovar:        ["Pendente Operacional", "Em Andamento Operacional", "Devolvido Operacional", "Problema"],
  andamento_rh:   ["Pendente RH", "Devolvido RH"],
  confirmar:      ["Pendente RH", "Em Andamento RH", "Devolvido RH"],
  // Informar o valor exige a conferência feita: é o número que vai virar
  // pagamento, e liberar direto de "Pendente RH" pularia a conferência que dá
  // nome ao sistema.
  informar_valor: ["Conferido RH"],
  marcar_pago:    ["Liberado Financeiro"],
  devolver_op:    ["Pendente RH", "Em Andamento RH", "Conferido RH"],
  devolver_rh:    ["Liberado Financeiro"],
  problema:       ["Liberado Financeiro", "Conferido RH"],
};

/** Para onde vai, ou null quando a ação não vale no estado atual. */
export function proximoStatus(atual: StatusPonto, acao: Acao): StatusPonto | null {
  return ORIGENS[acao].includes(atual) ? DESTINO[acao] : null;
}

/**
 * A pessoa pode fazer esta ação nesta linha AGORA?
 *
 * Duas perguntas: a permissão libera a ação, e o status atual aceita. `pode`
 * é o `can()` do PermissoesContext — fica de fora daqui para esta camada
 * continuar testável sem React.
 */
export function podeAgir(
  atual: StatusPonto,
  acao: Acao,
  pode: (menu: string) => boolean,
): boolean {
  if (!pode(MENU_DA_ACAO[acao])) return false;
  return proximoStatus(atual, acao) !== null;
}

// ── Quem é o dono da bola ────────────────────────────────────────────
export type Etapa = "operacional" | "rh" | "financeiro" | "fim";

/** De quem é o trabalho agora — usado nos contadores e no recorte da fila. */
export function etapaDoStatus(s: StatusPonto): Etapa {
  switch (s) {
    case "Pendente Operacional":
    case "Em Andamento Operacional":
    case "Devolvido Operacional":
      return "operacional";
    case "Pendente RH":
    case "Em Andamento RH":
    case "Devolvido RH":
      return "rh";
    case "Conferido RH":
    case "Liberado Financeiro":
    case "Problema":
      return "financeiro";
    case "Pago":
      return "fim";
  }
}

/**
 * O avanço de cada setor, como o Painel TV mostra.
 *
 * A regra é acumulativa e vem do Flask: o Operacional "já fez" tudo que
 * chegou no RH ou além; o RH "já fez" tudo que foi conferido ou além. Sem
 * isso a barra andaria para trás quando a etapa seguinte pegasse o trabalho.
 */
export function contaAvanco(status: StatusPonto[]): {
  operacional: number; rh: number; financeiro: number; total: number;
} {
  const passouOp = (s: StatusPonto) =>
    etapaDoStatus(s) === "rh" || etapaDoStatus(s) === "financeiro" || s === "Pago";
  const passouRh = (s: StatusPonto) =>
    s === "Conferido RH" || s === "Liberado Financeiro" || s === "Pago" || s === "Problema";

  return {
    operacional: status.filter(passouOp).length,
    rh:          status.filter(passouRh).length,
    financeiro:  status.filter(s => s === "Pago").length,
    total:       status.length,
  };
}

export const pct = (parte: number, total: number) =>
  total > 0 ? Math.round((parte / total) * 100) : 0;

// ── Aparência ────────────────────────────────────────────────────────
export function corDoStatus(s: string): string {
  const cores: Record<string, string> = {
    "Pendente Operacional":     "bg-slate-100 text-slate-700 border-slate-200",
    "Em Andamento Operacional": "bg-amber-100 text-amber-800 border-amber-200",
    "Pendente RH":              "bg-orange-100 text-orange-800 border-orange-200",
    "Em Andamento RH":          "bg-violet-100 text-violet-800 border-violet-200",
    "Conferido RH":             "bg-sky-100 text-sky-800 border-sky-200",
    "Liberado Financeiro":      "bg-indigo-100 text-indigo-800 border-indigo-200",
    "Pago":                     "bg-emerald-100 text-emerald-800 border-emerald-200",
    "Devolvido Operacional":    "bg-red-100 text-red-800 border-red-200",
    "Devolvido RH":             "bg-red-100 text-red-800 border-red-200",
    "Problema":                 "bg-red-200 text-red-900 border-red-300",
  };
  return cores[s] ?? "bg-blue-100 text-blue-700 border-blue-200";
}

export function explicaStatus(s: string): string {
  const t: Record<string, string> = {
    "Pendente Operacional":     "Aguardando o Operacional conferir o ponto.",
    "Em Andamento Operacional": "O Operacional está conferindo.",
    "Pendente RH":              "Aprovado pelo Operacional. Aguardando o RH confirmar.",
    "Em Andamento RH":          "O RH está conferindo.",
    "Conferido RH":             "Confirmado. Falta informar o valor da folha.",
    "Liberado Financeiro":      "Valor informado. Aguardando o Financeiro pagar.",
    "Pago":                     "Folha paga. Contrato fechado no mês.",
    "Devolvido Operacional":    "Devolvido para o Operacional — veja o motivo.",
    "Devolvido RH":             "Devolvido para o RH — veja o motivo.",
    "Problema":                 "Marcado com problema — veja o motivo.",
  };
  return t[s] ?? "";
}

/** A prioridade de quem grita mais alto primeiro, igual ao Flask. */
const PRIORIDADE: Record<string, number> = {
  "Problema": 1, "Devolvido Operacional": 2, "Devolvido RH": 3,
  "Pendente RH": 4, "Em Andamento RH": 5, "Conferido RH": 5,
  "Liberado Financeiro": 6, "Em Andamento Operacional": 7,
  "Pendente Operacional": 8, "Pago": 9,
};
export const ordemDoStatus = (s: string) => PRIORIDADE[s] ?? 99;

// ── O registro ───────────────────────────────────────────────────────
export interface LinhaConferencia {
  /** null enquanto o mês não foi preparado — a linha ainda não existe. */
  id: number | null;
  contrato_empresa: number;
  contrato_filial: number;
  contrato_nome: string | null;
  nome_empresa: string | null;
  analista_nome: string | null;
  supervisor_nome: string | null;
  mes_referencia: string;
  status: StatusPonto;
  valor_folha: number | null;
  devolucao_motivo: string | null;
  aprovado_por: string | null;   aprovado_em: string | null;
  confirmado_por: string | null; confirmado_em: string | null;
  valor_por: string | null;      valor_em: string | null;
  pago_por: string | null;       pago_em: string | null;
  atualizado_em: string | null;
  atualizado_por: string | null;
}

export interface EventoConferencia {
  id: number;
  conferencia_id: number;
  acao: string;
  de_status: string | null;
  para_status: string | null;
  observacao: string | null;
  usuario_nome: string | null;
  criado_em: string;
}

// ── Mês de referência ────────────────────────────────────────────────
/** "2026-08". O padrão é o mês PASSADO: a folha se confere depois de fechar. */
export function mesPadrao(hoje = new Date()): string {
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function addMeses(yyyyMM: string, delta: number): string {
  const [y, m] = yyyyMM.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export function mesLegivel(yyyyMM: string): string {
  const [y, m] = yyyyMM.split("-");
  return `${MESES[Number(m) - 1] ?? m}/${y}`;
}

// ── Prazo: o 5º dia útil do mês seguinte, 17h ────────────────────────
// Regra herdada do Flask (`calcular_quinto_dia_util`). Os feriados são os
// nacionais fixos; Páscoa/Carnaval ficam de fora porque o cálculo lá também
// os ignorava e mudar isso agora moveria prazos que a operação já conhece.
const FERIADOS_FIXOS = [[1, 1], [4, 21], [5, 1], [9, 7], [10, 12], [11, 2], [11, 15], [12, 25]];

export function ehDiaUtil(d: Date): boolean {
  if (d.getDay() === 0 || d.getDay() === 6) return false;
  return !FERIADOS_FIXOS.some(([m, dia]) => d.getMonth() + 1 === m && d.getDate() === dia);
}

/** O prazo de fechamento do mês `yyyyMM`: 5º dia útil do mês SEGUINTE, 17h. */
export function prazoDoMes(yyyyMM: string): Date {
  const seguinte = addMeses(yyyyMM, 1);
  const [y, m] = seguinte.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  let uteis = 0;
  while (uteis < 5) {
    if (ehDiaUtil(d)) uteis++;
    if (uteis < 5) d.setDate(d.getDate() + 1);
  }
  d.setHours(17, 0, 0, 0);
  return d;
}

/** "3d 4h 12m" até o prazo, ou null se já passou. */
export function faltaPara(alvo: Date, agora = new Date()): string | null {
  const ms = alvo.getTime() - agora.getTime();
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms / 3600000) % 24);
  const m = Math.floor((ms / 60000) % 60);
  return `${d}d ${h}h ${m}m`;
}

// ── Formatação ───────────────────────────────────────────────────────
export const fmtBRL = (v?: number | null) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const fmtDataHora = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

/**
 * O ANALISTA da CONTRATOS é texto puro ('11722') OU um array JSON
 * ('[11722,11907]') — as duas grafias convivem no cadastro. Medido em
 * 25/08/2026: 47 em texto e 11 em JSON.
 */
export function idsDoAnalista(valor?: string | null): number[] {
  const s = String(valor ?? "").trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      const arr = JSON.parse(s);
      return Array.isArray(arr) ? arr.map(Number).filter(Number.isFinite) : [];
    } catch { return []; }
  }
  const n = Number(s);
  return Number.isFinite(n) ? [n] : [];
}
