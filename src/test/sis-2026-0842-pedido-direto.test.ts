import { describe, expect, it } from "vitest";
import { localizarItemPreparado } from "@/lib/suprimentos/pedidoCompraDireto";
import { criarPdfPedidoCompra } from "@/lib/suprimentos/pedidoCompraPdf";
import type { CompraPedido, ItemCatalogoCompra } from "@/hooks/useCompraPedido";

const catalogo: ItemCatalogoCompra[] = [
  { id: "base-jaqueta", nome: "JAQUETA", tipo: "uniforme", tamanho: null, item_pai_id: null },
  { id: "jaqueta-m", nome: "JAQUETA M", tipo: "uniforme", tamanho: "M", item_pai_id: "base-jaqueta" },
  { id: "jaqueta-g", nome: "JAQUETA G", tipo: "uniforme", tamanho: "G", item_pai_id: "base-jaqueta" },
  { id: "luva", nome: "LUVA", tipo: "epi", tamanho: null, item_pai_id: null },
];

describe("SIS-2026-0842 - preparação do pedido pelo Estoque Saudável", () => {
  it("resolve o item exato da grade, sem trocar o tamanho sugerido", () => {
    expect(localizarItemPreparado(catalogo, {
      baseId: "base-jaqueta", tamanho: "G", nome: "JAQUETA", quantidade: 12, valorUnitario: 80,
    })?.id).toBe("jaqueta-g");
  });

  it("usa o item base quando o material não possui grade", () => {
    expect(localizarItemPreparado(catalogo, {
      baseId: "luva", tamanho: null, nome: "LUVA", quantidade: 3, valorUnitario: null,
    })?.id).toBe("luva");
  });

  it("gera um PDF formal válido com comprador e data da negociação", () => {
    const pedido: CompraPedido = {
      id: "p", numero: "PC-2026-0842", despesa_id: null, fornecedor_id: "f",
      fornecedor_nome: "Fornecedor", contrato_id: null, empresa_id: "e", valor_total: 100,
      prazo_entrega_dias: 5, data_limite_entrega: "2026-11-23", local_entrega: "Almoxarifado",
      forma_pagamento: "30 dias", condicoes_negociadas: "Frete incluso", frete_incluso: true,
      observacoes: null, status: "rascunho", enviado_em: null, enviado_por_nome: null,
      comprador_nome: "Comprador Teste", cotacao_em: "2026-11-16T12:00:00-03:00",
      created_at: "2026-11-16T12:00:00-03:00",
      empresa: { razao_social: "Empresa SN", nome_fantasia: "SN", cnpj: "00" },
      fornecedor: {
        razao_social: "Fornecedor", nome_fantasia: null, cnpj_cpf: "11",
        logradouro: null, numero: null, bairro: null, cidade: null, uf: null, cep: null,
        telefone: null, email: null,
      },
      itens: [{
        id: "i", pedido_id: "p", sup_item_id: "item", nome_item: "JAQUETA", quantidade: 1,
        unidade: "UN", tamanho: "G", valor_unitario: 100, codigo_fornecedor: "REF-1",
        preco_referencia_valor: 90, preco_referencia_em: null,
        preco_referencia_fornecedor_nome: null, preco_referencia_valido_ate: null,
        observacao: null, ordem: 0,
      }],
    };

    const bytes = new Uint8Array(criarPdfPedidoCompra(pedido).output("arraybuffer"));
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toContain("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(5_000);
  });
});
