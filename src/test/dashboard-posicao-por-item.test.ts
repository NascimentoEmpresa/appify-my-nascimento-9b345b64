import { describe, expect, it } from "vitest";
import {
  agruparPosicaoPorFamilia,
  csvDaPosicaoPorItem,
  emCompra,
  rotuloTamanho,
  temPendencia,
} from "@/lib/suprimentos/posicaoPorItem";
import {
  consolidarDashboardsCompras,
  type DashboardComprasEstoqueDados,
  type PosicaoItem,
} from "@/lib/suprimentos/dashboardComprasEstoque";

const linha = (dados: Partial<PosicaoItem> = {}): PosicaoItem => ({
  base_id: "calca",
  item: "CALCA SARJA",
  tamanho: "M",
  codigo: "0000002",
  categoria: "uniforme",
  ordem_tamanho: 30,
  disponivel: 0,
  reservado: 0,
  fisico: 0,
  entrou: 0,
  saiu: 0,
  ajustes: 0,
  pendente_entrega: 0,
  aguardando_compra: 0,
  em_transito: 0,
  valor_unitario: 50,
  valor_total: 0,
  ...dados,
});

/**
 * O cenário que o solicitante descreveu, e o MESMO que a migration
 * 20261110000100 foi exercitada com no cluster descartável:
 *   calça sarja M → pendente 2, 50 em cotação no Malote
 *   calça sarja G → nada pendente, 20 comprados a receber
 *   botina 42     → pendente 4, sem ficha de estoque
 * Se este arquivo e o SQL divergirem, um dos dois está errado.
 */
const cenarioDoChamado = (): PosicaoItem[] => [
  linha({ tamanho: "M", disponivel: 10, reservado: 2, entrou: 20, saiu: 5, pendente_entrega: 2, aguardando_compra: 50, valor_total: 500 }),
  linha({ tamanho: "G", codigo: "0000003", ordem_tamanho: 40, entrou: 7, em_transito: 20 }),
  linha({ base_id: "botina", item: "BOTINA", tamanho: "42", codigo: "0000005", categoria: "insumo", ordem_tamanho: 1042, pendente_entrega: 4 }),
];

describe("posição por item — agrupamento por família", () => {
  it("soma a pendência dos tamanhos na família, como o solicitante pediu (calça sarja = 2)", () => {
    const familias = agruparPosicaoPorFamilia(cenarioDoChamado());
    const calca = familias.find((f) => f.base_id === "calca")!;
    expect(calca.pendente_entrega).toBe(2);
    expect(calca.aguardando_compra).toBe(50);
    expect(calca.em_transito).toBe(20);
    expect(calca.disponivel).toBe(10);
    expect(calca.entrou).toBe(27);
    expect(calca.saiu).toBe(5);
    expect(calca.tamanhos_com_pendencia).toBe(1);
  });

  it("item pedido e nunca estocado continua na lista", () => {
    const familias = agruparPosicaoPorFamilia(cenarioDoChamado());
    const botina = familias.find((f) => f.base_id === "botina")!;
    expect(botina.pendente_entrega).toBe(4);
    expect(botina.disponivel).toBe(0);
  });

  it("ordena pela maior pendência por padrão, e os tamanhos pela ordem de leitura", () => {
    const familias = agruparPosicaoPorFamilia(cenarioDoChamado());
    expect(familias.map((f) => f.base_id)).toEqual(["botina", "calca"]);
    expect(familias[1].tamanhos.map((t) => t.tamanho)).toEqual(["M", "G"]);
  });

  it("ordena por quem tem mais compra em andamento quando pedido", () => {
    const familias = agruparPosicaoPorFamilia(cenarioDoChamado(), { ordem: "em_compra" });
    expect(familias.map((f) => f.base_id)).toEqual(["calca", "botina"]);
  });

  it("o filtro de pendência é por família: tamanho já coberto continua visível com zero", () => {
    const familias = agruparPosicaoPorFamilia(cenarioDoChamado(), { soPendencias: true });
    const calca = familias.find((f) => f.base_id === "calca")!;
    expect(calca.tamanhos.map((t) => t.tamanho)).toEqual(["M", "G"]);
    expect(calca.tamanhos.find((t) => t.tamanho === "G")!.pendente_entrega).toBe(0);
  });

  it("esconde família sem pendência nem compra quando o filtro está ligado", () => {
    const paradas = [linha({ base_id: "meia", item: "MEIA", disponivel: 40, saiu: 3 })];
    expect(agruparPosicaoPorFamilia(paradas, { soPendencias: true })).toHaveLength(0);
    expect(agruparPosicaoPorFamilia(paradas, { soPendencias: false })).toHaveLength(1);
  });

  it("busca casa com nome e com código", () => {
    expect(agruparPosicaoPorFamilia(cenarioDoChamado(), { busca: "botina" })).toHaveLength(1);
    expect(agruparPosicaoPorFamilia(cenarioDoChamado(), { busca: "0000005" })).toHaveLength(1);
    expect(agruparPosicaoPorFamilia(cenarioDoChamado(), { busca: "sarja" })).toHaveLength(1);
    expect(agruparPosicaoPorFamilia(cenarioDoChamado(), { busca: "guarda-chuva" })).toHaveLength(0);
  });
});

