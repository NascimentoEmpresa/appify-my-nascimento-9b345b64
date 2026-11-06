import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ItemEstoqueSaudavel, PremissasEstoque } from "@/lib/suprimentos/estoqueSaudavel";
import { GradeReposicao } from "@/components/suprimentos/dashboard/GradeReposicao";
import { csvDaGradeReposicao, montarGradeReposicao } from "@/lib/suprimentos/gradeReposicao";

vi.mock("@/components/auth/AcessoGate", () => ({ AcessoGate: () => null }));

const premissas = {
  janela_meses: 3, janela_inicio: "2026-09-01", janela_fim: "2026-11-06",
  lead_time_dias: 10, ciclo_revisao_dias: 30,
} as PremissasEstoque;
const item = (dados: Partial<ItemEstoqueSaudavel> = {}): ItemEstoqueSaudavel => ({
  base_id: "camisa", item: "CAMISA", tamanho: "M", ordem: 30,
  demanda_janela: 90, demanda_mensal: 30, disponivel: 10, em_transito: 20,
  alvo: 50, comprar: 20, aguardando_compra: 12, fora_do_plano: false, liquidar: false,
  ...dados,
}) as ItemEstoqueSaudavel;

describe("previsão de abastecimento", () => {
  it("mostra a compra líquida calculada pela RPC junto do trânsito e do Malote, separados por tamanho", () => {
    render(<GradeReposicao itens={[
      item(), item({ tamanho: "G", ordem: 40, em_transito: 5, comprar: 35, aguardando_compra: 4 }),
    ]} premissas={premissas} almoxarifadoSelecionado={false} />);
    expect(screen.getByText(/Giro dos últimos 3 meses/)).toHaveTextContent("01/09/2026 a 06/11/2026");
    const linha = screen.getByRole("rowheader", { name: "Comprar para repor" }).closest("tr")!;
    expect(within(linha).getAllByRole("cell").map((celula) => celula.textContent)).toEqual(["20", "35"]);
    const transito = screen.getByRole("rowheader", { name: "Aguardando entrega" }).closest("tr")!;
    expect(within(transito).getAllByRole("cell").map((celula) => celula.textContent)).toEqual(["20", "5"]);
    expect(screen.getByText(/ainda precisam ser concluídas/)).toBeInTheDocument();
  });

  it("mantém item coberto pelo trânsito na grade mesmo sem compra adicional", () => {
    const grade = montarGradeReposicao([item({ comprar: 0, em_transito: 40 })], "", true);
    expect(grade.familias[0].itens.get("M")?.comprar).toBe(0);
    expect(grade.familias[0].itens.get("M")?.em_transito).toBe(40);
  });

  it("preserva o tamanho saudável da mesma família como compra zero", () => {
    const grade = montarGradeReposicao([
      item(), item({ tamanho: "P", ordem: 20, comprar: 0, em_transito: 0, aguardando_compra: 0 }),
    ], "", true);
    expect(grade.tamanhos).toEqual(["P", "M"]);
    expect(grade.familias[0].itens.get("P")?.comprar).toBe(0);
  });

  it("exclui itens fora do plano e em liquidação e não mistura famílias de mesmo nome", () => {
    const grade = montarGradeReposicao([
      item(), item({ base_id: "outro" }), item({ base_id: "fora", fora_do_plano: true }),
      item({ base_id: "liquidar", liquidar: true }),
    ], " cami ", true);
    expect(grade.familias.map((familia) => familia.id)).toEqual(["camisa", "outro"]);
  });

  it("pagina todas as famílias e busca também as que não cabem na primeira página", () => {
    const itens = Array.from({ length: 21 }, (_, i) => item({ base_id: String(i), item: `ITEM ${String(i).padStart(2, "0")}` }));
    render(<GradeReposicao itens={itens} premissas={premissas} almoxarifadoSelecionado />);
    expect(screen.queryByRole("rowheader", { name: "ITEM 20" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(screen.getByRole("rowheader", { name: "ITEM 10" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar item na previsão"), { target: { value: "ITEM 20" } });
    expect(screen.getByRole("rowheader", { name: "ITEM 20" })).toBeInTheDocument();
    expect(screen.getByText(/página 1 de 1/)).toBeInTheDocument();
    expect(screen.getByText(/não têm almoxarifado de destino/)).toBeInTheDocument();
  });

  it("exporta todos os resultados filtrados, distingue tamanho ausente de zero e preserva frações", () => {
    const csv = csvDaGradeReposicao(montarGradeReposicao([
      item({ item: 'CAMISA; "AZUL"', comprar: 0, em_transito: 1.125 }),
      item({ base_id: "calca", item: "CALÇA", tamanho: "G", ordem: 40 }),
    ], "", true));
    expect(csv).toContain('"Item";"Indicador";"M";"G"');
    expect(csv).toContain('"CAMISA; ""AZUL""";"Aguardando entrega";"1,125";""');
    expect(csv).toContain('"CAMISA; ""AZUL""";"Comprar para repor";"0";""');
    expect(csv.split("\r\n")).toHaveLength(13);
  });
});
