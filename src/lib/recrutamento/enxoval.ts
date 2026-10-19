// Enxoval da função na admissão (25/09/2026, mig 20260930000246) — as regras
// que o card do kanban (EnxovalAdmissao) usa, com teste.
//
// Os itens e a grade de cada um vêm do Catálogo (Suprimentos). "Não precisa"
// tira o item — a RPC rec_enxoval_informar entende o mesmo marcador.
//
// 19/10/2026 (mig 20261019000001, Pablo: "deixa enviar sem preencher, só que
// tem que botar OBSERVAÇÃO pra cada coisa que não está preenchida… mesmo se não
// tiver opção por parte do compras, o recrutamento tem que conseguir colocar o
// tamanho"): o tamanho pode ser escrito (fora da grade, ou em item sem grade),
// e o item que exige tamanho pode ir sem ele desde que leve observação.

export const NAO_PRECISA = "NAO_PRECISA";

export interface ItemEnxoval {
  item_id: string;
  nome: string;
  tipo: string;
  /** Grade de tamanhos do Catálogo; vazia = o Catálogo não oferece opção. */
  grade: string[];
  /** Já informado (reabrindo) — ou NAO_PRECISA. */
  tamanho: string | null;
  /** Observação do Recrutamento sobre o item (reabrindo). */
  obs?: string | null;
  /** Quantidade (14/10/2026, mig 20261014000045) — 1 a 99, padrão 1. */
  quantidade?: number;
}

/** Item que precisa de tamanho: tem grade no Catálogo, ou é uniforme (jaleco sem grade também veste). */
export const exigeTamanho = (i: Pick<ItemEnxoval, "grade" | "tipo">): boolean =>
  i.grade.length > 0 || i.tipo === "uniforme";

/**
 * Nomes dos itens que exigem tamanho e estão sem ele E sem observação.
 * "Não precisa" conta como preenchido; tamanho fora da grade vale (o Recrutamento escreveu).
 */
export function faltandoTamanho(
  itens: ItemEnxoval[],
  tamanhos: Record<string, string>,
  obs: Record<string, string> = {},
): string[] {
  return itens
    .filter(exigeTamanho)
    .filter((i) => !(tamanhos[i.item_id] ?? "").trim() && !(obs[i.item_id] ?? "").trim())
    .map((i) => i.nome);
}

/** Resumo quando a função não tem enxoval no Catálogo e o Recrutamento descreveu à mão. */
export const resumoLivre = (funcao: string | null, texto: string): string =>
  `Função ${funcao ?? "—"} sem enxoval no Catálogo. Materiais informados pelo Recrutamento:\n${texto.trim()}`;
