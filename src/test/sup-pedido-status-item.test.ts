import { describe, it, expect } from "vitest";
import {
  derivarStatusItem,
  derivarStatusVisivel,
  apresentarStatusVisivel,
  ESTILO_STATUS_VISIVEL,
  STATUS_ITEM,
  type SituacaoItem,
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
 * Guardar isso numa coluna seria uma segunda verdade sobre o mesmo fato — o
 * erro que o legado cometeu com o saldo do estoque, onde trigger e query
 * calculavam diferente e ninguém sabia qual valia (REPLICAR §12.8).
 *
 * A partir da reserva de estoque (20260930000076) o item tem mais dois
 * estados possíveis, e por isso a função passou a receber um objeto no lugar
 * do booleano: além de "saiu", agora existe "está reservado para separação" e
 * "deu divergência e falta comprar". Continuam todos DERIVADOS.
 */

/** Açúcar para os casos antigos, que só falavam de etiqueta. */
const saiu = (v: boolean): SituacaoItem => ({ saiu: v });

describe("derivarStatusItem — status do item vem da etiqueta, não de coluna", () => {
  it("sem etiqueta num pedido AGUARDANDO COMPRA é o que falta comprar", () => {
    expect(derivarStatusItem("AGUARDANDO COMPRA", saiu(false))).toBe("AGUARDANDO COMPRA");
  });

  it("com etiqueta no MESMO pedido já está separado — é o que ele apagava na mão", () => {
    expect(derivarStatusItem("AGUARDANDO COMPRA", saiu(true))).toBe("SEPARADO");
  });

  it("etiqueta vinculada em pedido despachado significa item despachado", () => {
    expect(derivarStatusItem("DESPACHADO", saiu(true))).toBe("DESPACHADO");
  });

  it("item sem etiqueta ainda é pendente, mesmo com o pedido marcado DESPACHADO", () => {
    // Acontece de verdade: o operador despacha o que separou e o item que
    // faltava fica para trás. Chamar de "despachado" esconderia a falta.
    expect(derivarStatusItem("DESPACHADO", saiu(false))).toBe("PENDENTE");
  });

  it("em preparação, o que ainda não tem etiqueta é pendente", () => {
    expect(derivarStatusItem("EM PREPARACAO", saiu(false))).toBe("PENDENTE");
  });

  it("em preparação, o que já tem etiqueta conta como separado", () => {
    expect(derivarStatusItem("EM PREPARACAO", saiu(true))).toBe("SEPARADO");
  });

  it("aguardando envio com etiqueta é separado", () => {
    expect(derivarStatusItem("AGUARDANDO ENVIO", saiu(true))).toBe("SEPARADO");
  });

  it("pedido cancelado cancela o item mesmo que a peça já tivesse saído", () => {
    // O cancelamento vence a etiqueta: o item não deve aparecer como pendente
    // de compra nem como despachado num relatório de pedido cancelado.
    expect(derivarStatusItem("CANCELADO", saiu(true))).toBe("CANCELADO");
    expect(derivarStatusItem("CANCELADO", saiu(false))).toBe("CANCELADO");
  });

  it("só devolve status que existe na lista oficial", () => {
    const combinacoes = [
      "EM PREPARACAO", "EM SEPARACAO", "AGUARDANDO ENVIO", "AGUARDANDO COMPRA",
      "DESPACHADO", "CANCELADO",
    ].flatMap((s) => [
      derivarStatusItem(s, saiu(true)),
      derivarStatusItem(s, saiu(false)),
      derivarStatusItem(s, { saiu: false, reservado: true }),
      derivarStatusItem(s, { saiu: false, pendenteCompra: true }),
    ]);

    for (const status of combinacoes) {
      expect(STATUS_ITEM).toContain(status);
    }
  });

  it("status desconhecido não quebra: cai em pendente/separado", () => {
    // Se alguém acrescentar um status de pedido no banco e esquecer daqui, o
    // relatório continua saindo — sem inventar um status que não existe.
    expect(derivarStatusItem("STATUS_QUE_NAO_EXISTE", saiu(false))).toBe("PENDENTE");
    expect(derivarStatusItem("STATUS_QUE_NAO_EXISTE", saiu(true))).toBe("SEPARADO");
  });
});

describe("derivarStatusItem — reserva e divergência", () => {
  it("reservado e ainda na prateleira aparece como em separação", () => {
    // A peça saiu do saldo DISPONÍVEL, mas não do estoque físico: quem for
    // separar ainda precisa ir buscá-la.
    expect(derivarStatusItem("EM SEPARACAO", { saiu: false, reservado: true }))
      .toBe("EM SEPARACAO");
  });

  it("divergência na separação vira 'falta comprar'", () => {
    expect(derivarStatusItem("EM SEPARACAO", { saiu: false, pendenteCompra: true }))
      .toBe("PENDENTE COMPRA");
  });

  it("o que já saiu vence a divergência antiga", () => {
    // A linha DIVERGENTE da reserva é histórico e não some. Se ela vencesse,
    // um item que deu divergência e DEPOIS foi atendido com material novo
    // ficaria marcado como "falta comprar" para sempre.
    expect(derivarStatusItem("AGUARDANDO ENVIO", { saiu: true, pendenteCompra: true }))
      .toBe("SEPARADO");
  });

  it("reserva vence a divergência enquanto nada saiu", () => {
    // Reservou de novo depois da divergência: o item voltou para a fila de
    // separação, e é isso que o operador precisa ver.
    expect(derivarStatusItem("EM SEPARACAO", { saiu: false, reservado: true, pendenteCompra: true }))
      .toBe("EM SEPARACAO");
  });

  it("cancelar vence tudo, inclusive reserva", () => {
    expect(derivarStatusItem("CANCELADO", { saiu: false, reservado: true }))
      .toBe("CANCELADO");
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

describe("derivarStatusVisivel — parcialmente despachado", () => {
  /**
   * O caso do gerente, literal: "digamos que o encarregado pediu 11 itens, 10
   * ela entendeu que nós tínhamos estoque... chegou lá, 9 tinha e 1 estava
   * errado. Ele não está literalmente entregue, talvez ele está parcialmente
   * entregue."
   */
  it("parte dos itens atendida em pedido aguardando envio", () => {
    expect(derivarStatusVisivel("AGUARDANDO ENVIO", null, { itens: 10, itens_atendidos: 9 }))
      .toBe("PARCIALMENTE DESPACHADO");
  });

  it("vence o eixo da comprovação, porque falta mercadoria", () => {
    expect(derivarStatusVisivel("DESPACHADO", "PENDENTE", { itens: 10, itens_atendidos: 9 }))
      .toBe("PARCIALMENTE DESPACHADO");
  });

  it("tudo atendido não é parcial", () => {
    expect(derivarStatusVisivel("DESPACHADO", "ENVIADO", { itens: 10, itens_atendidos: 10 }))
      .toBe("DESPACHADO_ENTREGUE");
  });

  it("nada atendido não é parcial — é o acervo migrado", () => {
    // As 1.084 etiquetas e 3.575 linhas de consumo que vieram do sistema
    // antigo não trouxeram vínculo item-a-item, então todo pedido migrado tem
    // itens_atendidos = 0. Chamá-los de "parcial" encheria a tela de laranja
    // sem que nada tivesse mudado na operação.
    expect(derivarStatusVisivel("DESPACHADO", "DISPENSADO", { itens: 4, itens_atendidos: 0 }))
      .toBe("DESPACHADO_ENTREGUE");
  });

  it("sem situação carregada, o comportamento é o de antes", () => {
    expect(derivarStatusVisivel("DESPACHADO", "ENVIADO")).toBe("DESPACHADO_ENTREGUE");
    expect(derivarStatusVisivel("AGUARDANDO ENVIO", null)).toBe("AGUARDANDO ENVIO");
  });

  it("pedido em separação tem status próprio, sem depender dos itens", () => {
    // Vale mesmo quando TODOS os itens deram divergência e não sobrou reserva
    // ativa: o pedido continua precisando de olho humano.
    expect(derivarStatusVisivel("EM SEPARACAO", null, { itens: 3, itens_atendidos: 0 }))
      .toBe("EM SEPARACAO");
  });
});
