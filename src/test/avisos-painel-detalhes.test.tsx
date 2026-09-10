// Pedido do Pablo (10/09/2026): "quero que ao clicar em Detalhes [...] apareça
// quem respondeu oq". O painel mora dentro do Visualizar do Quadro de Avisos e
// só existe quando o aviso pede ciência.
//
// É teste de RENDER, e não da lógica pura (que está em
// avisos-respostas-detalhe.test.ts), porque o que se quer travar aqui é o
// caminho da tela: abrir o aviso, clicar no botão, ver nome + resposta.
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const respostas = [
  { notificacao_id: 1, user_id: "u1", escolha: "CONCORDO", respondido_em: "2026-09-10T12:00:00Z", observacao: null },
  { notificacao_id: 1, user_id: "u2", escolha: "DISCORDO", respondido_em: "2026-09-10T13:00:00Z", observacao: "o prazo é curto demais" },
];

const aviso = {
  id: 1,
  titulo: "Novo Quadro de Avisos",
  mensagem: "Agora os comunicados importantes vêm por aqui.",
  publicado: true,
  publicado_em: "2026-09-10T09:05:00Z",
  criado_por_nome: "Iury de Jesus Silva",
  created_at: "2026-09-10T09:05:00Z",
  categoria: "Sistemas",
  resumo: "canal oficial de comunicação",
  expira_em: null,
  anexo_url: null,
  anexo_nome: null,
  exigir_ciencia: true,
  bloquear_acesso: true,
  permitir_escolha: true,
};

const mockUseNotificacoes = vi.fn();
vi.mock("@/hooks/useNotificacoes", () => ({
  useNotificacoes: () => mockUseNotificacoes(),
}));

import QuadroAvisos from "@/pages/central-servicos/QuadroAvisos";

beforeEach(() => {
  mockUseNotificacoes.mockReturnValue({
    notificacoes: [aviso],
    historico: respostas,
    alvos: [],
    setores: [],
    pessoas: [{ id: "u1", nome: "Ana Souza" }, { id: "u2", nome: "Bruno Lima" }],
    carregando: false,
    podeVerQuadro: true,
    podeCriar: true,
    podeEditar: true,
    podeExcluir: true,
    salvar: { mutateAsync: vi.fn(), isPending: false },
    excluir: { mutateAsync: vi.fn() },
    subirAnexo: vi.fn(),
  });
});

/** Abre o Visualizar do único aviso da lista. */
function abrirVisualizar() {
  render(<QuadroAvisos />);
  fireEvent.click(screen.getByRole("button", { name: /Visualizar/i }));
  return screen.getByRole("dialog");
}

describe("Quadro de Avisos › Visualizar › Detalhes", () => {
  it("a lista de quem respondeu começa escondida — o Visualizar abre no panorama", () => {
    const dialogo = abrirVisualizar();
    expect(within(dialogo).getByRole("button", { name: /Detalhes/i })).toBeInTheDocument();
    expect(within(dialogo).queryByText("Ana Souza")).not.toBeInTheDocument();
  });

  it("clicar em Detalhes mostra quem respondeu o quê, com o nome resolvido", () => {
    const dialogo = abrirVisualizar();
    fireEvent.click(within(dialogo).getByRole("button", { name: /Detalhes/i }));
    // A resposta é lida NA LINHA da pessoa: "Concordo" solto no diálogo
    // também casaria com o botão de filtro e com a linha de regras.
    const daAna = within(dialogo).getByText("Ana Souza").closest("li")!;
    const doBruno = within(dialogo).getByText("Bruno Lima").closest("li")!;
    expect(within(daAna).getByText("Concordo")).toBeInTheDocument();
    expect(within(doBruno).getByText("Discordo")).toBeInTheDocument();
  });

  it("mostra o que a pessoa escreveu ao discordar — é a informação que faz abrir a lista", () => {
    const dialogo = abrirVisualizar();
    fireEvent.click(within(dialogo).getByRole("button", { name: /Detalhes/i }));
    expect(within(dialogo).getByText(/o prazo é curto demais/)).toBeInTheDocument();
  });

  it("o filtro Discordo deixa só quem discordou", () => {
    const dialogo = abrirVisualizar();
    fireEvent.click(within(dialogo).getByRole("button", { name: /Detalhes/i }));
    fireEvent.click(within(dialogo).getByRole("button", { name: /^Discordo \(1\)$/ }));
    expect(within(dialogo).getByText("Bruno Lima")).toBeInTheDocument();
    expect(within(dialogo).queryByText("Ana Souza")).not.toBeInTheDocument();
  });

  it("aviso sem ciência não tem painel nenhum: não há resposta para detalhar", () => {
    mockUseNotificacoes.mockReturnValue({
      ...mockUseNotificacoes(),
      notificacoes: [{ ...aviso, exigir_ciencia: false }],
      historico: [],
    });
    const dialogo = abrirVisualizar();
    expect(within(dialogo).queryByRole("button", { name: /Detalhes/i })).not.toBeInTheDocument();
  });
});
