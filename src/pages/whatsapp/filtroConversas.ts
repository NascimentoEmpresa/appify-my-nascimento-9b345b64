import type { WaConversa } from "./types";

interface Filtro {
  busca: string;
  /** Etiqueta escolhida nos chips. Vazio = todas. */
  etiqueta: string;
  /** Conversa aberta: fica no topo mesmo depois de zerar as não lidas. */
  selecionada: string | null;
}

/**
 * A lista da caixa de entrada, depois de escolhida a pasta.
 *
 * Até 06/11/2026 os chips de etiqueta acendiam mas não filtravam nada: o
 * `etiquetaSel` estava só nas dependências do useMemo, nunca no filtro.
 */
export function filtrarConversas<T extends WaConversa>(base: T[], { busca, etiqueta, selecionada }: Filtro): T[] {
  const t = busca.trim().toLowerCase();
  const lista = base.filter((c) => {
    if (etiqueta && !(c.contato?.etiquetas ?? []).includes(etiqueta)) return false;
    if (!t) return true;
    return [c.contato?.nome, c.contato?.nome_manual, c.contato?.wa_id, c.ultima_mensagem_preview, ...(c.contato?.etiquetas ?? [])]
      .some((v) => String(v ?? "").toLowerCase().includes(t));
  });

  // Não lidas sempre no topo. Quem espera resposta não pode ficar soterrado
  // por conversa que já foi respondida só porque a resposta é mais recente.
  //
  // A conversa aberta conta como "topo" mesmo depois de zerar as não lidas:
  // abrir uma conversa zera o contador, e sem isso ela despencaria da lista
  // no instante do clique, com o quadro se remontando embaixo do cursor.
  //
  // Dentro de cada grupo, mais recente primeiro; conversa sem mensagem
  // (criada pelo recrutamento, por exemplo) tem data nula e vai para o fim.
  const noTopo = (c: WaConversa) => (c.nao_lidas > 0 || c.id === selecionada ? 0 : 1);
  const quando = (c: WaConversa) => (c.ultima_mensagem_em ? Date.parse(c.ultima_mensagem_em) : -Infinity);
  return [...lista].sort((a, b) => noTopo(a) - noTopo(b) || quando(b) - quando(a));
}
