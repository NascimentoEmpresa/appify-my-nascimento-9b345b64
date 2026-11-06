// =====================================================================
// Layout do celular (06/11/2026): o que entra na barra inferior e nos
// atalhos do Início. É regra, separada das telas para ser testada.
//
// Nada aqui libera acesso: `visivel` é a mesma regra do menu lateral e da
// busca (rotaVisivelNoMenu), então a barra nunca oferece tela que o
// RouteGuard vai barrar. Quem decide de verdade continua sendo a RLS.
// =====================================================================

export type IdAbaMobile = "inicio" | "whatsapp" | "aprovacoes" | "tarefas" | "menu";

export interface AbaMobile {
  id: IdAbaMobile;
  rotulo: string;
  /** null = não navega: abre o menu completo. */
  to: string | null;
}

export const ROTA_WHATSAPP = "/app/whatsapp";
export const ROTA_TAREFAS = "/app/minhas-tarefas";
export const ROTA_APROVACOES = "/app/aprovacoes/inbox";

interface EntradaAbas {
  externo: boolean;
  temAlcada: boolean;
  visivel: (rota: string) => boolean;
}

/**
 * Início e Menu sempre existem. O meio depende do acesso, e no máximo são 5
 * abas, o limite para o rótulo caber em 320 px. Encarregado externo fica só com
 * as duas fixas: as outras telas não existem para ele.
 */
export function abasDaNavegacao({ externo, temAlcada, visivel }: EntradaAbas): AbaMobile[] {
  const inicio: AbaMobile = { id: "inicio", rotulo: "Início", to: "/app" };
  const menu: AbaMobile = { id: "menu", rotulo: "Menu", to: null };
  if (externo) return [inicio, menu];
  const meio: AbaMobile[] = [];
  if (visivel(ROTA_WHATSAPP)) meio.push({ id: "whatsapp", rotulo: "WhatsApp", to: ROTA_WHATSAPP });
  if (temAlcada && visivel(ROTA_APROVACOES)) meio.push({ id: "aprovacoes", rotulo: "Aprovar", to: ROTA_APROVACOES });
  if (visivel(ROTA_TAREFAS)) meio.push({ id: "tarefas", rotulo: "Tarefas", to: ROTA_TAREFAS });
  return [inicio, ...meio, menu];
}

/** A aba acesa. "/app" só vale exato: toda rota do ERP começa com ele. */
export function abaAtiva(pathname: string, abas: AbaMobile[]): IdAbaMobile | null {
  for (const a of abas) {
    if (!a.to) continue;
    if (a.to === "/app" ? pathname === "/app" : pathname === a.to || pathname.startsWith(`${a.to}/`)) return a.id;
  }
  return null;
}

export type IdAtalhoMobile = "whatsapp" | "tarefas" | "aprovacoes" | "chamados" | "hora-extra" | "reunioes" | "novidades" | "perfil";

export interface AtalhoMobile {
  id: IdAtalhoMobile;
  rotulo: string;
  to: string;
}

const ATALHOS: AtalhoMobile[] = [
  { id: "whatsapp", rotulo: "WhatsApp", to: ROTA_WHATSAPP },
  { id: "tarefas", rotulo: "Tarefas", to: ROTA_TAREFAS },
  { id: "aprovacoes", rotulo: "Aprovar", to: ROTA_APROVACOES },
  { id: "chamados", rotulo: "Chamados", to: "/app/central-servicos/chamados" },
  { id: "hora-extra", rotulo: "Hora extra", to: "/app/sistemas/hora-extra" },
  { id: "reunioes", rotulo: "Reuniões", to: "/app/central-servicos/reunioes" },
  { id: "novidades", rotulo: "Novidades", to: "/app/novidades" },
  { id: "perfil", rotulo: "Meu perfil", to: "/app/meu-perfil" },
];

export function atalhosVisiveis({ temAlcada, visivel }: Omit<EntradaAbas, "externo">): AtalhoMobile[] {
  return ATALHOS.filter((a) => (a.id !== "aprovacoes" || temAlcada) && visivel(a.to));
}
