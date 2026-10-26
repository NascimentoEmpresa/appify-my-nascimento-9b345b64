// APAGÃO 08/09/2026: o ERP não tinha ErrorBoundary nenhum, então um erro de
// render em UMA tela desmontava a árvore React inteira e o usuário via
// página branca — sem mensagem, sem menu, sem conseguir navegar. Estes
// testes travam o contrato do ErroDeTela: conter a falha e continuar
// mostrando algo acionável.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ErroDeTela } from "@/components/layout/ErroDeTela";
import { ehErroDePermissao } from "@/lib/erroDePermissao";

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
    expect(screen.getByText("Sistema temporariamente indisponível")).toBeTruthy();
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

  it("'Recarregar' recarrega a página que falhou", () => {
    // 24/09/2026: o botão da tela de erro passou a ser "Recarregar" (pedido
    // do Pablo). O recarregar é estático no componente justamente para o
    // teste observar sem navegar de verdade.
    const recarregar = vi.spyOn(ErroDeTela, "recarregar").mockImplementation(() => {});
    render(
      <ErroDeTela>
        <Explode deve />
      </ErroDeTela>
    );
    fireEvent.click(screen.getByRole("button", { name: /Recarregar/i }));
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("erro de PERMISSÃO mostra 'Sem acesso' (403), não 'Sistema indisponível'", () => {
    function SemPermissao(): JSX.Element {
      throw Object.assign(new Error("permission denied for table malote_despesa"), { code: "42501" });
    }
    render(
      <MemoryRouter>
        <ErroDeTela rota="/app/malote/aprovacoes">
          <SemPermissao />
        </ErroDeTela>
      </MemoryRouter>
    );
    expect(screen.getByText("Você não tem acesso a esta área")).toBeTruthy();
    expect(screen.queryByText("Sistema temporariamente indisponível")).toBeNull();
  });
});

describe("ehErroDePermissao", () => {
  it("reconhece RLS/privilégio e ignora erro comum de código", () => {
    expect(ehErroDePermissao({ code: "42501", message: "x" })).toBe(true);
    expect(ehErroDePermissao(new Error("new row violates row-level security policy"))).toBe(true);
    expect(ehErroDePermissao({ status: 403, message: "x" })).toBe(true);
    expect(ehErroDePermissao(new Error("s.trim is not a function"))).toBe(false);
    expect(ehErroDePermissao(null)).toBe(false);
  });
});
