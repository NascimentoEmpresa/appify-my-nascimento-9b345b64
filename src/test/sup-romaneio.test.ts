import { describe, expect, it } from "vitest";
import {
  montarPedidosRetiradaRomaneio,
  respostasRomaneioCompletas,
  validarSelecaoRomaneio,
  volumesValidos,
} from "@/lib/suprimentos/romaneio";

const pedido = (id: string, contrato = "contrato-a") => ({
  id,
  contrato_id: contrato,
  status: "AGUARDANDO ENVIO",
  romaneio_id: null,
});

describe("seleção de pedidos para romaneio", () => {
  it("aceita pedido que voltou de um romaneio já retirado", () => {
    expect(validarSelecaoRomaneio([
      pedido("p1"),
      { ...pedido("p2"), romaneio_id: "romaneio-velho", sup_romaneio: { status: "RETIRADO" } },
    ])).toEqual({ valida: true, motivo: null });
  });

  it("recusa pedido sem contrato junto com pedidos de um contrato", () => {
    expect(validarSelecaoRomaneio([pedido("p1"), { ...pedido("p2"), contrato_id: null }]))
      .toMatchObject({ valida: false, motivo: expect.stringContaining("mesmo contrato") });
  });

  it("volumes: vazio ou inteiro positivo", () => {
    expect(volumesValidos("")).toBe(true);
    expect(volumesValidos("3")).toBe(true);
    expect(volumesValidos("2.5")).toBe(false);
    expect(volumesValidos("0")).toBe(false);
    expect(volumesValidos("-1")).toBe(false);
  });

  it("aceita pedidos aguardando envio, sem romaneio e do mesmo contrato", () => {
    expect(validarSelecaoRomaneio([pedido("p1"), pedido("p2")])).toEqual({
      valida: true,
      motivo: null,
    });
  });

  it("recusa contratos misturados", () => {
    expect(validarSelecaoRomaneio([pedido("p1"), pedido("p2", "contrato-b")])).toMatchObject({
      valida: false,
      motivo: expect.stringContaining("mesmo contrato"),
    });
  });

  it("recusa status diferente de Aguardando envio", () => {
    expect(validarSelecaoRomaneio([
      pedido("p1"),
      { ...pedido("p2"), status: "RETIRADO PARA ENTREGA" },
    ])).toMatchObject({ valida: false, motivo: expect.stringContaining("Aguardando envio") });
  });

  it("recusa pedido que já pertence a romaneio", () => {
    expect(validarSelecaoRomaneio([
      pedido("p1"),
      { ...pedido("p2"), romaneio_id: "romaneio-1" },
    ])).toMatchObject({ valida: false, motivo: expect.stringContaining("já pertence") });
  });
});

describe("respostas dos documentos físicos", () => {
  it("não habilita a confirmação antes das duas respostas deliberadas", () => {
    expect(respostasRomaneioCompletas("", "")).toBe(false);
    expect(respostasRomaneioCompletas("TODOS", "")).toBe(false);
    expect(respostasRomaneioCompletas("", "NENHUM")).toBe(false);
    expect(respostasRomaneioCompletas("ALGUNS", "NENHUM")).toBe(true);
  });

  it("monta Todos/Nenhum/Alguns e conserva os pedidos desmarcados", () => {
    const resultado = montarPedidosRetiradaRomaneio(
      [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
      new Set(["p1", "p3"]),
      "TODOS",
      new Set(),
      "ALGUNS",
      new Set(["p3"]),
    );

    expect(resultado).toEqual([
      { pedido_id: "p1", retirado: true, ficha_epi_fisica: true, cracha_fisico: false },
      { pedido_id: "p2", retirado: false, ficha_epi_fisica: true, cracha_fisico: false },
      { pedido_id: "p3", retirado: true, ficha_epi_fisica: true, cracha_fisico: true },
    ]);
  });

  it("aplica Nenhum sem pré-marcar resposta", () => {
    expect(montarPedidosRetiradaRomaneio(
      [{ id: "p1" }],
      new Set(["p1"]),
      "NENHUM",
      new Set(["p1"]),
      "NENHUM",
      new Set(["p1"]),
    )[0]).toMatchObject({ ficha_epi_fisica: false, cracha_fisico: false });
  });
});
