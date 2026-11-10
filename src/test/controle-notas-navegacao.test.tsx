import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import InicioControleNotas from "@/pages/financeiro/nf-emissao/InicioControleNotas";
import { NavegacaoControleNotas } from "@/pages/financeiro/nf-emissao/NavegacaoControleNotas";
import { ETAPAS_CONTROLE_NOTAS, ROTA_CONTROLE_NOTAS } from "@/pages/financeiro/nf-emissao/navegacao";
import { rotaVisivelNoMenu, type MenuRoute } from "@/hooks/useAccessibleMenus";

const estado = vi.hoisted(() => ({ acesso: { codes: new Set<string>(), routes: [] as MenuRoute[], inactiveCodes: new Set<string>() } }));
vi.mock("@/hooks/useAccessibleMenus", async importOriginal => ({
  ...await importOriginal<typeof import("@/hooks/useAccessibleMenus")>(),
  useAccessibleMenus: () => ({ data: estado.acesso, isLoading: false }),
}));
afterEach(cleanup);

function permitir(...codes: string[]) {
  estado.acesso = { codes: new Set(codes), inactiveCodes: new Set(), routes: [
    { codigo: "nf-emissao", rota: ROTA_CONTROLE_NOTAS, ativo: true },
    { codigo: "nf_emissao_cadastro", rota: ETAPAS_CONTROLE_NOTAS[0].rota, ativo: true },
    { codigo: "nf_emissao_controle", rota: ETAPAS_CONTROLE_NOTAS[1].rota, ativo: true },
  ] };
}
function LocalAtual() { return <span data-testid="rota-atual">{useLocation().pathname}</span>; }
function abrir(rota: string) {
  return render(<MemoryRouter initialEntries={[rota]}><LocalAtual /><Routes>
    <Route path={ROTA_CONTROLE_NOTAS} element={<InicioControleNotas />} />
    <Route path={ETAPAS_CONTROLE_NOTAS[0].rota} element={<><NavegacaoControleNotas /><h1>Cadastro de teste</h1></>} />
    <Route path={ETAPAS_CONTROLE_NOTAS[1].rota} element={<><NavegacaoControleNotas /><h1>Validação de teste</h1></>} />
  </Routes></MemoryRouter>);
}

describe("Controle de Notas: entrada e troca de etapas", () => {
  it("mantém a entrada com barra final e oferece cadastro e validação sem redirecionar", () => {
    permitir("nf-emissao", "nf_emissao_cadastro", "nf_emissao_controle");
    abrir(ROTA_CONTROLE_NOTAS + "/");
    expect(screen.getByRole("heading", { name: "Controle de Notas" })).toBeInTheDocument();
    expect(screen.getByTestId("rota-atual")).toHaveTextContent(ROTA_CONTROLE_NOTAS + "/");
    expect(screen.getByRole("link", { name: "Emissão de NF" })).toHaveAttribute("href", ETAPAS_CONTROLE_NOTAS[0].rota);
    fireEvent.click(screen.getByRole("link", { name: "Validação de Notas" }));
    expect(screen.getByRole("heading", { name: "Validação de teste" })).toBeInTheDocument();
  });
  it("permite sair do cadastro para a validação pelo próprio cabeçalho", () => {
    permitir("nf-emissao", "nf_emissao_cadastro", "nf_emissao_controle");
    abrir(ETAPAS_CONTROLE_NOTAS[0].rota);
    fireEvent.click(screen.getByRole("link", { name: "Validação de Notas" }));
    expect(screen.getByTestId("rota-atual")).toHaveTextContent(ETAPAS_CONTROLE_NOTAS[1].rota);
    expect(screen.getByRole("link", { name: "Validação de Notas" })).toHaveAttribute("aria-current", "page");
  });
  it("não oferece validação para quem tem somente o cadastro", () => {
    permitir("nf-emissao", "nf_emissao_cadastro");
    abrir(ROTA_CONTROLE_NOTAS);
    expect(screen.getByRole("link", { name: "Emissão de NF" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Validação de Notas" })).not.toBeInTheDocument();
  });
  it("não usa a permissão do pai para liberar etapas sem acesso", () => {
    permitir("nf-emissao");
    abrir(ROTA_CONTROLE_NOTAS);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Solicite a liberação");
  });
  it("preserva atalhos antigos exigindo permissão no destino e respeitando menu inativo", () => {
    permitir("nf-emissao");
    expect(rotaVisivelNoMenu("/app/financeiro/nf-emissao", estado.acesso)).toBe(true);
    expect(rotaVisivelNoMenu("/app/financeiro/nf-emissao/controle-notas", estado.acesso)).toBe(false);
    estado.acesso.codes.add("nf_emissao_controle");
    expect(rotaVisivelNoMenu("/app/financeiro/nf-emissao/controle-notas", estado.acesso)).toBe(true);
    estado.acesso.inactiveCodes.add("nf_emissao_controle");
    expect(rotaVisivelNoMenu("/app/financeiro/nf-emissao/controle-notas", estado.acesso)).toBe(false);
  });
});
