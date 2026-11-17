import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ArvoreModulosPicker } from "@/pages/chamados/impacto/ArvoreModulosPicker";
import { indexarArvore, montarArvoreModulos, rotuloModulo } from "@/lib/chamados/arvoreModulos";

// SIS-2026-0921 — o seletor Setor → telas: clicar no setor abre as telas ao
// lado; marca telas de setores diferentes; a posição não sai.

const arvore = montarArvoreModulos([
  { id: "ctrl", label: "Controladoria", groups: [{ label: "Ferramentas", items: [
    { label: "Lucratividade de Contratos", to: "/app/ctrl/lucro" },
    { label: "Auditoria da Controladoria", to: "/app/ctrl/auditoria" },
  ] }] },
  { id: "fin", label: "Financeiro", groups: [{ label: "Tesouraria", items: [{ label: "Fluxo de Caixa", to: "/app/fin/caixa" }] }] },
]);
const indice = indexarArvore(arvore);
const rotulo = (v: string) => rotuloModulo(v, indice);

afterEach(cleanup);

function Multiplo({ onMudar, destaque }: { onMudar: (v: string[]) => void; destaque?: string }) {
  const [v, setV] = useState<string[]>(destaque ? [destaque] : []);
  return <ArvoreModulosPicker multiplo arvore={arvore} indice={indice} rotulo={rotulo} value={v} destaque={destaque}
    onChange={(x) => { setV(x); onMudar(x); }} placeholder="Selecionar" />;
}

describe("ArvoreModulosPicker", () => {
  it("abre setores, mostra as telas do setor clicado e marca de setores diferentes", () => {
    const onMudar = vi.fn();
    render(<Multiplo onMudar={onMudar} />);
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getAllByText("Controladoria").length).toBeGreaterThan(0);
    expect(screen.getByText("Financeiro")).toBeTruthy();
    // Primeiro setor já aberto ao lado.
    fireEvent.click(screen.getByText("Lucratividade de Contratos"));
    fireEvent.click(screen.getAllByText("Financeiro")[0]);
    expect(screen.queryByText("Auditoria da Controladoria")).toBeNull();
    fireEvent.click(screen.getByText("Fluxo de Caixa"));
    expect(onMudar).toHaveBeenLastCalledWith(["/app/ctrl/lucro", "/app/fin/caixa"]);
    fireEvent.click(screen.getByText("Concluir"));
    expect(screen.getByText("Controladoria › Lucratividade de Contratos")).toBeTruthy();
    expect(screen.getByText("Financeiro › Fluxo de Caixa")).toBeTruthy();
  });

  it("a posição (destaque) não sai pelo clique", () => {
    const onMudar = vi.fn();
    render(<Multiplo onMudar={onMudar} destaque="/app/ctrl/lucro" />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("Lucratividade de Contratos"));
    expect(onMudar).not.toHaveBeenCalled();
  });

  it("simples: escolher uma tela fecha e grava a rota; 'Outro' como extra", () => {
    const onChange = vi.fn();
    render(<ArvoreModulosPicker arvore={arvore} indice={indice} rotulo={rotulo} value="" onChange={onChange}
      extras={[{ value: "outro", label: "Outro" }]} placeholder="Posição" />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("Auditoria da Controladoria"));
    expect(onChange).toHaveBeenCalledWith("/app/ctrl/auditoria");
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("Outro"));
    expect(onChange).toHaveBeenLastCalledWith("outro");
  });

  it("busca filtra setores e telas", () => {
    render(<Multiplo onMudar={() => {}} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.change(screen.getByPlaceholderText("Buscar módulo..."), { target: { value: "caixa" } });
    expect(screen.queryByText("Controladoria")).toBeNull();
    expect(screen.getByText("Fluxo de Caixa")).toBeTruthy();
  });
});
