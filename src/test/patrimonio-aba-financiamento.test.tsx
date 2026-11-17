// SIS-2026-0909 — a aba Parcelas renderizada (revisão de 16/11): botões por
// ação, formulário com a linha crua, anexar comprovante a pagamento existente
// e as colunas Amortização / Juros / Saldo devedor na tabela principal.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const acesso: Record<string, boolean> = {};
vi.mock("@/hooks/useScreenAccess", () => ({
  useScreenAccess: (_menu: string, acao: string) => ({ data: !!acesso[acao], isLoading: false }),
}));

import { AbaFinanciamento, type ParcelaDaAba } from "@/pages/juridico/patrimonio/AbaFinanciamento";

const fin = { id: 1, patrimonio_id: 5, credor: "CAIXA", sistema_amortizacao: "SAC", indexador: "TR", prazo_meses: 420, incc_aplicacao: "a_confirmar" };
const pagamentos = [{ id: 70, parcela_id: 83, patrimonio_id: 5, data_pagamento: "2026-03-06", valor: 2370.11, comprovante_path: null }];
const tabelas: Record<string, unknown[]> = {
  JUR_PATRIMONIO_FINANCIAMENTOS: [fin],
  JUR_PATRIMONIO_PARCELA_PAGAMENTOS: pagamentos,
  JUR_PATRIMONIO_INCC_APLICACOES: [],
};
const db = {
  from: (t: string) => {
    const o: Record<string, unknown> = {};
    const fim = Promise.resolve({ data: tabelas[t] ?? [], error: null });
    for (const m of ["select", "eq", "order", "limit", "update", "insert", "delete", "single"]) o[m] = () => o;
    o.then = (a: (v: unknown) => unknown, b: (e: unknown) => unknown) => fim.then(a, b);
    return o;
  },
} as never;

const bruta83: ParcelaDaAba = {
  id: 83, patrimonio_id: 5, numero: 83, vencimento: "2026-03-06", valor: 2370.11, valor_pago: null,
  amortizacao: 601.06, juros: 1692.01, seguros_fghab: 52.04, taxas: 25, saldo_devedor: 206631.37,
};
// O que a tabela recebe: com a baixa do Malote, que pôs valor_pago na cópia.
const comBaixa83: ParcelaDaAba = { ...bruta83, valor_pago: 2400, baixa: "malote" };

const montar = () => render(
  <AbaFinanciamento db={db} patrimonioId={5} parcelas={[comBaixa83]} brutas={[bruta83]} autor="T" toast={() => {}}
    logHist={async () => {}} recarregarParcelas={async () => {}} abrirArquivo={() => {}} subirArquivo={async () => null} />,
);

beforeEach(() => { for (const k of Object.keys(acesso)) delete acesso[k]; });

describe("aba Parcelas — revisão de 16/11", () => {
  it("13. a tabela principal tem Amortização, Juros e Saldo devedor", async () => {
    const { container } = montar();
    await waitFor(() => expect(screen.getByText("CAIXA")).toBeTruthy());
    const cab = [...container.querySelectorAll("thead")].pop()!;
    const ths = [...cab.querySelectorAll("th")].map(t => t.textContent);
    expect(ths).toEqual(["Parcela", "Vencimento", "Valor devido", "Amortização", "Juros", "Seguros", "Taxas", "Valor pago", "Saldo devedor", "Situação", ""]);
    const linha = [...container.querySelectorAll("tbody tr")].find(tr => tr.textContent?.includes("83ª"))!;
    expect(within(linha as HTMLElement).getByText("R$ 601,06")).toBeTruthy();
    expect(within(linha as HTMLElement).getByText("R$ 1.692,01")).toBeTruthy();
    expect(within(linha as HTMLElement).getByText("R$ 206.631,37")).toBeTruthy();
  });

  it("1. quem só visualiza não vê botões de gravar/excluir", async () => {
    montar();
    await waitFor(() => expect(screen.getByText("CAIXA")).toBeTruthy());
    for (const t of ["+ Parcela", "⬆ Importar composição", "Editar condições", "Configurar INCC"]) expect(screen.queryByText(t)).toBeNull();
    fireEvent.click(screen.getByTitle("Detalhar"));
    expect(screen.queryByText("Editar composição")).toBeNull();
    expect(screen.queryByText("+ Registrar pagamento")).toBeNull();
    expect(screen.queryByText("Excluir")).toBeNull();
  });

  it("1. com as ações, os botões aparecem", async () => {
    Object.assign(acesso, { incluir: true, alterar: true, excluir: true });
    montar();
    await waitFor(() => expect(screen.getByText("Configurar INCC")).toBeTruthy());
    expect(screen.getByText("+ Parcela")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Detalhar"));
    expect(screen.getByText("Editar composição")).toBeTruthy();
    expect(screen.getByText("Excluir")).toBeTruthy();
  });

  it("2. Editar composição abre com o valor_pago do banco, não o da baixa do Malote", async () => {
    Object.assign(acesso, { alterar: true });
    const { container } = montar();
    await waitFor(() => expect(screen.getByText("CAIXA")).toBeTruthy());
    fireEvent.click(screen.getByTitle("Detalhar"));
    fireEvent.click(screen.getByText("Editar composição"));
    const campo = [...container.querySelectorAll(".jp-fg")].find(f => f.querySelector("label")?.textContent === "Valor pago (R$)")!;
    expect((campo.querySelector("input") as HTMLInputElement).value).toBe("");
    const amort = [...container.querySelectorAll(".jp-fg")].find(f => f.querySelector("label")?.textContent === "Amortização")!;
    expect((amort.querySelector("input") as HTMLInputElement).value).toBe("601.06");
  });

  it("11. Anexar comprovante aponta para o pagamento existente sem comprovante", async () => {
    Object.assign(acesso, { incluir: true, alterar: true });
    const { container } = montar();
    await waitFor(() => expect(screen.getByText("CAIXA")).toBeTruthy());
    fireEvent.click(screen.getByTitle("Detalhar"));
    await waitFor(() => expect(screen.getAllByText("⬆ Anexar comprovante").length).toBe(2));   // no pagamento e no rodapé
    fireEvent.click(screen.getAllByText("⬆ Anexar comprovante")[1]);
    const sel = [...container.querySelectorAll(".jp-modal select")][0] as HTMLSelectElement;
    expect(sel.value).toBe("70");
    expect([...sel.options].map(o => (o.textContent ?? "").replace(/\s+/g, " "))).toEqual(["Novo pagamento", "Pagamento de 06/03/2026 — R$ 2.370,11 (sem comprovante)"]);
    expect(screen.getByText("Anexar")).toBeTruthy();
    expect(screen.queryByText("Valor pago (R$)")).toBeNull();
  });
});
