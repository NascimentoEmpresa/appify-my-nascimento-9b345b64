import { describe, expect, it } from "vitest";
import {
  enriquecerCatalogoPedidoCompra,
  filtrarItensCatalogoCompra,
  modeloDoMaterial,
  type ItemCatalogoCompra,
} from "@/lib/suprimentos/catalogoPedidoCompra";

const item = (parcial: Partial<ItemCatalogoCompra> & Pick<ItemCatalogoCompra, "id" | "nome">): ItemCatalogoCompra => ({
  tipo: "uniforme",
  tamanho: null,
  item_pai_id: null,
  codigo: null,
  almoxarifados: [],
  disponivel: 0,
  fisico: 0,
  situacaoEstoque: "sem_ficha",
  ...parcial,
});

describe("Catálogo do pedido de compra com identidade do estoque", () => {
  it("encontra manga longa pela descrição por extenso mesmo quando o cadastro usa ML", () => {
    const catalogo = [
      item({ id: "ml-g", nome: "CAMISETA VERMELHA (ML) G", tamanho: "G", codigo: "0002210" }),
      item({ id: "mc-g", nome: "CAMISETA VERMELHA (MC) G", tamanho: "G", codigo: "0002211" }),
    ];

    expect(filtrarItensCatalogoCompra(catalogo, "camiseta manga longa vermelha").map((i) => i.id))
      .toEqual(["ml-g"]);
    expect(modeloDoMaterial(catalogo[0].nome)).toBe("Manga longa");
  });

  it("busca pelo código e não corta os resultados nos primeiros doze", () => {
    const catalogo = Array.from({ length: 20 }, (_, indice) => item({
      id: `camiseta-${indice}`,
      nome: `CAMISETA VERMELHA (ML) ${indice}`,
      codigo: `00022${String(indice).padStart(2, "0")}`,
    }));

    expect(filtrarItensCatalogoCompra(catalogo, "camiseta vermelha")).toHaveLength(20);
    expect(filtrarItensCatalogoCompra(catalogo, "0002207")[0]?.id).toBe("camiseta-7");
  });

  it("soma apenas fichas ativas e preserva a identificação de ficha histórica", () => {
    const resultado = enriquecerCatalogoPedidoCompra(
      [
        { id: "ativo", nome: "JAQUETA G", tipo: "uniforme", tamanho: "G", item_pai_id: "base", codigo: "10" },
        { id: "historico", nome: "CAMISETA (ML)", tipo: "uniforme", tamanho: null, item_pai_id: null, codigo: "11" },
      ],
      [
        { id: "f1", sup_item_id: "ativo", arquivado_em: null, almoxarifado: { nome: "Matriz" } },
        { id: "f2", sup_item_id: "ativo", arquivado_em: "2026-01-01", almoxarifado: { nome: "Antigo" } },
        { id: "f3", sup_item_id: "historico", arquivado_em: "2026-01-01", almoxarifado: { nome: "Escritório" } },
      ],
      [
        { item_estoque_id: "f1", disponivel: 4, fisico: 5 },
        { item_estoque_id: "f1", disponivel: 2, fisico: 2 },
        { item_estoque_id: "f2", disponivel: 99, fisico: 99 },
        { item_estoque_id: "f3", disponivel: 10, fisico: 10 },
      ],
    );

    expect(resultado[0]).toMatchObject({
      situacaoEstoque: "ativo", disponivel: 6, fisico: 7, almoxarifados: ["Matriz"],
    });
    expect(resultado[1]).toMatchObject({
      situacaoEstoque: "historico", disponivel: 0, fisico: 0, almoxarifados: ["Escritório"],
    });
  });

  it("não oferece novamente um item já incluído no pedido", () => {
    const catalogo = [item({ id: "um", nome: "LUVA" }), item({ id: "dois", nome: "LUVA TÉRMICA" })];
    expect(filtrarItensCatalogoCompra(catalogo, "luva", new Set(["um"])).map((i) => i.id))
      .toEqual(["dois"]);
  });
});
