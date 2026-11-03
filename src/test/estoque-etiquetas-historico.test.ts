import { describe, expect, it } from "vitest";
import type { LinhaEstoque } from "@/hooks/useSupEstoque";
import { filtrarLinhasEstoque } from "@/lib/suprimentos/estoqueEtiquetas";

function linha(parcial: Partial<LinhaEstoque>): LinhaEstoque {
  return {
    item_estoque_id: "estoque-1", sup_item_id: "item-1",
    arquivado_em: null, arquivado_motivo: null,
    codigo_item: "0000001", tamanho_item: null, base: null, codigos_lote: [],
    material: "ITEM ATIVO", tipo_material: "insumo", almoxarifado: "Central",
    valor_unitario: 0, custo_unitario: 0, valor_total: 0,
    preco_valido_ate: null, preco_vencido: false, estoque_minimo: 0,
    disponivel: 0, reservado: 0, fisico: 0, consumido: 0, etiquetas: 0,
    tamanhos: [], fornecedor_id: null, observacoes: null, localizacao: null,
    ...parcial,
  };
}

describe("Estoque & Etiquetas — conciliação de código histórico", () => {
  const ativa = linha({ item_estoque_id: "ativo" });
  const historica = linha({
    item_estoque_id: "historico", codigo_item: "0002626", material: "MOP CORTADA 60CM",
    arquivado_em: "2026-10-20T12:00:00Z", arquivado_motivo: "Saldo consumido e ficha retirada",
    consumido: 10, etiquetas: 10,
  });

  it("não mistura ficha arquivada na lista atual sem pesquisa", () => {
    expect(filtrarLinhasEstoque([ativa, historica], "", "todos", "todos")).toEqual([ativa]);
  });

  it("encontra a ficha arquivada pelo código sem exigir zeros à esquerda", () => {
    expect(filtrarLinhasEstoque([ativa, historica], "2626", "todos", "todos")).toEqual([historica]);
  });
});
