export interface ItemCompraCalculo {
  quantidade: number;
  valor_unitario?: number | null;
  preco_referencia_valor?: number | null;
}

export type DivergenciaRecebimento = "igual" | "a_menos" | "a_mais" | "item_nao_pedido";

export interface ItemPedidoParaCasamento {
  id: string;
  sup_item_id: string | null;
  nome_item: string;
}

/**
 * Converte o texto decimal somente quando o campo é finalizado.
 *
 * Precisa entender número no formato brasileiro, onde o PONTO é separador de
 * milhar e a VÍRGULA é decimal. Trocar só a vírgula por ponto lia "1.000" como
 * 1 e "1.234,56" como 0 — quantidade errada, em silêncio, num pedido de compra.
 *
 * Regra: se houver vírgula, ela é o decimal e todo ponto é milhar. Sem
 * vírgula, o ponto é decimal (para quem digita "1.5" no teclado numérico),
 * exceto quando o padrão é claramente de milhar ("1.000", "12.500").
 */
export function converterQuantidadeDigitada(texto: string): number {
  const limpo = (texto ?? "").trim().replace(/\s/g, "");
  if (!limpo) return 0;

  let normalizado: string;
  if (limpo.includes(",")) {
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) {
    // "1.000" / "12.500.000" — só milhar, sem decimal.
    normalizado = limpo.replace(/\./g, "");
  } else {
    normalizado = limpo;
  }

  const valor = Number(normalizado);
  return Number.isFinite(valor) ? valor : 0;
}

/**
 * Espelha no frontend a regra de casamento usada pelos triggers do recebimento.
 * O identificador do catálogo tem precedência; sem ele, a descrição normalizada
 * permite receber itens livres como o "tapete" que motivou o chamado.
 */
export function normalizarDescricaoItem(descricao: string): string {
  return descricao
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
}

export function encontrarItemPedidoParaRecebimento(
  itens: ItemPedidoParaCasamento[],
  supItemId: string | null,
  descricao: string,
  idsJaVinculados: ReadonlySet<string> = new Set(),
): ItemPedidoParaCasamento | null {
  const disponiveis = itens.filter((item) => !idsJaVinculados.has(item.id));
  if (supItemId) {
    return disponiveis.find((item) => item.sup_item_id === supItemId) ?? null;
  }

  const descricaoNormalizada = normalizarDescricaoItem(descricao);
  if (!descricaoNormalizada) return null;
  return disponiveis.find(
    (item) => normalizarDescricaoItem(item.nome_item) === descricaoNormalizada,
  ) ?? null;
}

export function calcularDataLimiteEntrega(dataBase: string, prazoEntregaDias: number | null): string | null {
  if (prazoEntregaDias == null) return null;
  const data = new Date(`${dataBase}T12:00:00`);
  data.setDate(data.getDate() + Math.max(0, prazoEntregaDias));
  return data.toISOString().slice(0, 10);
}

export function calcularTotalPedido(itens: ItemCompraCalculo[]): number {
  return itens.reduce(
    (total, item) => total + Number(item.quantidade || 0) * Number(item.valor_unitario || 0),
    0,
  );
}

/**
 * O banco materializa no item do pedido o último preço pago encontrado em
 * sup_item_preco. Esta função é a fonte usada pela tela para preencher o
 * campo quando o valor corrente ainda não foi alterado pelo comprador.
 */
export function obterValorSugeridoUltimoPreco(item: ItemCompraCalculo): number | null {
  if (item.valor_unitario != null) return Number(item.valor_unitario);
  if (item.preco_referencia_valor != null) return Number(item.preco_referencia_valor);
  return null;
}

export function confrontarQuantidade(
  quantidadePedida: number | null,
  quantidadeConferida: number,
): DivergenciaRecebimento {
  if (quantidadePedida == null) return "item_nao_pedido";
  if (quantidadeConferida === quantidadePedida) return "igual";
  return quantidadeConferida < quantidadePedida ? "a_menos" : "a_mais";
}
