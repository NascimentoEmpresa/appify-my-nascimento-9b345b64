// Setas "anterior / próximo" na tela do chamado (12/11/2026, Pablo: "aqui nos
// chamados coloca uma seta pra ir passando pro lado"). Quem abre um chamado a
// partir de uma lista (ex.: o detalhe dos valores da Bonificação) leva a
// ordem dela na URL (?lista=id1,id2,…); a tela do chamado anda por ela.
// A URL carrega a lista para funcionar também em aba nova e no F5.

export const PARAM_LISTA = "lista";
/** Teto de ids na URL (36 caracteres cada): cobre um mês de entregas com folga. */
export const MAX_LISTA = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?lista=` → ids válidos, sem repetição, na ordem. */
export function lerLista(valor: string | null | undefined): string[] {
  const vistos = new Set<string>();
  for (const p of String(valor ?? "").split(",")) {
    const id = p.trim();
    if (UUID.test(id) && !vistos.has(id)) vistos.add(id);
    if (vistos.size >= MAX_LISTA) break;
  }
  return [...vistos];
}

export function hrefNaLista(id: string, lista: string[]): string {
  const ids = lista.slice(0, MAX_LISTA);
  return `/app/sistemas/chamados/${id}${ids.length > 1 ? `?${PARAM_LISTA}=${ids.join(",")}` : ""}`;
}

export interface PosicaoNaLista { indice: number; total: number; anterior: string | null; proximo: string | null }

/** Onde o chamado está na lista; null se ele não está nela ou a lista tem só ele. */
export function posicaoNaLista(lista: string[], id: string | undefined): PosicaoNaLista | null {
  const i = id ? lista.indexOf(id) : -1;
  if (i < 0 || lista.length < 2) return null;
  return {
    indice: i,
    total: lista.length,
    anterior: i > 0 ? lista[i - 1] : null,
    proximo: i < lista.length - 1 ? lista[i + 1] : null,
  };
}

// 16/11/2026, Pablo ("adiciona esses botões no painel do desenvolvedor, pra
// facilitar a visualização dos chamados"): o Painel do Desenvolvedor, a Fila
// por prioridade e o Painel de Distribuição passam a levar ?lista= com a
// ordem que estão mostrando (filtros e ordenação inclusos). Quem chega ao
// chamado SEM lista (link direto, notificação, chat) cai na fila do
// responsável do chamado — a mesma ordem do "Nº na fila" do painel.

export interface ItemFila {
  id: string;
  status: string;
  responsavel_id: string | null;
  posicao_dev: number | null;
  created_at: string;
}

/**
 * Ordem padrão, sem lista de origem: os chamados ATIVOS do mesmo responsável,
 * pela posição na fila dele (posicao_dev; empate/sem posição → mais antigo
 * primeiro). Mesmo critério de posicoesFilaDev em pages/chamados/types.tsx.
 * `ativo` vem de fora para esta lógica não depender da camada de tela.
 */
export function ordemFilaResponsavel(
  itens: ItemFila[],
  responsavelId: string | null | undefined,
  ativo: (status: string) => boolean,
): string[] {
  if (!responsavelId) return [];
  return itens
    .filter((c) => c.responsavel_id === responsavelId && ativo(c.status))
    .sort((a, b) =>
      (a.posicao_dev ?? Number.MAX_SAFE_INTEGER) - (b.posicao_dev ?? Number.MAX_SAFE_INTEGER)
      || +new Date(a.created_at) - +new Date(b.created_at))
    .map((c) => c.id)
    .slice(0, MAX_LISTA);
}
