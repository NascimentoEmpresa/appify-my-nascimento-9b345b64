// Posto de trabalho x local exato da vaga (30/10/2026).
//
// "O posto de trabalho tá puxando errado" (vaga #1418, MOTORISTA CAT D da
// UFRGS): o card mostrava "Campus vale .av,bento gonçalves 9500 porto alegre"
// como Posto de Trabalho. A coluna `local_exato` tem DOIS sentidos:
//   • Solicitar Nova Vaga (encarregado, 21/09/2026) grava nela o NOME do
//     posto do catálogo escolhido;
//   • o wizard do Recrutamento/Central (ModalNovaVaga, criar e EDITAR) tem o
//     campo "Local exato da vaga", obrigatório e digitado — endereço, prédio.
// Editou a vaga do encarregado pelo lápis → o nome do posto virava endereço.
// Na cópia de 16/10, 95 de 148 vagas com posto tinham texto diferente dele.
//
// O posto certo está em `posto_id` (sup_posto, o mesmo de onde saem V.A/V.T e
// uniformes). O card mostra o posto pelo id e o texto digitado à parte, como
// "Local exato", só quando diz algo além do nome do posto.

const chave = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toUpperCase().replace(/\s+/g, " ");

export interface PostoELocal {
  /** Nome do posto do catálogo; vazio quando a vaga não tem posto. */
  posto: string;
  /** O local digitado, quando não é só o nome do posto repetido. */
  local: string;
}

/**
 * @param postoCatalogo nome do sup_posto de `posto_id` (null/"" se a vaga não tem posto)
 * @param localExato    a coluna `local_exato` como está gravada
 */
export function postoELocalDaVaga(postoCatalogo: string | null | undefined, localExato: string | null | undefined): PostoELocal {
  const posto = String(postoCatalogo ?? "").trim();
  const local = String(localExato ?? "").trim();
  if (!posto) return { posto: "", local };
  return { posto, local: chave(local) === chave(posto) ? "" : local };
}
