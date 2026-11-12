/**
 * Qual módulo da barra lateral fica aceso para a rota atual.
 *
 * 12/11/2026: uma tela que mora em mais de um módulo (Relatório de Serviços
 * em Contábil › Controle de Notas e em Financeiro › Financeiro; Conferência
 * de Ponto em RH, Financeiro e Operacional; Dashboard de Pontos...) acendia
 * SEMPRE o primeiro módulo da lista — os dois itens têm a mesma rota, o
 * casamento empata no comprimento e o desempate era a ordem alfabética. O
 * Pablo entrava pelo Financeiro e a barra apontava Contábil; para voltar às
 * outras telas do Financeiro tinha que procurar o módulo de novo.
 *
 * Regra:
 *  1. Vence o casamento mais específico (rota mais longa) entre o hub do
 *     módulo (headerLink) e os itens dele — o mesmo de antes.
 *  2. Empate: vence o módulo LEMBRADO, aquele em que a pessoa clicou no item
 *     (gravado no sessionStorage pela Sidebar). Só no empate, de propósito:
 *     se o lembrado casar só por um prefixo frouxo (o hub /app/rh numa tela
 *     de /app/rh/recrutamento/...) e outro módulo tiver o item exato, a tela
 *     é do outro — "a rota atual existe no módulo lembrado" quer dizer
 *     existir tão bem quanto em qualquer outro.
 *  3. Sem lembrado, ou lembrado sem a rota (link direto, F5 em aba nova,
 *     busca do topo, navegação para tela de outro módulo): o primeiro
 *     módulo a empatar, como sempre foi.
 */

export interface ItemParaModuloAtivo {
  to: string;
}

export interface ModuloParaModuloAtivo {
  id: string;
  status?: string;
  headerLink?: string;
  groups?: { items: ItemParaModuloAtivo[] }[];
}

/** Rota casa com o caminho: igual, ou o caminho é uma sub-rota dela. A query
 *  (`?tab=...`) do item não entra — o pathname nunca a traz. */
function casa(pathname: string, rota: string): boolean {
  const p = rota.split("?")[0];
  return pathname === p || pathname.startsWith(p + "/");
}

/** Comprimento do melhor casamento do módulo com o caminho; -1 se não casa. */
export function melhorCasamentoDoModulo(mod: ModuloParaModuloAtivo, pathname: string): number {
  if (mod.status !== "active") return -1;
  let melhor = -1;
  // Página-hub do módulo (headerLink) ativa o módulo, mesmo sem submódulos
  // (ex.: /app/central-servicos). "/app" é o Início, não ativa nenhum.
  if (mod.headerLink && mod.headerLink !== "/app" && casa(pathname, mod.headerLink)) {
    melhor = mod.headerLink.length;
  }
  for (const g of mod.groups ?? []) {
    for (const item of g.items) {
      const p = item.to.split("?")[0];
      if (p === "/app") continue; // Início é página própria
      if (casa(pathname, p) && p.length > melhor) melhor = p.length;
    }
  }
  return melhor;
}

export function resolverModuloAtivo(
  modulos: ModuloParaModuloAtivo[],
  pathname: string,
  lembrado: string | null | undefined,
): string | null {
  let melhorId: string | null = null;
  let melhorLen = -1;
  let lembradoLen = -1;
  for (const m of modulos) {
    const len = melhorCasamentoDoModulo(m, pathname);
    if (m.id === lembrado) lembradoLen = len;
    if (len > melhorLen) {
      melhorLen = len;
      melhorId = m.id;
    }
  }
  if (lembrado && melhorLen >= 0 && lembradoLen === melhorLen) return lembrado;
  return melhorId;
}

/** O módulo lembrado continua valendo para este caminho? (A Sidebar esquece
 *  o lembrado quando a pessoa sai para uma tela que não é dele.) */
export function lembradoAindaVale(
  modulos: ModuloParaModuloAtivo[],
  pathname: string,
  lembrado: string,
): boolean {
  return resolverModuloAtivo(modulos, pathname, lembrado) === lembrado;
}

// ── Persistência (sessionStorage: por aba, sobrevive ao F5) ────────────────
const CHAVE = "erp.sidebar.moduloDeOrigem";

export function lerModuloLembrado(): string | null {
  try {
    return window.sessionStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}

export function gravarModuloLembrado(id: string | null): void {
  try {
    if (id) window.sessionStorage.setItem(CHAVE, id);
    else window.sessionStorage.removeItem(CHAVE);
  } catch {
    /* aba privada / storage bloqueado: só perde a memória, cai na rota */
  }
}