describe("posição por item — leituras derivadas", () => {
  it("em compra soma as duas etapas, que nunca contam a mesma peça", () => {
    expect(emCompra({ aguardando_compra: 50, em_transito: 20 })).toBe(70);
  });

  it("sem tamanho é null no dado e 'Único' só na tela", () => {
    expect(rotuloTamanho(null)).toBe("Único");
    expect(rotuloTamanho("M")).toBe("M");
  });

  it("pendência conta entrega atrasada ou compra em andamento", () => {
    expect(temPendencia(linha({ pendente_entrega: 1 }))).toBe(true);
    expect(temPendencia(linha({ aguardando_compra: 1 }))).toBe(true);
    expect(temPendencia(linha({ em_transito: 1 }))).toBe(true);
    expect(temPendencia(linha({ disponivel: 99, saiu: 9 }))).toBe(false);
  });
});

describe("posição por item — CSV", () => {
  it("traz o subtotal da família antes dos tamanhos, com vírgula decimal", () => {
    const csv = csvDaPosicaoPorItem(agruparPosicaoPorFamilia(cenarioDoChamado(), { ordem: "item" }));
    const linhas = csv.split("\r\n");
    expect(linhas[0]).toContain("Pendente de entrega");
    expect(linhas[0]).toContain("Comprado, a receber");
    expect(linhas[1]).toContain("TOTAL DA FAMÍLIA");
    expect(linhas[1]).toContain("BOTINA");
    const calcaTotal = linhas.find((l) => l.includes("CALCA SARJA;TOTAL DA FAMÍLIA"))!;
    expect(calcaTotal.split(";")[9]).toBe("2");
    expect(calcaTotal.split(";")[10]).toBe("50");
  });

  it("escapa nome de item com ponto e vírgula", () => {
    const csv = csvDaPosicaoPorItem(
      agruparPosicaoPorFamilia([linha({ item: 'CALCA "SARJA"; AZUL', pendente_entrega: 1 })]),
    );
    expect(csv).toContain('"CALCA ""SARJA""; AZUL"');
  });
});

/** O consolidado "Todas as empresas" soma no cliente, não no banco. */
const painel = (posicao: PosicaoItem[] | undefined, resumo: Partial<DashboardComprasEstoqueDados["estoque_resumo"]> = {}) =>
  ({
    atualizado_em: "2026-11-10T00:00:00Z",
    periodo_disponivel: { inicio: null, fim: null, solicitacoes_inicio: null, solicitacoes_fim: null },
    filtros: { contratos: [], categorias: [], compradores: [] },
    resumo: {},
    estoque_resumo: {
      valor_total: 0, quantidade_fisica: 0, quantidade_reservada: 0, quantidade_itens: 0,
      itens_distintos: 0, entradas: 0, saidas: 0, ...resumo,
    },
    saving_resumo: { total: 0, implantacao: 0, execucao: 0 },
    solicitacoes_por_contrato: [], motivos_pendencias: [], cotacoes_por_comprador: [],
    cotacoes_por_solicitacao: [], evolucao: [], solicitacoes_recentes: [], cotacoes_recentes: [],
    estoque_por_categoria: [], saude_estoque: [], mais_movimentados: [], menos_movimentados: [],
    estoque_detalhado: [], saving_por_contrato: [],
    posicao_por_item: posicao,
  }) as unknown as DashboardComprasEstoqueDados;

describe("consolidação entre empresas", () => {
  it("soma o mesmo material de duas empresas por nome e tamanho, não por base_id", () => {
    const a = painel([linha({ base_id: "calca-hagg", pendente_entrega: 2, disponivel: 10 })]);
    const b = painel([linha({ base_id: "calca-agps", pendente_entrega: 3, disponivel: 4 })]);
    const linhas = consolidarDashboardsCompras([a, b]).posicao_por_item!;
    expect(linhas).toHaveLength(1);
    expect(linhas[0].pendente_entrega).toBe(5);
    expect(linhas[0].disponivel).toBe(14);
  });

  it("não inventa um código nem um preço quando as empresas divergem", () => {
    const a = painel([linha({ codigo: "0000002", valor_unitario: 50 })]);
    const b = painel([linha({ codigo: "0000777", valor_unitario: 61 })]);
    const [consolidada] = consolidarDashboardsCompras([a, b]).posicao_por_item!;
    expect(consolidada.codigo).toBeNull();
    expect(consolidada.valor_unitario).toBeNull();
  });

  it("soma os totais novos do resumo", () => {
    const a = painel([], { quantidade_pendente_entrega: 6, quantidade_aguardando_compra: 50 });
    const b = painel([], { quantidade_pendente_entrega: 1, quantidade_em_transito: 20 });
    const r = consolidarDashboardsCompras([a, b]).estoque_resumo;
    expect(r.quantidade_pendente_entrega).toBe(7);
    expect(r.quantidade_aguardando_compra).toBe(50);
    expect(r.quantidade_em_transito).toBe(20);
  });

  it("banco sem a migration: a chave fica ausente, e a tela avisa em vez de mostrar tabela vazia", () => {
    const consolidado = consolidarDashboardsCompras([painel(undefined), painel(undefined)]);
    expect(consolidado.posicao_por_item).toBeUndefined();
  });
});
