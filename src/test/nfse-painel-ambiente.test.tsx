import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { NfseIntegracaoPainel } from "@/pages/financeiro/controle-notas/NfseIntegracaoPainel";
import type { NfEmissaoRow } from "@/hooks/useNfEmissao";
import type { ParametrosNfse, SolicitacaoNfse } from "@/hooks/useNfseIntegracao";
import { parametrosNfse } from "./fixtures/parametrosNfse";
const estado = vi.hoisted(() => ({ habilitado: false, piloto: null as string | null, enviar: vi.fn(async (_parametros: ParametrosNfse) => "solicitacao"),
  solicitacoes: [] as SolicitacaoNfse[], reprocessar: vi.fn(async (_dados: { id: string; descartar?: boolean }) => undefined), erro: vi.fn(), permitirIncluir: true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: estado.erro } }));
vi.mock("@/components/auth/AcessoGate", () => ({ AcessoGate: ({ children, acao }: { children: ReactNode; acao: string }) => acao !== "incluir" || estado.permitirIncluir ? children : null }));
vi.mock("@/hooks/useNfseIntegracao", () => ({
  useConfiguracaoNfse: () => ({ data: [
    { ambiente: "homologacao", serie: 1041, municipio_emissor: "3542404", inscricao_municipal: "100", habilitado: true, nf_piloto_id: null },
    { ambiente: "producao", serie: 4321, municipio_emissor: "4322004", inscricao_municipal: "100", habilitado: estado.habilitado, nf_piloto_id: estado.piloto },
  ] }),
  useSolicitacoesNfse: () => ({ data: estado.solicitacoes, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }),
  useSolicitarNfse: () => ({ mutateAsync: estado.enviar, isPending: false }),
  useReprocessarNfse: () => ({ mutateAsync: estado.reprocessar, isPending: false }),
  abrirDocumentoNfse: vi.fn(),
}));
const nota = { id: "nota-piloto", empresa_id: "empresa", status: "enviada", competencia: "2026-10-01", vlr_bruto_total: 100, vlr_liquido_total: 82.2, issqn_total: 2, csll_total: 0 } as unknown as NfEmissaoRow;
beforeAll(() => vi.stubGlobal("ResizeObserver", class {
  observe() { return undefined; }
  unobserve() { return undefined; }
  disconnect() { return undefined; }
}));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => { cleanup(); estado.habilitado = false; estado.piloto = null; estado.enviar.mockClear();
  estado.solicitacoes = []; estado.reprocessar.mockReset(); estado.erro.mockClear(); estado.permitirIncluir = true; });
