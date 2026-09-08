import { describe, it, expect } from "vitest";
import {
  derivarStatusItem,
  derivarStatusVisivel,
  apresentarStatusVisivel,
  ESTILO_STATUS_VISIVEL,
  STATUS_ITEM,
} from "@/hooks/useSupPedidos";

/**
 * SIS-2026-0201 — o gerente de Suprimentos precisa exportar "só o que ficou
 * pendente" para abrir a solicitação de compra.
 *
 * O caso que ele descreveu na reunião: o encarregado pediu camiseta, jaqueta,
 * calça e butina. Havia tudo, menos a butina. O pedido inteiro ficou em
 * AGUARDANDO COMPRA, e o Excel saía com as quatro linhas nesse status — ele
 * apagava três na mão, toda vez, para montar o relatório de compra.
 *
 * A resposta não é uma coluna nova: quem sabe se a peça saiu é a ETIQUETA.
 * Item com etiqueta vinculada saiu do estoque; sem etiqueta, não saiu. O
 * status do pedido só decide COMO chamar cada um dos dois casos.
 *
 * Guardar isso numa coluna seria uma segunda verdade sobre o mesmo fato — o
 * erro que o legado cometeu com o saldo do estoque, onde trigger e query
 * calculavam diferente e ninguém sabia qual valia (REPLICAR §12.8).
 */
describe("derivarStatusItem — status do item vem da etiqueta, não de coluna", () => {
  it("sem etiqueta num pedido AGUARDANDO COMPRA é o que falta comprar", () => {
    expect(derivarStatusItem("AGUARDANDO COMPRA", false)).toBe("AGUARDANDO COMPRA");
  });

  it("com etiqueta no MESMO pedido já está separado — é o que ele apagava na mão", () => {
    expect(derivarStatusItem("AGUARDANDO COMPRA", true)).toBe("SEPARADO");
  });

  it("etiqueta vinculada em pedido despachado significa item despachado", () => {
    expect(derivarStatusItem("DESPACHADO", true)).toBe("DESPACHADO");
  });

  it("item sem etiqueta ainda é pendente, mesmo com o pedido marcado DESPACHADO", () => {
    // Acontece de verdade: o operador despacha o que separou e o item que
    // faltava fica para trás. Chamar de "despachado" esconderia a falta.
    expect(derivarStatusItem("DESPACHADO", false)).toBe("PENDENTE");
  });

  it("em preparação, o que ainda não tem etiqueta é pendente", () => {
    expect(derivarStatusItem("EM PREPARACAO", false)).toBe("PENDENTE");
  });

  it("em preparação, o que já tem etiqueta conta como separado", () => {
    expect(derivarStatusItem("EM PREPARACAO", true)).toBe("SEPARADO");
  });

  it("aguardando envio com etiqueta é separado, esperando logística", () => {
    expect(derivarStatusItem("AGUARDANDO ENVIO", true)).toBe("SEPARADO");
  });

  it("pedido cancelado cancela o item mesmo que a peça já tivesse saído", () => {
    // O cancelamento vence a etiqueta: o item não deve aparecer como pendente
    // de compra nem como despachado num relatório de pedido cancelado.
    expect(derivarStatusItem("CANCELADO", true)).toBe("CANCELADO");
    expect(derivarStatusItem("CANCELADO", false)).toBe("CANCELADO");
  });

  it("só devolve status que existe na lista oficial", () => {
    const combinacoes = [
      "EM PREPARACAO", "AGUARDANDO ENVIO", "AGUARDANDO COMPRA", "DESPACHADO", "CANCELADO",
    ].flatMap((s) => [derivarStatusItem(s, true), derivarStatusItem(s, false)]);

    for (const status of combinacoes) {
      expect(STATUS_ITEM).toContain(status);
    }
  });

  it("status desconhecido não quebra: cai em pendente/separado", () => {
    // Se alguém acrescentar um status de pedido no banco e esquecer daqui, o
    // relatório continua saindo — sem inventar um status que não existe.
    expect(derivarStatusItem("STATUS_QUE_NAO_EXISTE", false)).toBe("PENDENTE");
    expect(derivarStatusItem("STATUS_QUE_NAO_EXISTE", true)).toBe("SEPARADO");
  });
});

describe("derivarStatusVisivel — entrega vem da comprovação", () => {
  it("mantém o despacho âmbar enquanto a comprovação não voltou", () => {
    expect(derivarStatusVisivel("DESPACHADO", "PENDENTE")).toBe("DESPACHADO_AGUARDANDO");
    expect(ESTILO_STATUS_VISIVEL.DESPACHADO_AGUARDANDO.rotulo)
      .toBe("Despachado e Aguardando Confirmar Entrega");
  });

  it("só apresenta entregue quando a comprovação foi respondida", () => {
    expect(derivarStatusVisivel("DESPACHADO", "ENVIADO")).toBe("DESPACHADO_ENTREGUE");
    expect(ESTILO_STATUS_VISIVEL.DESPACHADO_ENTREGUE.rotulo)
      .toBe("Despachado e Entregue");
  });

  it("coloca o acervo dispensado no balde concluído sem afirmar entrega", () => {
    expect(derivarStatusVisivel("DESPACHADO", "DISPENSADO")).toBe("DESPACHADO_ENTREGUE");
    expect(apresentarStatusVisivel("DESPACHADO", "DISPENSADO")).toMatchObject({
      status: "DESPACHADO_ENTREGUE",
      rotulo: "Despachado",
      titulo: "Despachado antes da regra de comprovação",
    });
  });

  it("trata a ausência de comprovação como acervo anterior à regra", () => {
    expect(derivarStatusVisivel("DESPACHADO", null)).toBe("DESPACHADO_ENTREGUE");
    expect(apresentarStatusVisivel("DESPACHADO", null).rotulo).toBe("Despachado");
  });

  it("não altera os demais estados persistidos", () => {
    expect(derivarStatusVisivel("AGUARDANDO ENVIO", "PENDENTE")).toBe("AGUARDANDO ENVIO");
    expect(derivarStatusVisivel("CANCELADO", "ENVIADO")).toBe("CANCELADO");
  });
});
