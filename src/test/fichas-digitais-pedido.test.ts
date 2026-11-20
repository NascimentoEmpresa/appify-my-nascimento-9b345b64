import { describe, expect, it } from "vitest";
import {
  comprovanteDaFichaDigital,
  historicoComFichasConfirmadas,
  type FichaDigitalPedido,
} from "@/lib/suprimentos/fichasDigitaisPedido";

const ficha = (id: string, confirmadoEm: string | null): FichaDigitalPedido => ({
  id,
  pedido_id: "pedido-1",
  protocolo: "PED-20261119-0001",
  colaborador_nome: "Colaborador do teste",
  matricula: "123",
  empresa_nome: "Empresa",
  contrato_nome: "Contrato",
  posto_nome: "Posto",
  funcao_nome: "Função",
  entregador_nome: "Responsável",
  itens: [{ pedido_item_id: id, descricao: `EPI ${id}`, tamanho: null, codigo: id, ca: "CA-1", ca_validade: null, quantidade: 1 }],
  registrado_em: "2026-11-19T09:00:00Z",
  confirmado_em: confirmadoEm,
  confirmacao_hash: confirmadoEm ? `hash-${id}` : null,
  declaracao_versao: 1,
});

describe("fichas digitais no pedido", () => {
  it("insere cada confirmação na ordem do histórico sem tratar ficha pendente como recebida", () => {
    const eventos = [
      { id: "pedido-criado", data_alteracao: "2026-11-19T08:00:00Z" },
      { id: "retirada", data_alteracao: "2026-11-19T10:00:00Z" },
    ];
    const linhas = historicoComFichasConfirmadas(eventos, [
      ficha("ficha-1", "2026-11-19T11:00:00Z"),
      ficha("ficha-pendente", null),
      ficha("ficha-2", "2026-11-19T12:00:00Z"),
    ]);

    expect(linhas.map(({ tipo, id }) => `${tipo}:${id}`)).toEqual([
      "pedido:pedido-criado", "pedido:retirada", "ficha_epi:ficha-1", "ficha_epi:ficha-2",
    ]);
  });

  it("monta o PDF a partir dos dados imutáveis da ficha escolhida", () => {
    const primeira = ficha("ficha-1", "2026-11-19T11:00:00Z");
    const segunda = ficha("ficha-2", "2026-11-19T12:00:00Z");

    expect(comprovanteDaFichaDigital(segunda)).toMatchObject({
      protocolo: segunda.protocolo,
      itens: segunda.itens,
      confirmadoEm: segunda.confirmado_em,
      hash: "hash-ficha-2",
    });
    expect(comprovanteDaFichaDigital(segunda).itens).not.toEqual(primeira.itens);
  });
});
