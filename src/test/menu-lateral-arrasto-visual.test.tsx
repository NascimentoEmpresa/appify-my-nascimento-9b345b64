import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OrganizarMenuLateral from "@/pages/sistemas/menuLateral/OrganizarMenuLateral";

vi.mock("@/components/layout/Sidebar", async () => {
  const { Circle } = await import("lucide-react");
  return {
    NAV_MODULOS: ["Origem", "Destino"].map((nome) => ({
      id: nome.toLowerCase(), label: nome, description: nome, icon: Circle,
      basePath: `/app/${nome.toLowerCase()}`, status: "active",
      groups: [{ label: nome, items: [
        { label: `Tela ${nome}`, to: `/app/${nome.toLowerCase()}`, icon: Circle },
        ...(nome === "Origem" ? [
          { label: "Tela Extra", to: "/app/extra", icon: Circle },
          { label: "Tela Outra", to: "/app/outra", icon: Circle },
        ] : []),
      ] }],
    })),
  };
});
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: () => null }));
vi.mock("@/hooks/useScreenAccess", () => ({ useScreenAccess: () => ({ data: true }) }));
vi.mock("@/hooks/useMenuLateral", () => ({
  CHAVE_MENU_LATERAL: ["menu-lateral"],
  useMenuLateralSalvo: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const retangulo = (x: number, y: number, width: number, height: number): DOMRect => ({
  x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}),
});

beforeEach(() => {
  // O jsdom não tem PointerEvent nem layout. Os sensores e o DragOverlay são
  // reais; só fornecemos as coordenadas dos dois cartões da tela de teste.
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId = 1;
    isPrimary = true;
    pointerType = "mouse";
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const modulo = this.closest("section")?.querySelector("h3")?.textContent;
    const x = modulo === "Destino" ? 220 : 0;
    if (this.tagName === "SECTION") return retangulo(x, 0, 200, 300);
    if (this.title.startsWith("/app/")) return retangulo(x + 20, this.title === "/app/extra" ? 120 : this.title === "/app/outra" ? 160 : 80, 160, 30);
    if (this.firstElementChild?.querySelector("p")?.textContent === modulo) return retangulo(x + 10, 50, 180, 180);
    return retangulo(0, 0, 640, 600);
  });
});

afterEach(async () => {
  fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 60));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function iniciarArrasto(selecao: string[] = []) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(<QueryClientProvider client={cliente}><OrganizarMenuLateral /></QueryClientProvider>);
  const origem = await screen.findByTitle("/app/origem");
  for (const nome of selecao) fireEvent.click(screen.getByRole("checkbox", { name: `Selecionar ${nome}` }));
  for (const nome of selecao) expect(screen.getByRole("checkbox", { name: `Selecionar ${nome}` })).toBeChecked();
  fireEvent.pointerDown(origem, { button: 0, clientX: 40, clientY: 90 });
  fireEvent.pointerMove(document, { clientX: 50, clientY: 90 });
  await waitFor(() => expect(document.querySelector(".pointer-events-none.fixed.inset-0")).not.toBeNull());
  fireEvent.pointerMove(document, { clientX: 260, clientY: 90 });
  const previa = await waitFor(() => {
    const elemento = screen.getAllByText(/^Tela (Origem|Extra|Outra)$/).find((el) => !container.contains(el));
    expect(elemento).toBeDefined();
    return elemento!;
  });
  return { container, origem, previa };
}

async function soltarNoDestino() {
  fireEvent.pointerUp(document, { clientX: 260, clientY: 90 });
  const dialogo = await screen.findByRole("dialog");
  // O sensor suprime o clique da soltura por 50 ms após encerrar o arrasto.
  // A escolha no diálogo é uma interação posterior, não esse mesmo clique.
  await new Promise((resolve) => setTimeout(resolve, 60));
  return dialogo;
}

