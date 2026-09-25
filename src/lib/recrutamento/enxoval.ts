// Enxoval da função na admissão (25/09/2026, mig 20260930000246) — as regras
// que o card do kanban (EnxovalAdmissao) usa, com teste.
//
// Os itens e a grade de cada um vêm do Catálogo (Suprimentos). Item com grade
// exige tamanho; sem grade, não. "Não precisa" tira o item — a RPC
// rec_enxoval_informar entende o mesmo marcador.

export const NAO_PRECISA = "NAO_PRECISA";

export interface ItemEnxoval {
  item_id: string;
  nome: string;
  tipo: string;
  /** Grade de tamanhos do Catálogo; vazia = o item não pede tamanho. */
  grade: string[];
  /** Já informado (reabrindo) — ou NAO_PRECISA. */
  tamanho: string | null;
}

/** Nomes dos itens com grade que ainda estão sem tamanho (e não foram dispensados). */
export function faltandoTamanho(itens: ItemEnxoval[], tamanhos: Record<string, string>): string[] {
  return itens
    .filter((i) => i.grade.length > 0)
    .filter((i) => {
      const t = tamanhos[i.item_id];
      return !t || (t !== NAO_PRECISA && !i.grade.includes(t));
    })
    .map((i) => i.nome);
}

/** Resumo quando a função não tem enxoval no Catálogo e o Recrutamento descreveu à mão. */
export const resumoLivre = (funcao: string | null, texto: string): string =>
  `Função ${funcao ?? "—"} sem enxoval no Catálogo. Materiais informados pelo Recrutamento:\n${texto.trim()}`;
