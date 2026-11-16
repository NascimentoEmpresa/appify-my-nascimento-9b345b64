import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MunicipioNfseCampo } from "@/pages/financeiro/controle-notas/MunicipioNfseCampo";
const estado = vi.hoisted(() => ({ erro: false, recarregar: vi.fn() }));
vi.mock("@/hooks/useIBGEMunicipios", () => ({ useIBGEMunicipios: () => ({ isLoading: false, erro: estado.erro, recarregar: estado.recarregar, municipios: [
  { id: "4322004", nome: "Triunfo", uf: "RS" }, { id: "2615808", nome: "Triunfo", uf: "PE" }, { id: "3550308", nome: "São Paulo", uf: "SP" },
] }) }));
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); estado.erro = false; estado.recarregar.mockClear(); });
afterAll(() => vi.unstubAllGlobals());
describe("Município da NFS-e", () => {
  it("distingue cidades homônimas pela UF e só altera código ao selecionar", () => {
    const alterar = vi.fn();
    render(<MunicipioNfseCampo titulo="Local da prestação" codigo="" alterar={alterar} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.change(screen.getByPlaceholderText("Digite cidade, UF ou código IBGE"), { target: { value: "Triunfo RS" } });
    expect(alterar).not.toHaveBeenCalled();
    expect(screen.queryByText(/Triunfo \/ PE/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Triunfo / RS — 4322004" }));
    expect(alterar).toHaveBeenCalledWith("4322004");
  });
  it("encontra nomes sem acento e apresenta o nome do código já salvo", () => {
    render(<MunicipioNfseCampo titulo="Município" codigo="3550308" alterar={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("São Paulo / SP");
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.change(screen.getByPlaceholderText("Digite cidade, UF ou código IBGE"), { target: { value: "sao paulo" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
  it("mantém digitação manual e nova tentativa se o IBGE estiver indisponível", () => {
    estado.erro = true; const alterar = vi.fn();
    render(<MunicipioNfseCampo titulo="Município" codigo="" alterar={alterar} />);
    fireEvent.change(screen.getByLabelText("Município — código IBGE"), { target: { value: "4322004" } });
    expect(alterar).toHaveBeenCalledWith("4322004");
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(estado.recarregar).toHaveBeenCalledOnce();
  });
});
