import type { ItemCatalogoCompra } from "@/lib/suprimentos/catalogoPedidoCompra";

export interface ItemPreparadoPedidoCompra {
  baseId: string;
  tamanho: string | null;
  nome: string;
  quantidade: number;
  valorUnitario: number | null;
}

export interface PreparacaoPedidoCompra {
  empresaId: string;
  origem: "estoque_saudavel" | "manual";
  itens: ItemPreparadoPedidoCompra[];
}

/** Resolve a linha item+tamanho do painel para o item canônico do catálogo. */
export function localizarItemPreparado(
  catalogo: ItemCatalogoCompra[],
  preparado: ItemPreparadoPedidoCompra,
) {
  if (preparado.tamanho) {
    return catalogo.find((item) =>
      item.item_pai_id === preparado.baseId && item.tamanho === preparado.tamanho
    );
  }
  return catalogo.find((item) => item.id === preparado.baseId);
}
