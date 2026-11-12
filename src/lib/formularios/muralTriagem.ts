/**
 * Triagem por IA do Mural do Início (12/11/2026, pedido do Pablo).
 *
 * A Edge mural-triagem-ia marca cada comentário positivo do mês como
 * recomendado ou NÃO recomendado para um mural público (comparação com o
 * líder, "deveria ser o líder do setor", crítica disfarçada a terceiros,
 * assunto pessoal…), com um motivo curto. Fica gravado em
 * CS_FORM_MURAL_TRIAGEM_IA (mig 20261112234500).
 *
 * A regra da TELA é esta:
 *   - não recomendado e não habilitado à mão → BLOQUEADO: continua pendente,
 *     mas fica fora do "Liberar os N" da pessoa e do "Liberar todos";
 *   - habilitado à mão → volta ao envio normal (com as duas confirmações);
 *   - sem triagem (IA falhou, não respondeu a tempo, migration ainda não
 *     entrou) → segue como antes da triagem: liberável.
 *
 * Só o PENDENTE é bloqueado: o que já está no mural ou foi recusado não muda
 * de lugar por causa da IA.
 */

export interface TriagemItem {
  recomendado: boolean | null;
  motivo: string | null;
  habilitado: boolean;
}

interface ItemComStatus { status: string }

/** O comentário está fora da liberação por sugestão da IA? */
export function bloqueadoPelaIA(item: ItemComStatus, triagem: TriagemItem | null | undefined): boolean {
  return item.status === "pendente" && !!triagem && triagem.recomendado === false && !triagem.habilitado;
}

/** Foi sinalizado pela IA (bloqueado agora ou reabilitado à mão)? */
export function sinalizadoPelaIA(item: ItemComStatus, triagem: TriagemItem | null | undefined): boolean {
  return item.status === "pendente" && !!triagem && triagem.recomendado === false;
}

/**
 * Separa uma lista em o que pode ir no envio e o que a IA segurou. A ordem
 * de cada lado é a da lista de entrada.
 */
export function separarPelaTriagem<T extends ItemComStatus>(
  lista: T[],
  triagem: ReadonlyMap<string, TriagemItem>,
  chave: (i: T) => string,
): { liberaveis: T[]; bloqueados: T[] } {
  const liberaveis: T[] = [];
  const bloqueados: T[] = [];
  for (const i of lista) (bloqueadoPelaIA(i, triagem.get(chave(i))) ? bloqueados : liberaveis).push(i);
  return { liberaveis, bloqueados };
}

/** Pendentes que a IA ainda não leu (aviso de triagem incompleta). */
export function semTriagem<T extends ItemComStatus>(
  lista: T[],
  triagem: ReadonlyMap<string, TriagemItem>,
  chave: (i: T) => string,
): T[] {
  return lista.filter((i) => i.status === "pendente" && !triagem.has(chave(i)));
}
