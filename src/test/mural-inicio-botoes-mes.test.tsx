// 12/11/2026 (Pablo): "opção de passar o mês, só dois botões de passar e
// voltar" no cartão de Reconhecimento do Início. Antes eram setinhas de 20 px
// no meio do subtítulo, que passavam despercebidas.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useMuralReconhecimento", () => ({ useMuralInicio: () => ({ data: [], isLoading: false, isError: false }) }));

import { CartaoReconhecimento, type ItemCartao } from "@/components/reconhecimento/ReconhecimentoCard";

const item = (chave: string, colaborador: string): ItemCartao => ({
  chave, colaborador, setor: "RH", cargo: null, avatar_url: null, nota: "5", escala: 5, comentario: "Sempre ajuda a equipe.",
});

describe("cartão do Início — botões de mês", () => {
  it("mostra os dois botões; no mês mais novo o 'Próximo mês' fica apagado", () => {
    const anterior = vi.fn();
    render(<CartaoReconhecimento mes="2026-10" itens={[item("a", "FULANA DE TAL")]} navMes={{ anterior }} />);
    const voltar = screen.getByRole("button", { name: /Mês anterior/ });
    const passar = screen.getByRole("button", { name: /Próximo mês/ });
    expect(passar).toBeDisabled();
    expect(voltar).toBeEnabled();
    fireEvent.click(voltar);
    expect(anterior).toHaveBeenCalledTimes(1);
    expect(screen.getByText("outubro de 2026")).toBeInTheDocument();
  });

  it("com um mês só (sem navMes), não há botão de mês", () => {
    render(<CartaoReconhecimento mes="2026-09" itens={[item("a", "FULANA DE TAL")]} />);
    expect(screen.queryByRole("button", { name: /Mês anterior/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Próximo mês/ })).toBeNull();
  });
});