function selecionarProducao() { fireEvent.change(screen.getByLabelText("Ambiente fiscal"), { target: { value: "producao" } }); }
describe("Painel NFS-e: escolha do ambiente fiscal", () => {
  it("permite escolher a competência fiscal e exige nova revisão antes de enviar a data selecionada", async () => {
    estado.habilitado = true;
    const parametros = { ...parametrosNfse(), codigo_integracao_municipal: "8111700" };
    estado.solicitacoes = [{ id: "anterior", ambiente: "producao", estado: "rejeitada", serie: 1041, numero_dps: 2,
      atualizado_em: "2026-11-13T10:00:00Z", dados: { parametros } } as SolicitacaoNfse];
    render(<NfseIntegracaoPainel nf={nota} alteracoesPendentes={false} />);
    selecionarProducao(); fireEvent.click(screen.getByRole("button", { name: "Preparar emissão em produção" }));
    const data = screen.getByLabelText("Data de execução do serviço / competência da NFS-e");
    expect(data).toHaveAttribute("type", "date"); expect(data).toHaveValue("2026-10-01");
    const revisar = () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Revisei os dados fiscais, as retenções e a série liberada." }));
      fireEvent.click(screen.getByRole("checkbox", { name: "Autorizo a emissão de uma nota fiscal real em produção para esta preparação." }));
    };
    revisar(); fireEvent.change(data, { target: { value: "2026-10-31" } });
    const botao = screen.getByRole("button", { name: "Solicitar emissão em produção" });
    expect(botao).toBeDisabled(); revisar(); fireEvent.submit(botao.closest("form")!);
    await waitFor(() => expect(estado.enviar).toHaveBeenCalledOnce());
    expect(estado.enviar.mock.calls[0][0]).toMatchObject({ data_competencia: "2026-10-31", confirmacao_fiscal: true, confirmacao_producao: true });
    expect(nota.competencia).toBe("2026-10-01");
  });
  it("pede a IM correta após P4016 e exige nova revisão sem retransmitir a DPS rejeitada", async () => {
    estado.habilitado = true;
    const parametros = parametrosNfse(); parametros.codigo_integracao_municipal = "8111700";
    estado.solicitacoes = [{id:"dps-4",ambiente:"producao",estado:"rejeitada",serie:1041,numero_dps:4,
      atualizado_em:"2026-11-12T14:04:26Z",envio_iniciado_em:"2026-11-12T14:03:24Z",mensagem:"P4016: Necessário especificar a Inscrição Municipal do Tomador",dados:{parametros}} as SolicitacaoNfse];
    render(<NfseIntegracaoPainel nf={nota} alteracoesPendentes={false} />);
    selecionarProducao(); fireEvent.click(screen.getByRole("button",{name:"Preparar emissão em produção"}));
    const campo = screen.getByLabelText("Inscrição municipal do tomador");
    expect(campo).toHaveValue(""); expect(campo).toBeRequired();
    const solicitar = screen.getByRole("button",{name:"Solicitar emissão em produção"});
    const revisar = () => {
      fireEvent.click(screen.getByRole("checkbox",{name:"Revisei os dados fiscais, as retenções e a série liberada."}));
      fireEvent.click(screen.getByRole("checkbox",{name:"Autorizo a emissão de uma nota fiscal real em produção para esta preparação."}));
    };
    revisar(); fireEvent.submit(solicitar.closest("form")!);
    expect(estado.enviar).not.toHaveBeenCalled(); expect(estado.erro).toHaveBeenCalledWith(expect.stringContaining("inscrição municipal do tomador"));
    fireEvent.change(campo,{target:{value:"00123-A"}}); expect(solicitar).toBeDisabled();
    revisar(); fireEvent.submit(solicitar.closest("form")!);
    await waitFor(()=>expect(estado.enviar).toHaveBeenCalledOnce());
    expect(estado.enviar.mock.calls[0][0]).toMatchObject({inscricao_municipal:"100",tomador:{inscricao_municipal:"00123-A"},confirmacao_fiscal:true,confirmacao_producao:true});
    expect(estado.reprocessar).not.toHaveBeenCalled();
  });
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
    expect(screen.getByLabelText("Série de DPS liberada para o ERP")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Município emissor — código IBGE")).toHaveAttribute("readonly");
    const solicitar = screen.getByRole("button", { name: "Solicitar emissão em produção" });
    expect(solicitar).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Revisei os dados fiscais, as retenções e a série liberada." }));
    expect(solicitar).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Autorizo a emissão de uma nota fiscal real em produção para esta preparação." }));
    expect(solicitar).toBeEnabled();
  });
  it("abre correção antes do envio, mantém os campos e impede novo pedido com CEP incompleto", async () => {
    estado.solicitacoes = [{ id: "erro-local", ambiente: "homologacao", estado: "erro", serie: 1041, numero_dps: 1,
      atualizado_em: "2026-11-11T12:00:00Z", envio_iniciado_em: null, dados: { parametros: parametrosNfse() } } as SolicitacaoNfse];
    estado.reprocessar.mockImplementation(async () => { estado.solicitacoes = estado.solicitacoes.map(s => ({ ...s, estado: "rejeitada" })); });
    render(<NfseIntegracaoPainel nf={nota} alteracoesPendentes={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Corrigir dados" }));
    const botao = await screen.findByRole("button", { name: "Solicitar emissão em homologação" });
    expect(estado.reprocessar).toHaveBeenCalledWith({ id: "erro-local", descartar: true });
    expect(screen.getByLabelText("CEP")).toHaveValue("95840-000");
    expect(screen.getByLabelText("Município emissor de testes — código IBGE")).toHaveValue("3542404");
    expect(botao).toBeDisabled();
    fireEvent.change(screen.getByLabelText("CEP"), { target: { value: "9584000" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Revisei os dados fiscais, as retenções e a série liberada." }));
    fireEvent.submit(botao.closest("form")!);
    expect(estado.erro).toHaveBeenCalledWith("CEP do tomador: informe 8 números.");
    expect(estado.enviar).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("CEP"), { target: { value: "95840-000" } });
    expect(botao).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Revisei os dados fiscais, as retenções e a série liberada." }));
    fireEvent.submit(botao.closest("form")!);
    await waitFor(() => expect(estado.enviar).toHaveBeenCalledOnce());
    expect(estado.enviar.mock.calls[0][0]).toMatchObject({ municipio_emissor: "3542404", tomador: { cep: "95840000" }, confirmacao_producao: false });
  });
  it("não oferece correção ou descarte após o envio, nem correção sem permissão de inclusão", () => {
    const falha = { id: "falha", ambiente: "homologacao", estado: "erro", serie: 1041, numero_dps: 1,
      atualizado_em: "2026-11-11T12:00:00Z", envio_iniciado_em: "2026-11-11T12:00:00Z", dados: { parametros: parametrosNfse() } } as SolicitacaoNfse;
    estado.solicitacoes = [falha];
    const tela = render(<NfseIntegracaoPainel nf={nota} alteracoesPendentes={false} />);
    expect(screen.queryByRole("button", { name: "Corrigir dados" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Descartar solicitação" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconsultar resultado" })).toBeInTheDocument();
    estado.solicitacoes = [{ ...falha, envio_iniciado_em: null }]; estado.permitirIncluir = false;
    tela.rerender(<NfseIntegracaoPainel nf={nota} alteracoesPendentes={false} />);
    expect(screen.queryByRole("button", { name: "Corrigir dados" })).not.toBeInTheDocument();
    expect(estado.reprocessar).not.toHaveBeenCalled();
  });
  it("reaproveita o pedido rejeitado e exige código da prefeitura sem selecionar uma opção fiscal", async () => {
    estado.habilitado = true;
    estado.solicitacoes = [{ id:"rejeitada",ambiente:"producao",estado:"rejeitada",serie:1041,numero_dps:2,
      atualizado_em:"2026-11-11T18:06:00Z",envio_iniciado_em:"2026-11-11T18:05:00Z",mensagem:"P5006",dados:{parametros:parametrosNfse()} } as SolicitacaoNfse];
    render(<NfseIntegracaoPainel nf={nota} alteracoesPendentes={false} />);
    selecionarProducao(); fireEvent.click(screen.getByRole("button",{name:"Preparar emissão em produção"}));
    const campo = screen.getByLabelText("Código do serviço na prefeitura");
    expect(campo).toHaveValue(""); expect(campo).toBeRequired();
    const revisar = () => {
      fireEvent.click(screen.getByRole("checkbox",{name:"Revisei os dados fiscais, as retenções e a série liberada."}));
      fireEvent.click(screen.getByRole("checkbox",{name:"Autorizo a emissão de uma nota fiscal real em produção para esta preparação."}));
    };
    const botao=screen.getByRole("button",{name:"Solicitar emissão em produção"});
    revisar(); fireEvent.submit(botao.closest("form")!);
    expect(estado.enviar).not.toHaveBeenCalled(); expect(estado.erro).toHaveBeenCalledWith(expect.stringContaining("Código do serviço na prefeitura"));
    fireEvent.change(campo,{target:{value:"8111700"}}); expect(botao).toBeDisabled();
    revisar(); fireEvent.submit(botao.closest("form")!);
    await waitFor(()=>expect(estado.enviar).toHaveBeenCalledOnce());
    expect(estado.enviar.mock.calls[0][0]).toMatchObject({codigo_integracao_municipal:"8111700",codigo_municipal:"",confirmacao_producao:true});
    expect(estado.reprocessar).not.toHaveBeenCalled();
  });
});
