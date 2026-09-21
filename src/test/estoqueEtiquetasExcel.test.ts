import { describe, expect, it } from "vitest";
import { montarLinhasExcelEstoque, nomeArquivoEstoque } from "@/lib/suprimentos/estoqueEtiquetasExcel";
import type { LinhaEstoque } from "@/hooks/useSupEstoque";

const linha: LinhaEstoque = {
  item_estoque_id: "estoque-1", sup_item_id: "item-1", codigo_item: "EPI-001", tamanho_item: "M",
  base: null, codigos_lote: [], material: "Luva", tipo_material: "EPI", almoxarifado: "Central",
  valor_unitario: 12.5, custo_unitario: 12.5, valor_total: 125, preco_valido_ate: "2026-12-31",
  preco_vencido: false, estoque_minimo: 10, disponivel: 8, reservado: 2, fisico: 10, consumido: 3,
  etiquetas: 13, tamanhos: ["M", "G"], fornecedor_id: null, observacoes: "Conferido", localizacao: "A-01",
};

describe("exportação de estoque", () => {
  it("mantém os valores numéricos e reúne os tamanhos em uma linha", () => {
    expect(montarLinhasExcelEstoque([linha])).toEqual([{
      "Código": "EPI-001", "Material": "Luva", "Tipo": "EPI", "Almoxarifado": "Central",
      "Localização": "A-01", "Tamanho": "M, G", "Disponível": 8, "Reservado": 2,
      "Físico": 10, "Consumido": 3, "Estoque mínimo": 10, "Custo unitário": 12.5,
      "Valor total": 125, "Entradas registradas": 13, "Preço válido até": "2026-12-31", "Observações": "Conferido",
    }]);
  });

  it("nomeia o arquivo com escopo e data", () => {
    expect(nomeArquivoEstoque("filtrado", new Date(2026, 8, 18))).toBe("estoque-filtrado-2026-09-18.xlsx");
  });
});
