// APAGÃO 08/09/2026: o ERP não tinha ErrorBoundary nenhum, então um erro de
// render em UMA tela desmontava a árvore React inteira e o usuário via
// página branca — sem mensagem, sem menu, sem conseguir navegar. Estes
// testes travam o contrato do ErroDeTela: conter a falha e continuar
// mostrando algo acionável.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ErroDeTela } from "@/components/layout/ErroDeTela";

function Explode({ deve }: { deve: boolean }): JSX.Element {
  if (deve) throw new Error("s.trim is not a function");
  return <p>conteúdo da tela</p>;
}

beforeEach(() => {
  // O React loga o erro capturado; silencia pra não poluir a saída do teste.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErroDeTela", () => {
  it("deixa passar o conteúdo quando não há erro", () => {
    render(
      <ErroDeTela>
        <Explode deve={false} />
      </ErroDeTela>
    );
    expect(screen.getByText("conteúdo da tela")).toBeTruthy();
  });

  it("captura o erro de render em vez de deixar a página em branco", () => {
    expect(() =>
      render(
        <ErroDeTela>
          <Explode deve />
        </ErroDeTela>
      )
    ).not.toThrow();
    expect(screen.getByText("Esta tela não conseguiu abrir")).toBeTruthy();
  });

  it("mostra a mensagem técnica e a rota, pro diagnóstico não depender do console", () => {
    render(
      <ErroDeTela rota="/app/malote/orcamento-geral">
        <Explode deve />
      </ErroDeTela>
    );
    expect(screen.getByText(/s\.trim is not a function/)).toBeTruthy();
    expect(screen.getByText(/\/app\/malote\/orcamento-geral/)).toBeTruthy();
  });

  it("'Tentar de novo' limpa o estado de erro e re-renderiza o conteúdo", () => {
    // Flag externa em vez de "só na primeira montagem": o React re-tenta o
    // render ao capturar um erro, então um contador interno tornaria o teste
    // dependente do número de tentativas.
    const estado = { falhar: true };
    function Alternavel() {
      if (estado.falhar) throw new Error("falha transitória");
      return <p>conteúdo da tela</p>;
    }

    render(
      <ErroDeTela>
        <Alternavel />
      </ErroDeTela>
    );
    expect(screen.getByText("Esta tela não conseguiu abrir")).toBeTruthy();

    estado.falhar = false;
    fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/i }));
    expect(screen.getByText("conteúdo da tela")).toBeTruthy();
  });
});
