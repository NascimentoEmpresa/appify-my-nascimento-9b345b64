import { describe, expect, it } from "vitest";
import {
  consolidarDashboardsCompras,
  type DashboardComprasEstoqueDados,
} from "@/lib/suprimentos/dashboardComprasEstoque";

function painel(empresa: string, pedidos: number, disponivel: number): DashboardComprasEstoqueDados {
  return {
    atualizado_em: `2026-10-${empresa === "A" ? "27" : "28"}T12:00:00Z`,
    periodo_disponivel: {
      inicio: empresa === "A" ? "2026-03-17" : "2026-04-01",
      fim: "2026-10-28",
      solicitacoes_inicio: empresa === "A" ? "2026-03-17" : "2026-04-01",
      solicitacoes_fim: "2026-10-28",
      itens_registrados_inicio: empresa === "A" ? "2026-08-04" : "2026-08-10",
      movimentos_inicio: empresa === "A" ? "2026-08-04" : "2026-08-10",
      cotacoes_inicio: empresa === "A" ? "2026-05-01" : "2026-06-01",
    },
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
    cotacoes_malote_por_comprador: [{ nome: `Comprador Malote ${empresa}`, quantidade: 1 }],
    cotacoes_licitacao_por_comprador: [{ nome: `Comprador Licitação ${empresa}`, quantidade: 1 }],
    cotacoes_por_comprador: [{ nome: `Comprador ${empresa}`, quantidade: 2 }],
    cotacoes_por_solicitacao: [{ nome: "1 cotação", quantidade: 2 }],
    evolucao: [{ mes: "2026-10", rotulo: "out/26", solicitacoes: pedidos - 1, cotacoes: 2, entradas: 3, saidas: 2 }],
    entregas_resumo: empresa === "A"
      ? { total_despachado: 3, correios: 2, supervisores: 1, confirmadas: 1, sem_modalidade: 0 }
      : { total_despachado: 2, correios: 0, supervisores: 1, confirmadas: 1, sem_modalidade: 1 },
    entregas_por_responsavel: empresa === "A"
      ? [{ nome: "João Supervisor", correios: 0, supervisores: 1, sem_modalidade: 0, total: 1 }]
      : [{ nome: "João Supervisor", correios: 0, supervisores: 1, sem_modalidade: 0, total: 1 }],
    entregas_recentes: [{
      id: `PED-${empresa}`,
      data: `2026-10-${empresa === "A" ? "27" : "28"}T12:00:00Z`,
      contrato: `Contrato ${empresa}`,
      destino: `Posto ${empresa}`,
      modalidade: "SUPERVISOR",
      responsavel: "João Supervisor",
      comprovacao: "CONFIRMADA",
      recebedor: `Recebedor ${empresa}`,
      rastreio: null,
    }],
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
    expect(resultado.cotacoes_malote_por_comprador).toEqual([
      { nome: "Comprador Malote A", quantidade: 1 },
      { nome: "Comprador Malote B", quantidade: 1 },
    ]);
    expect(resultado.cotacoes_licitacao_por_comprador).toEqual([
      { nome: "Comprador Licitação A", quantidade: 1 },
      { nome: "Comprador Licitação B", quantidade: 1 },
    ]);
    expect(resultado.entregas_resumo).toEqual({
      total_despachado: 5,
      correios: 2,
      supervisores: 2,
      confirmadas: 2,
      sem_modalidade: 1,
    });
    expect(resultado.entregas_por_responsavel).toEqual([
      { nome: "João Supervisor", correios: 0, supervisores: 2, sem_modalidade: 0, total: 2 },
    ]);
    expect(resultado.entregas_recentes?.map((linha) => linha.id)).toEqual(["PED-B", "PED-A"]);
    expect(resultado.periodo_disponivel).toMatchObject({
      inicio: "2026-03-17",
      solicitacoes_inicio: "2026-03-17",
      itens_registrados_inicio: "2026-08-04",
      movimentos_inicio: "2026-08-04",
      cotacoes_inicio: "2026-05-01",
    });
  });
});
