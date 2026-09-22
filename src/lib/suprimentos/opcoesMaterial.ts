/**
 * A grade de opções que o Catálogo de Materiais oferece por chip
 * (tamanho / quantidade / litros) e a regra de quais chips desenhar.
 *
 * Vive fora do hook porque é regra, não consulta: o teste precisa dela sem
 * subir o cliente do Supabase, e `useSupCatalogo` importa
 * `@/integrations/supabase/client`.
 *
 * ── POR QUE A GRADE NÃO PODE SER A ÚNICA VERDADE (SIS-2026-0482) ─────────
 *
 * O tamanho entra no sistema por DOIS caminhos que nunca conversaram:
 *
 *   • Catálogo → `sup_item_opcao.opcoes`: lista fechada, marcada por chip.
 *     É ela que vira o select "Tamanho" do pedido.
 *   • Estoque  → `sup_item.tamanho`: TEXTO LIVRE na entrada
 *     (EstoqueEtiquetas.tsx), normalizado por `sup_tamanho_da_variante` e
 *     virando um item filho com código próprio ("JAQUETA EXG").
 *
 * Quando os dois divergem, o pedido oferece um tamanho que o estoque não
 * tem e esconde o que ele tem. Foi exatamente o chamado: a JAQUETA está
 * cadastrada como EXG no estoque, o select só oferecia EXGG, e o pré-pedido
 * respondia "sem estoque" para uma peça que estava na prateleira — sem que
 * houvesse como marcar EXG, porque o chip não existia.
 *
 * A correção tem duas pernas, e as duas importam:
 *   1. a grade abaixo cresceu (EXG, XGG, e numeração até 60);
 *   2. `chipsDeOpcao` acrescenta o que JÁ existe — no cadastro do item e no
 *      estoque — mesmo fora da grade. Assim a tela nunca mais esconde um
 *      tamanho que o almoxarifado já usa, e o próximo tamanho inventado na
 *      entrada não vira outro chamado.
 */

/**
 * Tamanhos por letra, do menor para o maior.
 *
 * XGG e EXG entraram em 22/09/2026. Não são novidade nenhuma: XGG já vinha
 * do sistema antigo em `20260819000004_supply_catalogo_import.sql` (CALÇA
 * SOCIAL MASCULINA, JALECO BRANCO, LUVA DE RASPA e outros) e nunca teve
 * chip — quem abrisse as opções desses itens não via o XGG marcado, e não
 * tinha como desmarcar. EXG é o do chamado.
 */
export const TAMANHOS_LETRA = ["PP", "P", "M", "G", "GG", "XGG", "EGG", "EXG", "EXGG"] as const;

/**
 * Numeração de vestuário. Ia até 49 e o estoque já tinha 50, 52 e 54 de
 * calça social masculina — o motivo do chamado. Vai até 60 para não repetir
 * o mesmo pedido a cada peça maior que entra; sobrar número na lista não
 * custa nada, faltar trava o pedido.
 */
export const TAMANHO_NUMERO_MIN = 33;
export const TAMANHO_NUMERO_MAX = 60;

const numeracao = Array.from(
  { length: TAMANHO_NUMERO_MAX - TAMANHO_NUMERO_MIN + 1 },
  (_, i) => String(TAMANHO_NUMERO_MIN + i),
);

/** Listas pré-definidas do painel legado (ARQUITETURA-COMPLETA.md §11.2). */
export const OPCOES_PREDEFINIDAS: Record<string, string[]> = {
  quantidade: ["1", "2", "3", "4", "5", "6"],
  tamanho: [...TAMANHOS_LETRA, ...numeracao],
  litros: Array.from({ length: 19 }, (_, i) => String((i + 1) * 10)),
};

/**
 * Só para COMPARAR — o chip fora da grade é desenhado com o texto exato que
 * está gravado. É o que mantém `marcado`/`alternar` na tela funcionando por
 * igualdade simples: o rótulo do chip É o valor de `sup_item_opcao.opcoes`.
 * Normalizar o rótulo faria um "exg" gravado no legado virar chip "EXG" que
 * nunca aparece marcado e, ao ser clicado, gravaria o par "exg" + "EXG".
 */
const chave = (v: string) => v.trim().replace(/\s+/g, " ").toUpperCase();

/**
 * Ordena os chips que estão FORA da grade: número por valor, o resto por
 * ordem alfabética, e número sempre depois de letra — a mesma leitura da
 * grade, que também termina na numeração.
 */
function compararExtras(a: string, b: string): number {
  const na = Number(a), nb = Number(b);
  const aNum = Number.isFinite(na) && a.trim() !== "";
  const bNum = Number.isFinite(nb) && b.trim() !== "";
  if (aNum && bNum) return na - nb;
  if (aNum !== bNum) return aNum ? 1 : -1;
  return a.localeCompare(b, "pt-BR");
}

/**
 * Os chips a desenhar para um tipo de opção: a grade, mais o que já existe
 * e ela não cobre.
 *
 * `jaSalvas` são as opções gravadas no item (`sup_item_opcao.opcoes`) —
 * inclusive as vindas do sistema antigo. `extras` é usado só em "tamanho",
 * com os tamanhos que já viraram item de estoque (`useTamanhosDoItem`): é o
 * que traz o EXG da JAQUETA para a tela sem ninguém precisar digitar.
 *
 * O que está fora da grade vem no fim, nunca no meio: a grade é a ordem que
 * o Supply já conhece, e embaralhá-la faria procurar chip errado.
 */
export function chipsDeOpcao(
  tipo: string,
  jaSalvas: string[] = [],
  extras: string[] = [],
): string[] {
  const grade = OPCOES_PREDEFINIDAS[tipo] ?? [];
  const naGrade = new Set(grade.map(chave));

  const fora: string[] = [];
  const vistos = new Set<string>();
  for (const bruto of [...jaSalvas, ...extras]) {
    const k = chave(bruto ?? "");
    if (!k || naGrade.has(k) || vistos.has(k)) continue;
    vistos.add(k);
    fora.push(bruto.trim());
  }

  return [...grade, ...fora.sort(compararExtras)];
}
