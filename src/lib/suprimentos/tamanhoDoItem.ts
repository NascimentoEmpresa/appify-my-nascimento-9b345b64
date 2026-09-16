/**
 * Cada TAMANHO de um material é um item com código próprio
 * (supabase/migrations/20260930000163_sup_item_codigo_por_tamanho.sql).
 *
 * "JAQUETA" é o item base — é ele que o catálogo, o enxoval e o pedido usam.
 * "JAQUETA M" é o item do tamanho: tem código de 7 dígitos, ficha de estoque,
 * saldo, mínimo e histórico próprios. O pedido foi literal: "não pode ser um
 * item só de jaqueta e dentro dela os tamanhos, cada código ser de cada
 * tamanho".
 *
 * Estas funções são o espelho, no front, de `public.sup_tamanho_da_variante` e
 * da regra de nome de `public.sup_item_variante`. A tela usa isto para dizer
 * ANTES de gravar em qual item cada tamanho vai cair — se a regra mudar lá,
 * tem de mudar aqui, senão a prévia mente.
 */

/**
 * O "sem tamanho" do sistema antigo: em 15/09/2026 havia 115 pares
 * (material, tamanho) com "X", 26 com "U" e 3 com "UNICO". Não vira item
 * próprio — criar "LUVA X" trocaria o código de material que nunca teve grade.
 */
const SEM_TAMANHO = new Set(["X", "U", "UN", "UNICO", "-"]);

/** Como o catálogo grava nome: sem espaço sobrando, em maiúsculas. */
export const normalizarNomeMaterial = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();

/** Tamanho que vira item próprio, já na forma gravada ("m " → "M"), ou null. */
export function tamanhoDaVariante(tamanho: string | null | undefined): string | null {
  const t = normalizarNomeMaterial(tamanho ?? "");
  if (!t || SEM_TAMANHO.has(t.replace(/[Úú]/g, "U"))) return null;
  return t;
}

/** "JAQUETA" + "M" → "JAQUETA M", o nome que o banco dá ao item do tamanho. */
export const nomeDaVariante = (base: string, tamanho: string) => `${normalizarNomeMaterial(base)} ${tamanho}`;

/**
 * "JAQUETA M" digitado como material novo, com "JAQUETA" no catálogo, é o
 * tamanho M dele — cadastrar à parte criaria exatamente o item solto que a
 * mudança existe para acabar. Mesma regra com que `sup_est_criar_material`
 * recusa: base mais comprido primeiro ("CAMISA POLO G" é o G de "CAMISA
 * POLO", não o "POLO G" de "CAMISA") e tamanho de uma palavra só.
 */
export function separarTamanhoDoNome<T extends { nome: string }>(
  nome: string, bases: T[],
): { base: T; tamanho: string } | null {
  const n = normalizarNomeMaterial(nome);
  const porTamanho = bases
    .map((b) => ({ b, nome: normalizarNomeMaterial(b.nome) }))
    .sort((x, y) => y.nome.length - x.nome.length);
  for (const { b, nome: base } of porTamanho) {
    if (!n.startsWith(`${base} `)) continue;
    const resto = n.slice(base.length + 1);
    if (resto.includes(" ")) continue;
    const tamanho = tamanhoDaVariante(resto);
    if (tamanho) return { base: b, tamanho };
  }
  return null;
}

/** Item de tamanho que já existe, para a prévia mostrar o código dele. */
export interface TamanhoExistente { tamanho: string; codigo: string | null }

/**
 * Onde cai um bloco da entrada: no item daquele tamanho (com o código, se já
 * existe) ou, sem tamanho de verdade, no próprio base.
 */
export function destinoDoTamanho(
  base: { nome: string; codigo?: string | null },
  tamanhoDigitado: string,
  existentes: TamanhoExistente[],
): { nome: string; codigo: string | null; novo: boolean; semTamanho: boolean } {
  const tamanho = tamanhoDaVariante(tamanhoDigitado);
  if (!tamanho) {
    return { nome: normalizarNomeMaterial(base.nome), codigo: base.codigo ?? null, novo: false, semTamanho: true };
  }
  const ja = existentes.find((e) => e.tamanho === tamanho);
  return { nome: nomeDaVariante(base.nome, tamanho), codigo: ja?.codigo ?? null, novo: !ja, semTamanho: false };
}
