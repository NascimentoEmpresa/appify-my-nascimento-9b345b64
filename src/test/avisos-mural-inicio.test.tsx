// 10/09/2026: "pra algumas pessoas apareceu só um card simples, em vez de
// aparecer com a imagem certinho e bonitinho".
//
// A causa: quem JÁ respondeu para de receber o gate (que mostra o cartaz) e
// passa a ver só a linha do mural do Início, que era texto puro. O mesmo aviso
// tinha duas caras conforme a pessoa já tivesse respondido ou não.
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const comImagem = {
  id: 1,
  titulo: "Novo Quadro de Avisos",
  mensagem: "Agora os comunicados importantes vêm por aqui.",
  publicado: true,
  publicado_em: "2026-09-10T12:05:00Z",
  criado_por_nome: "Iury de Jesus Silva",
  created_at: "2026-09-10T12:05:00Z",
  categoria: "Sistemas",
  resumo: "canal oficial de comunicação",
  expira_em: null,
  anexo_url: "https://exemplo.test/cartaz.png",
  anexo_nome: "cartaz.png",
  exigir_ciencia: true,
  bloquear_acesso: true,
  permitir_escolha: true,
};
const semImagem = { ...comImagem, id: 2, titulo: "Recesso de fim de ano", anexo_url: null, anexo_nome: null };

const mockUseNotificacoes = vi.fn();
vi.mock("@/hooks/useNotificacoes", () => ({
  useNotificacoes: () => mockUseNotificacoes(),
}));
vi.mock("react-router-dom", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

import { AvisosCard } from "@/components/notificacoes/AvisosCard";

beforeEach(() => {
  mockUseNotificacoes.mockReturnValue({ notificacoes: [comImagem, semImagem], podeVerQuadro: true });
});

describe("Quadro de Avisos no Início", () => {
  it("aviso com cartaz mostra a miniatura — não só texto", () => {
    render(<AvisosCard />);
    const linha = screen.getByText("Novo Quadro de Avisos").closest("button")!;
    // querySelector e nao getByRole("img"): a miniatura tem alt="" de
    // proposito — ao lado do titulo ela e decorativa, e um leitor de tela
    // anunciando "cartaz.png" antes do titulo do aviso so atrapalha.
    expect(linha.querySelector("img")).toHaveAttribute("src", comImagem.anexo_url);
  });

  it("aviso sem cartaz continua com o ícone da categoria, sem imagem quebrada", () => {
    render(<AvisosCard />);
    const linha = screen.getByText("Recesso de fim de ano").closest("button")!;
    expect(linha.querySelector("img")).toBeNull();
  });

  it("clicar na linha abre o aviso inteiro, com a imagem", () => {
    render(<AvisosCard />);
    fireEvent.click(screen.getByText("Novo Quadro de Avisos"));
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByText(/Agora os comunicados importantes/)).toBeInTheDocument();
    expect(within(dialogo).getByRole("img")).toHaveAttribute("src", comImagem.anexo_url);
  });

  it("a linha é um botão de verdade: navegável no teclado, não uma div clicável", () => {
    render(<AvisosCard />);
    expect(screen.getByText("Novo Quadro de Avisos").closest("button")).toBeInTheDocument();
  });
});
