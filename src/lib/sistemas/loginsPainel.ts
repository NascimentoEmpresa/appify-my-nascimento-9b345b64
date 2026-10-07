// =====================================================================
// Sistemas › Logins › Painel de uso — tipos e contas (mig 20261007000008)
//
// Pedido (07/10/2026): "dashboards nesse sistema de logins — quais setores
// têm mais logins, quais setores mais acessam etc.". A RPC sis_logins_painel
// devolve contagens; porcentagens, médias e rótulos saem daqui (com teste).
//   · Acesso = uma abertura do ERP (sessoes_ativas, gravada pelo Topbar uma
//     vez por aba/navegador) — não mede tempo nem tela.
//   · Setor = Administração › Setores (user_setor); quem tem dois setores
//     conta nos dois.
// =====================================================================

export interface SetorPainel { setor: string; logins: number; ativos: number; acessos: number; bloqueados: number }
export interface UsuarioPainel { nome: string; email: string; acessos?: number; dias_ativos?: number; ultimo: string | null; setores: string | null; criado_em?: string }
export interface PainelLogins {
  dias: number | null; de: string | null; gerado_em: string;
  total_logins: number; ativos: number; acessos: number; bloqueados: number; nunca_acessaram: number; sem_acesso_30d: number;
  por_setor: SetorPainel[];
  por_dia: { dia: string; acessos: number; usuarios: number }[];
  por_hora: { hora: number; acessos: number }[];
  por_semana: { dow: number; acessos: number }[];
  dispositivos: { dispositivo: string; acessos: number }[];
  top_usuarios: UsuarioPainel[];
  sem_acesso: UsuarioPainel[];
  telas_negadas: { tela: string; tentativas: number; usuarios: number }[];
}

export const PERIODOS = [
  { valor: 7, rotulo: "Últimos 7 dias" },
  { valor: 30, rotulo: "Últimos 30 dias" },
  { valor: 90, rotulo: "Últimos 90 dias" },
  { valor: null, rotulo: "Desde o início (mai/2026)" },
] as const;

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
/** 0 = domingo (extract(dow) do Postgres). */
export const rotuloDiaSemana = (dow: number) => DIAS_SEMANA[dow] ?? "?";

/** % com uma casa; 0 quando não há base. */
export const pct = (parte: number, total: number) => (total > 0 ? Math.round((parte * 1000) / total) / 10 : 0);

/** Média com uma casa; 0 quando não há base. */
export const media = (soma: number, n: number) => (n > 0 ? Math.round((soma * 10) / n) / 10 : 0);

/**
 * Setores ordenados para o gráfico de acessos: quem mais acessa primeiro, com
 * a média por login do setor (um setor grande não "ganha" só pelo tamanho).
 */
export function setoresPorAcesso(setores: SetorPainel[]) {
  return [...setores]
    .filter((s) => s.acessos > 0)
    .map((s) => ({ ...s, porLogin: media(s.acessos, s.logins) }))
    .sort((a, b) => b.acessos - a.acessos || a.setor.localeCompare(b.setor));
}

/** "/app/sistemas/chamados/dashboard-tv" → "sistemas › chamados › dashboard-tv" (rótulo curto da rota). */
export const rotuloTela = (rota: string) => rota.replace(/^\/app\/?/, "").split("/").filter(Boolean).join(" › ") || "início";

/** Há quantos dias (inteiro) desde a data; null quando nunca. */
export function diasDesde(iso: string | null, agora: Date = new Date()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((agora.getTime() - new Date(iso).getTime()) / 86_400_000));
}
