/**
 * Quanto de cada item do pedido já saiu e quanto ainda falta sair.
 *
 * Existe por causa do despacho PARCIAL: o encarregado pede 2 camisetas, sai 1
 * e a outra espera compra. O card de Pedidos de Materiais mostrava só o que
 * foi pedido, e o Supply precisava abrir o pedido para descobrir o que tinha
 * ido. Com os botões "Enviados" / "Pendentes envio" o card responde sozinho.
 *
 * Conta por QUANTIDADE, não por "o item tem etiqueta": é assim que 1 de 2
 * aparece nas duas listas. A view sup_pedido_situacao conta por item (basta
 * uma etiqueta para o item ser "atendido") — serve para o badge, não aqui.
 *
 * A fonte é a mesma de sempre: as etiquetas baixadas no pedido
 * (sup_est_tags_do_pedido), cada linha com a quantidade que saiu para um
 * pedido_item_id. Reserva em separação NÃO conta como enviada — a peça ainda
 * está na prateleira.
 *
 * SIS-2026-0799 (05/11/2026): a RPC descartava a saída cujo LOTE tinha sido
 * removido depois ("não temos mais em estoque"), e a peça enviada voltava
 * para "Pendentes envio" — 2.981 saídas em 869 pedidos. Corrigido na própria
 * RPC (migration 20261105009100): o ledger vale com ou sem o lote.
 */

export interface ItemParaEnvio {
  id: string;
  nome_item: string;
  tamanho: string | null;
  litros: string | null;
  quantidade: number;
  ordem: number;
}

export interface EtiquetaParaEnvio {
  pedido_item_id: string;
  quantidade: number;
}

export interface LinhaEnvio extends ItemParaEnvio {
  enviada: number;
  pendente: number;
}

export function calcularEnvioItens(
  itens: ItemParaEnvio[],
  etiquetas: EtiquetaParaEnvio[],
): LinhaEnvio[] {
  const saiuPorItem = new Map<string, number>();
  for (const t of etiquetas) {
    saiuPorItem.set(t.pedido_item_id, (saiuPorItem.get(t.pedido_item_id) ?? 0) + Number(t.quantidade || 0));
  }
  return [...itens]
    .sort((a, b) => a.ordem - b.ordem)
    .map((i) => {
      const enviada = saiuPorItem.get(i.id) ?? 0;
      // Nunca negativo: se saiu mais do que o pedido (item editado depois da
      // baixa), não há pendência — e "Enviados" continua mostrando o real.
      return { ...i, enviada, pendente: Math.max(0, (i.quantidade || 0) - enviada) };
    });
}

/**
 * Pedido DESPACHADO sem nenhuma saída registrada no estoque.
 *
 * Acontece com pedido levado a "Despachado" pelo Status sem baixar peça
 * (36 em produção em 05/11/2026, quase todos de antes da separação existir).
 * O badge diz "Despachado" — a view só chama de parcial quando ALGUM item
 * saiu — e listar tudo em "Pendentes envio" contradizia o badge e o
 * histórico. Nesses o card avisa que não há registro por peça, em vez de
 * afirmar que tudo falta.
 *
 * Despacho PARCIAL de verdade (algum item saiu, outro não) não entra aqui: o
 * que falta continua em "Pendentes envio", porque é verdade e é acionável.
 */
export function despachadoSemRegistroDeSaida(
  status: string | null | undefined,
  etiquetas: EtiquetaParaEnvio[],
): boolean {
  return status === "DESPACHADO"
    && !etiquetas.some((t) => Number(t.quantidade || 0) > 0);
}
