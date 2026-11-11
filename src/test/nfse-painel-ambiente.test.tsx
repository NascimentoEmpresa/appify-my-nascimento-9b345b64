import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { NfseIntegracaoPainel } from "@/pages/financeiro/controle-notas/NfseIntegracaoPainel";
import type { NfEmissaoRow } from "@/hooks/useNfEmissao";
const estado = vi.hoisted(() => ({ habilitado: false, piloto: null as string | null, enviar: vi.fn(async () => "solicitacao") }));
vi.mock("@/components/auth/AcessoGate", () => ({ AcessoGate: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/hooks/useNfseIntegracao", () => ({
  useConfiguracaoNfse: () => ({ data: [
    { ambiente: "homologacao", serie: 1041, municipio_emissor: "3542404", inscricao_municipal: "100", habilitado: true, nf_piloto_id: null },
    { ambiente: "producao", serie: 4321, municipio_emissor: "4322004", inscricao_municipal: "100", habilitado: estado.habilitado, nf_piloto_id: estado.piloto },
  ] }),
  useSolicitacoesNfse: () => ({ data: [], isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }),
  useSolicitarNfse: () => ({ mutateAsync: estado.enviar, isPending: false }),
  useReprocessarNfse: () => ({ mutateAsync: vi.fn(), isPending: false }),
  abrirDocumentoNfse: vi.fn(),
}));
const nota = { id: "nota-piloto", empresa_id: "empresa", status: "enviada", vlr_bruto_total: 100, vlr_liquido_total: 82.2, issqn_total: 2, csll_total: 0 } as unknown as NfEmissaoRow;
beforeAll(() => vi.stubGlobal("ResizeObserver", class {
  observe() { return undefined; }
  unobserve() { return undefined; }
  disconnect() { return undefined; }
}));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => { cleanup(); estado.habilitado = false; estado.piloto = null; estado.enviar.mockClear(); });
function selecionarProducao() { fireEvent.change(screen.getByLabelText("Ambiente fiscal"), { target: { value: "producao" } }); }
describe("Painel NFS-e: escolha do ambiente fiscal", () => {
  it("oferece homologação por padrão e impede preparar produção sem liberação", () => {
    render(<NfseIntegracaoPainel nf={nota} alteracoesPendentes={false} />);
    expect(screen.getByRole("button", { name: "Preparar emissão em homologação" })).toBeInTheDocument();
    selecionarProducao();
    expect(screen.getByText("Produção — nota real")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("ainda não liberada");
    expect(screen.queryByRole("button", { name: "Preparar emissão em produção" })).not.toBeInTheDocument();
    expect(estado.enviar).not.toHaveBeenCalled();
  });
  it("não libera outra preparação durante a validação inicial", () => {
    estado.habilitado = true; estado.piloto = "outra-nota";
    render(<NfseIntegracaoPainel nf={nota} alteracoesPendentes={false} />);
    selecionarProducao();
    expect(screen.queryByRole("button", { name: "Preparar emissão em produção" })).not.toBeInTheDocument();
  });
  it("usa a configuração de produção e exige as duas confirmações antes da solicitação real", () => {
    estado.habilitado = true; estado.piloto = nota.id;
    render(<NfseIntegracaoPainel nf={nota} alteracoesPendentes={false} />);
    selecionarProducao(); fireEvent.click(screen.getByRole("button", { name: "Preparar emissão em produção" }));
    expect(screen.getByLabelText("Série de DPS liberada para o ERP")).toHaveValue("4321");
    expect(screen.getByLabelText("Município emissor — código IBGE")).toHaveValue("4322004");
    const solicitar = screen.getByRole("button", { name: "Solicitar emissão em produção" });
    expect(solicitar).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Revisei os dados fiscais, as retenções e a série liberada." }));
    expect(solicitar).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Autorizo a emissão de uma nota fiscal real em produção para esta preparação." }));
    expect(solicitar).toBeEnabled();
  });
});