describe("arrasto visual entre módulos", () => {
  it("mostra a prévia acima da página e a move junto ao cursor sem abrir a confirmação", async () => {
    const { container, origem, previa } = await iniciarArrasto();
    const camada = previa.parentElement!.parentElement!;
    expect(camada.parentElement).toBe(document.body);
    expect(camada).toHaveStyle({ position: "fixed", pointerEvents: "none", zIndex: "70" });
    expect(origem).toHaveClass("opacity-30");
    expect(origem.style.transform).toBe("");
    const fundo = document.querySelector(".pointer-events-none.fixed.inset-0")!;
    expect(container.contains(fundo)).toBe(false);
    expect(fundo).toHaveClass("pointer-events-none", "bg-black/30");
    expect(screen.getByText("Solte em Destino")).toHaveAttribute("role", "status");
    expect(screen.queryByRole("dialog")).toBeNull();
    const posicao = camada.style.transform;
    fireEvent.pointerMove(document, { clientX: 300, clientY: 120 });
    await waitFor(() => expect(camada.style.transform).not.toBe(posicao));
  });

  it("retira o fundo e a prévia ao soltar e só então pede confirmação", async () => {
    const { previa } = await iniciarArrasto();
    fireEvent.pointerUp(document, { clientX: 260, clientY: 90 });
    expect(await screen.findByRole("dialog")).toHaveTextContent("O que deseja fazer?");
    expect(previa).not.toBeInTheDocument();
    expect(document.querySelector(".pointer-events-none.fixed.inset-0")).toBeNull();
    expect(screen.getByTitle("/app/origem")).not.toHaveClass("opacity-30");
  });

  it("Escape limpa o destaque e o fundo sem abrir confirmação nem mover o submódulo", async () => {
    const { previa } = await iniciarArrasto();
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(previa).not.toBeInTheDocument());
    expect(document.querySelector(".pointer-events-none.fixed.inset-0")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Solte em Destino")).toBeNull();
    expect(screen.getByTitle("/app/origem").closest("section")?.querySelector("h3")).toHaveTextContent("Origem");
  });

  it("arrasta os selecionados juntos e só move o grupo depois de confirmar", async () => {
    const { origem } = await iniciarArrasto(["Tela Extra", "Tela Origem"]);
    expect(screen.getByText("2 submódulos")).toBeInTheDocument();
    expect(screen.getByTitle("/app/extra")).toHaveClass("opacity-30");
    const dialogo = await soltarNoDestino();
    expect(within(dialogo).getAllByRole("listitem").map((el) => el.textContent)).toEqual(["Tela Extra", "Tela Origem"]);
    expect(origem.closest("section")?.querySelector("h3")).toHaveTextContent("Origem");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Mover" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    for (const rota of ["/app/origem", "/app/extra"]) {
      expect(screen.getByTitle(rota).closest("section")?.querySelector("h3")).toHaveTextContent("Destino");
    }
    expect(screen.getByTitle("/app/outra").closest("section")?.querySelector("h3")).toHaveTextContent("Origem");
    const destino = screen.getByRole("heading", { name: "Destino" }).closest("section")!;
    expect([...destino.querySelectorAll("[title^='/app/']")].map((el) => el.getAttribute("title"))).toEqual(["/app/extra", "/app/origem", "/app/destino"]);
    expect(screen.queryByText("2 selecionados")).toBeNull();
    expect(screen.getByRole("button", { name: "Salvar (1)" })).toBeEnabled();
  });

  it("copiar o grupo preserva as duas origens e acrescenta as duas cópias", async () => {
    await iniciarArrasto(["Tela Origem", "Tela Extra"]);
    const dialogo = await soltarNoDestino();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Copiar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    for (const rota of ["/app/origem", "/app/extra"]) {
      expect(screen.getAllByTitle(rota).map((el) => el.closest("section")?.querySelector("h3")?.textContent).sort()).toEqual(["Destino", "Origem"]);
    }
    expect(screen.getByRole("button", { name: "Salvar (1)" })).toBeEnabled();
  });

  it("cancelar a confirmação preserva os itens e permite limpar a seleção", async () => {
    await iniciarArrasto(["Tela Origem", "Tela Extra"]);
    const dialogo = await soltarNoDestino();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTitle("/app/origem").closest("section")?.querySelector("h3")).toHaveTextContent("Origem");
    expect(screen.getByRole("checkbox", { name: "Selecionar Tela Extra" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));
    expect(screen.getByRole("checkbox", { name: "Selecionar Tela Extra" })).not.toBeChecked();
    expect(screen.queryByText("2 selecionados")).toBeNull();
  });

  it("Escape cancela o arrasto do grupo preservando a seleção", async () => {
    await iniciarArrasto(["Tela Origem", "Tela Extra"]);
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(document.querySelector(".pointer-events-none.fixed.inset-0")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Selecionar Tela Origem" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Selecionar Tela Extra" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
  });

  it("arrastar um item não selecionado leva só ele e limpa a seleção anterior", async () => {
    await iniciarArrasto(["Tela Extra", "Tela Outra"]);
    expect(screen.queryByText("2 submódulos")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Selecionar Tela Extra" })).not.toBeChecked();
    fireEvent.pointerUp(document, { clientX: 260, clientY: 90 });
    const dialogo = await screen.findByRole("dialog");
    expect(dialogo).toHaveTextContent('"Tela Origem"');
    expect(within(dialogo).queryByText("Tela Extra")).toBeNull();
  });
});
