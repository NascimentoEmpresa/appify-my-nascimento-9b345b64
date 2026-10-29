import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * Teste de fumaça da aba "Rotatividade do Estoque".
 *
 * O projeto testa regra de negócio, não rendering — e a lógica de leitura está
 * coberta em rotatividade-estoque.test.ts. Este arquivo existe por um motivo
 * específico: a aba monta 7 gráficos e 2 tabelas a partir de um jsonb grande,
 * e um campo nulo inesperado derruba a tela inteira em branco. Então ele monta
 * o componente com o PAYLOAD REAL colhido da produção (fixture ao lado) e
 * confere que os números-herói chegam na tela.
 *
 * A fixture foi capturada da própria RPC rodando sobre a base de produção em
 * 13/10/2026 (HAGG, uniformes, 01/01 a 13/10/2026). Para regerá-la depois de
 * mudar a RPC, veja o comentário no topo da migration 20261013000012.
 */

import payload from "./fixtures/rotatividade-estoque-producao.json";

const porItemTamanho = payload.por_peca.slice(0, 6).map((linha, indice) => ({
  codigo: `ITEM-${String(indice + 1).padStart(3, "0")}`,
  item: linha.peca,
  tamanho: linha.tamanho_top,
  pedidas: linha.pedidas,
  entradas: linha.entradas,
  saidas: linha.saidas,
  fisico: linha.saldo_disponivel,
  reservado: 0,
  saldo_disponivel: linha.saldo_disponivel,
  cadastro_ativo: true,
  giro: linha.giro,
}));
const primeiroItem = porItemTamanho[0];
const payloadDetalhado = {
  ...payload,
  resumo: {
    ...payload.resumo,
    saldo_fisico: payload.resumo.saldo_disponivel,
    reservado: 0,
    item_tamanho_mais_sai: {
      codigo: primeiroItem.codigo, item: primeiroItem.item, tamanho: primeiroItem.tamanho,
      unidades: primeiroItem.saidas, saldo: primeiroItem.saldo_disponivel,
    },
    item_tamanho_mais_entra: {
      codigo: primeiroItem.codigo, item: primeiroItem.item, tamanho: primeiroItem.tamanho,
      unidades: primeiroItem.entradas, saldo: primeiroItem.saldo_disponivel,
    },
    item_tamanho_maior_giro: {
      codigo: primeiroItem.codigo, item: primeiroItem.item, tamanho: primeiroItem.tamanho,
      giro: primeiroItem.giro, saidas: primeiroItem.saidas, saldo: primeiroItem.saldo_disponivel,
    },
    peca_mais_sai: { codigo: primeiroItem.codigo, peca: primeiroItem.item, unidades: primeiroItem.saidas },
  },
  por_item_tamanho: [
    ...porItemTamanho,
    {
      codigo: "0002626", item: "MOP CORTADA 60CM", tamanho: null,
      pedidas: 0, entradas: 10, saidas: 10, fisico: 0, reservado: 0,
      saldo_disponivel: 0, cadastro_ativo: false, giro: null,
    },
  ],
  por_peca: payload.por_peca.map((linha, indice) => ({
    ...linha,
    codigo: `ITEM-${String(indice + 1).padStart(3, "0")}`,
    fisico: linha.saldo_disponivel,
    reservado: 0,
  })),
};

const { consultar, consultarHistorico, consultarFornecimentos } = vi.hoisted(() => ({
  consultar: vi.fn(),
  consultarHistorico: vi.fn(),
  consultarFornecimentos: vi.fn(),
}));

const historicoUniformes = [
  { mes: "2026-10-01", origem_demanda: "implantacao_aditivo", tipo_uniforme: "CAMISA POLO", tamanho: "M", solicitados: 12, utilizados: 9 },
  { mes: "2026-09-01", origem_demanda: "substituicao", tipo_uniforme: "CALÇA OPERACIONAL", tamanho: "G", solicitados: 8, utilizados: 8 },
  { mes: "2026-09-01", origem_demanda: "reposicao", tipo_uniforme: "CAMISA POLO", tamanho: "M", solicitados: 4, utilizados: 4 },
];

const fornecimentosUniformes = [
  {
    data_fornecimento: "2026-10-13", colaborador: "Maria da Silva", matricula: "1010",
    contrato: "Contrato Alfa", posto: "Recepção", protocolo: "SUP-2026-0010",
    tipo_uniforme: "CAMISA POLO", tamanho: "M", quantidade: 2,
  },
];

vi.mock("@/hooks/useDashboardRotatividadeEstoque", () => ({
  useDashboardRotatividadeEstoque: (empresaId: string | null, filtros: unknown) => {
    consultar(empresaId, filtros);
    return { data: payloadDetalhado, error: null, isLoading: false, isFetching: false, refetch: vi.fn() };
  },
  useHistoricoUniformes: (empresaId: string | null, filtros: unknown) => {
    consultarHistorico(empresaId, filtros);
    return { data: historicoUniformes, error: null, isLoading: false, isFetching: false, refetch: vi.fn() };
  },
  useFornecimentosUniformesColaborador: (empresaId: string | null, filtros: unknown) => {
    consultarFornecimentos(empresaId, filtros);
    return { data: fornecimentosUniformes, error: null, isLoading: false, isFetching: false, refetch: vi.fn() };
  },
}));

