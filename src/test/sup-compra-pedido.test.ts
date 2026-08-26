import { describe, expect, it } from "vitest";
import {
  calcularDataLimiteEntrega,
  calcularTotalPedido,
  converterQuantidadeDigitada,
  confrontarQuantidade,
  encontrarItemPedidoParaRecebimento,
  normalizarDescricaoItem,
  obterValorSugeridoUltimoPreco,
} from "@/lib/suprimentos/compra";

// O pedido precisa materializar o prazo negociado: sem a data limite, compras
// aprovadas ficavam sem um marco objetivo para cobrar o fornecedor.
describe("prazo de entrega do pedido de compra", () => {
  it("calcula a data limite somando os dias negociados à data do pedido", () => {
    expect(calcularDataLimiteEntrega("2026-09-26", 12)).toBe("2026-10-08");
  });

  it("mantém prazo zero no próprio dia e aceita prazo ainda não informado", () => {
    expect(calcularDataLimiteEntrega("2026-09-26", 0)).toBe("2026-09-26");
    expect(calcularDataLimiteEntrega("2026-09-26", null)).toBeNull();
  });
});

// A conferência é cega porque mostrar "10" induzia o conferente a repetir o
// número sem contar canecas e copos fisicamente. O confronto só ocorre depois.
describe("confronto da quantidade fisicamente conferida", () => {
  it("classifica quantidade igual, menor e maior que a pedida", () => {
    expect(confrontarQuantidade(10, 10)).toBe("igual");
    expect(confrontarQuantidade(10, 8)).toBe("a_menos");
    expect(confrontarQuantidade(10, 12)).toBe("a_mais");
  });

  it("identifica mercadoria que não constava no pedido", () => {
    expect(confrontarQuantidade(null, 2)).toBe("item_nao_pedido");
  });
});

// O "tapete" representa o item livre que nunca existiu no catálogo. A NF pode
// variar acentos, caixa e espaços, mas ainda precisa consumir a linha do pedido
// para que o recebimento alcance o status recebido.
describe("casamento de item fora do catálogo no recebimento", () => {
  it("casa pela descrição normalizada quando não existe sup_item_id", () => {
    const itens = [
      { id: "linha-tapete", sup_item_id: null, nome_item: "Tapete  Antiderrapante" },
    ];

    expect(normalizarDescricaoItem("  TAPÉTE   antiderrapante ")).toBe("tapete antiderrapante");
    expect(encontrarItemPedidoParaRecebimento(
      itens, null, "  TAPÉTE   antiderrapante ",
    )?.id).toBe("linha-tapete");
  });

  it("não reutiliza uma linha do pedido já vinculada", () => {
    const itens = [
      { id: "linha-1", sup_item_id: null, nome_item: "Tapete" },
      { id: "linha-2", sup_item_id: null, nome_item: "Tapete" },
    ];

    expect(encontrarItemPedidoParaRecebimento(
      itens, null, "tapete", new Set(["linha-1"]),
    )?.id).toBe("linha-2");
  });
});

// A conversão durante cada tecla apagava a vírgula intermediária: "1,5"
// acabava persistido como 15. O campo agora preserva o texto e converte na saída.
describe("quantidade decimal digitada", () => {
  it("aceita vírgula e ponto como separador decimal", () => {
    expect(converterQuantidadeDigitada("1,5")).toBe(1.5);
    expect(converterQuantidadeDigitada("1.5")).toBe(1.5);
  });
});

// O pedido nasce com o último preço pago materializado pelo banco. A tela usa
// a referência somente enquanto o comprador ainda não informou outro valor.
describe("valor sugerido pelo histórico de compras", () => {
  it("usa o último preço pago quando a linha ainda não foi editada", () => {
    expect(obterValorSugeridoUltimoPreco({
      quantidade: 3,
      valor_unitario: null,
      preco_referencia_valor: 47.9,
    })).toBe(47.9);
  });

  it("preserva o valor negociado pelo comprador acima da sugestão", () => {
    expect(obterValorSugeridoUltimoPreco({
      quantidade: 3,
      valor_unitario: 44.5,
      preco_referencia_valor: 47.9,
    })).toBe(44.5);
  });

  it("mantém nulo para item nunca comprado", () => {
    expect(obterValorSugeridoUltimoPreco({ quantidade: 1 })).toBeNull();
  });
});

// O caso do frete elevando uma compra de R$ 5.000 para R$ 5.500 mostrou que o
// total precisa ser reconstituível linha a linha, além do snapshot do cabeçalho.
describe("total financeiro do pedido", () => {
  it("soma quantidade multiplicada pelo valor unitário de cada item", () => {
    expect(calcularTotalPedido([
      { quantidade: 2, valor_unitario: 1250.5 },
      { quantidade: 5, valor_unitario: 499.8 },
    ])).toBeCloseTo(5000, 2);
  });
});

/**
 * Número no formato brasileiro: PONTO é milhar, VÍRGULA é decimal.
 *
 * A primeira versão trocava só a vírgula por ponto, então "1.000" virava 1 e
 * "1.234,56" virava 0 — quantidade errada, em silêncio, dentro de um pedido de
 * compra. É o tipo de erro que só aparece quando a mercadoria chega errada.
 */
describe("converterQuantidadeDigitada — número em pt-BR", () => {
  it("vírgula é o separador decimal", () => {
    expect(converterQuantidadeDigitada("1,5")).toBe(1.5);
  });

  it("ponto sozinho também vale como decimal (teclado numérico)", () => {
    expect(converterQuantidadeDigitada("1.5")).toBe(1.5);
  });

  it("milhar com ponto NÃO vira 1", () => {
    expect(converterQuantidadeDigitada("1.000")).toBe(1000);
    expect(converterQuantidadeDigitada("12.500")).toBe(12500);
  });

  it("milhar e decimal juntos", () => {
    expect(converterQuantidadeDigitada("1.234,56")).toBe(1234.56);
  });

  it("vazio e lixo viram zero, sem quebrar", () => {
    expect(converterQuantidadeDigitada("")).toBe(0);
    expect(converterQuantidadeDigitada("abc")).toBe(0);
  });

  it("meio de digitação não quebra", () => {
    // O campo é convertido no blur, mas o total do cabeçalho lê a cada tecla.
    expect(converterQuantidadeDigitada("1,")).toBe(1);
  });
});
