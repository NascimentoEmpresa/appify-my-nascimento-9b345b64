import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FichaDigitalPedido } from "@/lib/suprimentos/fichasDigitaisPedido";

const { buscarFichas, imprimir } = vi.hoisted(() => ({ buscarFichas: vi.fn(), imprimir: vi.fn() }));
vi.mock("@/hooks/useFichasDigitaisPedido", () => ({ useFichasDigitaisPedido: buscarFichas }));
vi.mock("@/lib/suprimentos/entregaEpi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/suprimentos/entregaEpi")>()),
  imprimirComprovanteEpi: imprimir,
}));

import { ModalFichasDigitaisPedido } from "@/components/suprimentos/ModalFichasDigitaisPedido";

const ficha = (id: string, confirmadoEm: string | null): FichaDigitalPedido => ({
  id, pedido_id: "pedido-1", protocolo: "PED-001", colaborador_nome: "Colaborador",
  matricula: "123", empresa_nome: "Empresa", contrato_nome: "Contrato",
  posto_nome: "Posto", funcao_nome: "Função", entregador_nome: "Responsável",
  itens: [{ pedido_item_id: id, descricao: `EPI ${id}`, tamanho: null, codigo: id,
    ca: "CA-1", ca_validade: null, quantidade: 1 }],
  registrado_em: "2026-11-19T10:00:00Z", confirmado_em: confirmadoEm,
  confirmacao_hash: confirmadoEm ? `hash-${id}` : null, declaracao_versao: 1,
});

beforeEach(() => {
  buscarFichas.mockReturnValue({
    data: [ficha("pendente", null), ficha("segunda", "2026-11-19T12:00:00Z"), ficha("primeira", "2026-11-19T11:00:00Z")],
    isLoading: false, error: null, refetch: vi.fn(),
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Ficha EPI no card do pedido", () => {
  it("mostra uma linha por entrega e abre o PDF da ficha confirmada escolhida", () => {
    render(<ModalFichasDigitaisPedido pedido={{ id: "pedido-1", pedido_id: "PED-001" }} onFechar={() => {}} onAbrirModelo={() => {}} />);
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getAllByRole("button", { name: /Ficha [123]/ })).toHaveLength(3);

    fireEvent.click(within(dialogo).getByRole("button", { name: /Ficha 3/ }));
    expect(within(dialogo).queryByRole("button", { name: /Abrir \/ salvar PDF confirmado/ })).not.toBeInTheDocument();

    fireEvent.click(within(dialogo).getByRole("button", { name: /Ficha 2/ }));
    expect(within(dialogo).getByText(/1 × EPI segunda/)).toBeInTheDocument();
    fireEvent.click(within(dialogo).getByRole("button", { name: /Abrir \/ salvar PDF confirmado/ }));
    expect(imprimir).toHaveBeenCalledWith(expect.objectContaining({ hash: "hash-segunda", itens: expect.arrayContaining([expect.objectContaining({ codigo: "segunda" })]) }));
  });
});