// recharts mede o container pelo DOM, e no jsdom toda caixa tem altura zero —
// os gráficos não desenhariam e poluiriam a saída com avisos. O que este teste
// precisa provar é que os dados chegam nos cartões e nas tabelas.
vi.mock("recharts", async () => {
  const React = await import("react");
  const vazio = (nome: string) => {
    const C = ({ children }: { children?: React.ReactNode }) =>
      React.createElement("div", { "data-recharts": nome }, children);
    C.displayName = nome;
    return C;
  };
  return {
    ResponsiveContainer: vazio("ResponsiveContainer"),
    BarChart: vazio("BarChart"),
    LineChart: vazio("LineChart"),
    AreaChart: vazio("AreaChart"),
    Bar: vazio("Bar"),
    Line: vazio("Line"),
    Area: vazio("Area"),
    Cell: vazio("Cell"),
    XAxis: vazio("XAxis"),
    YAxis: vazio("YAxis"),
    CartesianGrid: vazio("CartesianGrid"),
    Tooltip: vazio("Tooltip"),
    Legend: vazio("Legend"),
    LabelList: vazio("LabelList"),
  };
});

import { RotatividadeEstoque } from "@/components/suprimentos/dashboard/RotatividadeEstoque";

/**
 * Os valores esperados saem do próprio payload, formatados como a tela
 * formata. A base de produção é viva — as unidades mudaram entre duas
 * capturas da fixture no mesmo dia —, então número fixo no teste quebraria
 * sozinho a cada regeração.
 */
