import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InformacoesGithubChamado } from "@/pages/chamados/InformacoesGithubChamado";
import type { Evento } from "@/pages/chamados/types";

describe("tabela de informações do GitHub no chamado", () => {
  it("mostra automaticamente a PR e as quatro métricas solicitadas", () => {
    render(
      <InformacoesGithubChamado eventos={[
        {
          created_at: "2026-10-28T12:00:00Z",
          meta: {
            canal: "github", origem: "merge", pr_numero: 1016,
            pr_commits: 2, pr_linhas_adicionadas: 859, pr_arquivos_alterados: 7,
            pr_url: "https://github.com/exemplo/repositorio/pull/1016",
          },
        },
      ] as unknown as Evento[]} />,
    );

    expect(screen.getByText("Informações do GitHub na conclusão")).toBeInTheDocument();
    expect(screen.getByText("Número PR")).toBeInTheDocument();
    expect(screen.getByText("Linhas de código adicionadas")).toBeInTheDocument();
    expect(screen.getByText("Commits criados")).toBeInTheDocument();
    expect(screen.getByText("Arquivos alterados")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /#1016/i })).toHaveAttribute("href", "https://github.com/exemplo/repositorio/pull/1016");
    expect(screen.getByText("859")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });
});
