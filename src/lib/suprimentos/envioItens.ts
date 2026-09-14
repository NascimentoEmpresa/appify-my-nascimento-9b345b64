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
