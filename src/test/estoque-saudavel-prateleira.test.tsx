import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ItemEstoqueSaudavel } from "@/lib/suprimentos/estoqueSaudavel";

// Renderiza o tooltip com a linha fornecida ao gráfico, sem depender de
// medidas de layout do jsdom nem de coordenadas de mouse do Recharts.
vi.mock("recharts", async (importOriginal) => {
  const original = await importOriginal<typeof import("recharts")>();
  const { createContext, useContext } = await import("react");
  const Linhas = createContext<Record<string, unknown>[]>([]);
  return {
    ...original,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
    BarChart: ({ data, children }: { data: Record<string, unknown>[]; children: ReactNode }) => (
      <Linhas.Provider value={data}>{children}</Linhas.Provider>
    ),
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Legend: () => null,
    Bar: ({ name }: { name: string }) => <span>{name}</span>,
    Tooltip: ({ content }: { content: (props: unknown) => ReactNode }) => (
      <>{useContext(Linhas).map((linha, indice) => (
        <div key={indice}>{content({ active: true, payload: [{ payload: linha }], label: linha.rotulo })}</div>
      ))}</>
    ),
  };
});

import { GraficoFaixaPorItem } from "@/components/suprimentos/dashboard/EstoqueSaudavel";

function item(patch: Partial<ItemEstoqueSaudavel> = {}): ItemEstoqueSaudavel {
  return {
    base_id: "calca", item: "CALÇA", tamanho: "M", fisico: 10,
    reservado: 2, disponivel: 8, demanda_janela: 20, demanda_mensal: 5,
    minimo: 3, alvo: 15, comprar: 7, em_transito: 0, aguardando_compra: 12,
    ...patch,
  } as ItemEstoqueSaudavel;
}

describe("prateleira saudável — pendências do Malote", () => {
  it("exibe a pendência por tamanho sem somá-la ao disponível ou à compra sugerida", () => {
    render(<GraficoFaixaPorItem itens={[item(), item({ tamanho: "G", aguardando_compra: 4 })]} />);

    expect(screen.getByText("CALÇA · M")).toBeInTheDocument();
    expect(screen.getByText("CALÇA · G")).toBeInTheDocument();
    expect(screen.getByText("Aguardando compra: 12")).toBeInTheDocument();
    expect(screen.getByText("Aguardando compra: 4")).toBeInTheDocument();
    expect(screen.getAllByText("Disponível para novo pedido: 8")).toHaveLength(2);
    expect(screen.getAllByText("Comprar agora: 7")).toHaveLength(2);
  });

  it("inclui item com compra pendente mesmo sem saldo ou consumo e preserva a fração", () => {
    render(<GraficoFaixaPorItem itens={[item({
      item: "PRODUTO NOVO", tamanho: null, disponivel: 0,
      demanda_janela: 0, comprar: 0, aguardando_compra: 1.125,
    })]} />);

    expect(screen.getByText("PRODUTO NOVO · único")).toBeInTheDocument();
    expect(screen.getByText("Aguardando compra: 1,125")).toBeInTheDocument();
  });

  it("distingue ausência do campo no servidor de uma quantidade zero", () => {
    render(<GraficoFaixaPorItem itens={[
      item({ tamanho: "P", aguardando_compra: undefined }),
      item({ tamanho: "M", aguardando_compra: 0 }),
    ]} />);

    expect(screen.getByText("Aguardando compra: —")).toBeInTheDocument();
    expect(screen.getByText("Aguardando compra: 0")).toBeInTheDocument();
  });
});
