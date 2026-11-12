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
