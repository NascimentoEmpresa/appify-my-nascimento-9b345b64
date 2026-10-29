import { describe, expect, it } from "vitest";
import {
  consolidarDashboardsCompras,
  type DashboardComprasEstoqueDados,
} from "@/lib/suprimentos/dashboardComprasEstoque";

function painel(empresa: string, pedidos: number, disponivel: number): DashboardComprasEstoqueDados {
  return {
    atualizado_em: `2026-10-${empresa === "A" ? "27" : "28"}T12:00:00Z`,
    filtros: {
      contratos: [{ id: `contrato-${empresa}`, nome: `Contrato ${empresa}`, status: "ATIVO" }],
      categorias: [{ valor: "uniforme", nome: "Uniformes" }],
      compradores: [`Comprador ${empresa}`],
    },
    resumo: {
      solicitacoes_total_geral: pedidos,
      solicitacoes: pedidos - 1,
      despachadas: pedidos - 2,
      pendentes: 1,
      tempo_medio_dias: empresa === "A" ? 2 : 4,
      cotacoes: 2,
      media_cotacoes: 1,
      licitacoes: 1,
      participacao_licitacoes: 50,
    },
    estoque_resumo: {
      valor_total: disponivel * 10,
      quantidade_fisica: disponivel + 2,
      quantidade_reservada: 2,
      quantidade_itens: disponivel,
      itens_distintos: 1,
      entradas: 3,
      saidas: 2,
    },
    saving_resumo: { total: 10, implantacao: 4, execucao: 6 },
    solicitacoes_por_contrato: [{ nome: `Contrato ${empresa}`, quantidade: pedidos, despachadas: pedidos - 2, pendentes: 1 }],
    motivos_pendencias: [{ nome: "Aguardando compra", quantidade: 1 }],
    cotacoes_por_comprador: [{ nome: `Comprador ${empresa}`, quantidade: 2 }],
    cotacoes_por_solicitacao: [{ nome: "1 cotação", quantidade: 2 }],
    evolucao: [{ mes: "2026-10", rotulo: "out/26", solicitacoes: pedidos - 1, cotacoes: 2, entradas: 3, saidas: 2 }],
    solicitacoes_recentes: [],
    cotacoes_recentes: [],
    estoque_por_categoria: [{ nome: "Uniformes", valor: disponivel * 10 }],
    saude_estoque: [{ nome: "Adequado", quantidade: 1, ordem: 1 }],
    mais_movimentados: [],
    menos_movimentados: [],
    estoque_detalhado: [],
    saving_por_contrato: [{ contrato: `Contrato ${empresa}`, valor_inicial: 100, valor_comprado: 90, saving: 10, percentual: 10 }],
  };
}

describe("dashboard de Suprimentos — consolidado de empresas", () => {
  it("soma o total histórico e separa físico, reservado e disponível", () => {
    const resultado = consolidarDashboardsCompras([painel("A", 10, 20), painel("B", 20, 30)]);

    expect(resultado.resumo.solicitacoes_total_geral).toBe(30);
    expect(resultado.resumo.solicitacoes).toBe(28);
    expect(resultado.estoque_resumo).toMatchObject({
      quantidade_fisica: 54,
      quantidade_reservada: 4,
      quantidade_itens: 50,
      valor_total: 500,
    });
    expect(resultado.evolucao).toEqual([
      expect.objectContaining({ mes: "2026-10", solicitacoes: 28, entradas: 6, saidas: 4 }),
    ]);
    expect(resultado.filtros.contratos).toHaveLength(2);
  });
});
