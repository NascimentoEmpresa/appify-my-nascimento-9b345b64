import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OrganizarMenuLateral from "@/pages/sistemas/menuLateral/OrganizarMenuLateral";

vi.mock("@/components/layout/Sidebar", async () => {
  const { Circle } = await import("lucide-react");
  return {
    NAV_MODULOS: ["Origem", "Destino"].map((nome) => ({
      id: nome.toLowerCase(), label: nome, description: nome, icon: Circle,
      basePath: `/app/${nome.toLowerCase()}`, status: "active",
      groups: [{ label: nome, items: [{ label: `Tela ${nome}`, to: `/app/${nome.toLowerCase()}`, icon: Circle }] }],
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
    if (this.title.startsWith("/app/")) return retangulo(x + 20, 80, 160, 30);
    if (this.firstElementChild?.querySelector("p")?.textContent === modulo) return retangulo(x + 10, 50, 180, 180);
    return retangulo(0, 0, 640, 600);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function iniciarArrasto() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(<QueryClientProvider client={cliente}><OrganizarMenuLateral /></QueryClientProvider>);
  const origem = await screen.findByTitle("/app/origem");
  fireEvent.pointerDown(origem, { button: 0, clientX: 40, clientY: 90 });
  fireEvent.pointerMove(document, { clientX: 50, clientY: 90 });
  await waitFor(() => expect(document.querySelector(".pointer-events-none.fixed.inset-0")).not.toBeNull());
  fireEvent.pointerMove(document, { clientX: 260, clientY: 90 });
  const previa = await waitFor(() => {
    const elemento = screen.getAllByText("Tela Origem").find((el) => !container.contains(el));
    expect(elemento).toBeDefined();
    return elemento!;
  });
  return { container, origem, previa };
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
});