const esperado = (n: number) => n.toLocaleString("pt-BR");
const esperadoPct = (n: number) =>
  `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
/**
 * `toLocaleString` com `style: "currency"` separa "R$" do número com espaço
 * NÃO quebrável (U+00A0), e o testing-library normaliza isso para espaço comum
 * ao ler o DOM. Sem trocar, a comparação falha com os dois textos idênticos na
 * tela.
 */
const esperadoMoeda = (n: number) =>
  n
    .toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 })
    .replace(new RegExp(String.fromCharCode(160), "g"), " ");

function montar() {
  return render(
    <RotatividadeEstoque
      empresaId="5a61c769-21d8-4e61-b9bb-506b8db0bce8"
      inicio="2026-01-01"
      fim="2026-10-13"
      contratoId={null}
    />,
  );
}

describe("aba Rotatividade do Estoque — render com payload de produção", () => {
  it("abre em Todas as categorias e repassa o período e o contrato do filtro da página", () => {
    consultar.mockClear();
    consultarHistorico.mockClear();
    consultarFornecimentos.mockClear();
    montar();
    expect(consultar).toHaveBeenCalledWith(
      "5a61c769-21d8-4e61-b9bb-506b8db0bce8",
      expect.objectContaining({
        inicio: "2026-01-01",
        fim: "2026-10-13",
        contratoId: null,
        categoria: "",
      }),
    );
    expect(consultarHistorico).toHaveBeenCalledWith(
      "5a61c769-21d8-4e61-b9bb-506b8db0bce8",
      { inicio: "2026-01-01", fim: "2026-10-13", contratoId: null },
    );
    expect(consultarFornecimentos).toHaveBeenCalledWith(
      "5a61c769-21d8-4e61-b9bb-506b8db0bce8",
      { inicio: "2026-01-01", fim: "2026-10-13", contratoId: null },
    );
  });

  it("mostra a demanda mensal por item e tamanho, separada pela origem", () => {
    montar();
    expect(screen.getByText("Demanda Mensal por Item, Tamanho e Origem")).toBeInTheDocument();
    expect(screen.getAllByText("CAMISA POLO").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Implantação / aditivo")).toBeInTheDocument();
    expect(screen.getByText("Substituição")).toBeInTheDocument();
    expect(screen.getByText("Reposição")).toBeInTheDocument();
    expect(screen.getByText("Solicitados")).toBeInTheDocument();
    expect(screen.getByText("Utilizados")).toBeInTheDocument();
  });

  it("identifica o colaborador e a data em que o uniforme saiu do almoxarifado", () => {
    montar();
    expect(screen.getByText("Fornecimentos de Uniformes por Colaborador")).toBeInTheDocument();
    expect(screen.getByText("Maria da Silva")).toBeInTheDocument();
    expect(screen.getByText("13/10/2026")).toBeInTheDocument();
    expect(screen.getByText("SUP-2026-0010")).toBeInTheDocument();
  });

  it("responde as quatro perguntas do diretor nos cartões de destaque", () => {
    montar();
    const r = payloadDetalhado.resumo;

    expect(screen.getByText("Item/tamanho que mais sai")).toBeInTheDocument();
    expect(screen.getAllByText(`${r.item_tamanho_mais_sai.item} · ${r.item_tamanho_mais_sai.tamanho}`).length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(`${esperado(r.item_tamanho_mais_sai.unidades)} saídas físicas`)).length).toBeGreaterThan(0);

    expect(screen.getByText("Item/tamanho que mais entra")).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`${esperado(r.item_tamanho_mais_entra.unidades)} unidades recebidas`)),
    ).toBeInTheDocument();

    expect(screen.getByText("Item/tamanho de maior giro")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`giro ${r.item_tamanho_maior_giro.giro}`.replace(".", ",")))).toBeInTheDocument();

    // "qual uniforme mais sai" — a peça aparece no destaque E na tabela de
    // peças, então são duas ocorrências legítimas.
    expect(screen.getByText("Peça que mais sai")).toBeInTheDocument();
    expect(screen.getAllByText(r.peca_mais_sai.peca).length).toBeGreaterThanOrEqual(1);
  });

  it("mostra valor, unidades e giro com os números da produção", () => {
    montar();
    const r = payload.resumo;
    expect(screen.getByText(esperadoMoeda(r.valor_pedido))).toBeInTheDocument();
    expect(screen.getByText("Unidades pedidas")).toBeInTheDocument();
    expect(screen.getByText(esperado(r.unidades_pedidas))).toBeInTheDocument();
    expect(screen.getByText("Giro do estoque")).toBeInTheDocument();
    expect(screen.getByText(esperado(r.saldo_disponivel))).toBeInTheDocument();
  });

  it("avisa que entrada/saída cobrem janela menor que os pedidos", () => {
    montar();
    expect(screen.getByText("Duas janelas de tempo diferentes")).toBeInTheDocument();
    expect(screen.getByText(/04\/08\/2026/)).toBeInTheDocument();
  });

  it("não apresenta o valor como total fechado, porque metade não tem preço", () => {
    montar();
    const r = payload.resumo;
    const cobertura =
      Math.round(((r.unidades_pedidas - r.unidades_sem_preco) / r.unidades_pedidas) * 1000) / 10;
    // Metade das unidades não tem preço em sup_estoque_item: o cartão tem que
    // dizer "estimado" e expor a cobertura, senão o número vira total fechado.
    expect(cobertura).toBeLessThan(100);
    expect(
      screen.getByText(`estimado · ${esperadoPct(cobertura)} das unidades têm preço cadastrado`),
    ).toBeInTheDocument();
  });

  it("publica os alertas de qualidade de dado que a RPC devolveu", () => {
    montar();
    expect(
      screen.getByText(/Tamanho que sai do estoque e o formulário não oferece/),
    ).toBeInTheDocument();
    expect(screen.getByText("XGG, EXGG")).toBeInTheDocument();
    expect(
      screen.getByText(/Itens do catálogo com nome quase igual/),
    ).toBeInTheDocument();
  });

  it("monta a tabela por item e tamanho com código e saldo conciliado", () => {
    montar();
    expect(screen.getByText("Detalhe por Item e Tamanho")).toBeInTheDocument();
    const tabela = screen.getAllByRole("table").find((item) => within(item).queryByText("Saídas físicas"));
    expect(tabela).toBeDefined();
    expect(within(tabela!).getByText("Código")).toBeInTheDocument();
    expect(within(tabela!).getByText("Físico")).toBeInTheDocument();
    expect(within(tabela!).getByText("Reservado")).toBeInTheDocument();
    expect(within(tabela!).getAllByRole("row").length).toBe(porItemTamanho.length + 2);
    expect(within(tabela!).getByText("ITEM-001")).toBeInTheDocument();
    expect(within(tabela!).getByText("0002626")).toBeInTheDocument();
    expect(within(tabela!).getByText("Histórico encerrado")).toBeInTheDocument();
  });

  it("credita o levantamento, dizendo de quantas pessoas a grade saiu", () => {
    montar();
    const l = payload.levantamento_resumo;
    expect(
      screen.getByText(
        new RegExp(
          `${esperado(l.respostas)} respostas de ${esperado(l.pessoas)} colaboradores em ${esperado(
            l.contratos,
          )} contratos`,
        ),
      ),
    ).toBeInTheDocument();
    // Quem respondeu três vezes não pode pesar três vezes na grade.
    expect(screen.getByText(/conta uma vez, pela resposta mais recente/)).toBeInTheDocument();
  });

  it("compara a grade declarada com a saída real e aponta o maior desvio", () => {
    montar();
    expect(screen.getByText("Grade Declarada x Saída Real")).toBeInTheDocument();
    expect(screen.getByText(/Maior desvio:/)).toBeInTheDocument();
  });
});
