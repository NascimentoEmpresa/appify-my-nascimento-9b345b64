import { describe, expect, it } from "vitest";
import { resumirSituacao, type SituacaoObjeto } from "@/hooks/useCorreios";

/**
 * Os Correios devolvem a frase inteira do evento, que não cabe num badge de
 * card. O que se testa aqui é o encurtamento — e principalmente que ele não
 * perca a distinção que muda a ação de quem lê a tela.
 *
 * A frase real de cada caso veio da consulta feita em 04/09/2026 aos sete
 * objetos postados pela SN em 01/09.
 */

function objeto(parcial: Partial<SituacaoObjeto>): SituacaoObjeto {
  return {
    codigo: "AD867127447BR",
    mensagem: null,
    descricao: null,
    data: "2026-09-03T12:56:32",
    local: "CURITIBA-PR",
    entregue: false,
    ...parcial,
  };
}

describe("resumirSituacao", () => {
  it("sem objeto ou sem evento não rende badge", () => {
    expect(resumirSituacao(undefined)).toBeNull();
    expect(resumirSituacao(objeto({ descricao: null }))).toBeNull();
  });

  it("entregue vira verde e texto curto", () => {
    const r = resumirSituacao(objeto({
      descricao: "Objeto entregue ao destinatário",
      entregue: true,
    }));
    expect(r?.texto).toBe("Entregue");
    expect(r?.classe).toContain("emerald");
  });

  /**
   * O caso que motivou a integração: material chegou na cidade e está parado
   * esperando alguém buscar. Sem destaque próprio ele se confunde com
   * "em trânsito", e é justamente o que precisa de ação de quem está olhando.
   */
  it("aguardando retirada é âmbar e não se confunde com trânsito", () => {
    const caixaPostal = resumirSituacao(objeto({
      descricao: "Objeto aguardando retirada na Caixa Postal",
    }));
    const endereco = resumirSituacao(objeto({
      descricao: "Objeto aguardando retirada no endereço indicado",
    }));
    for (const r of [caixaPostal, endereco]) {
      expect(r?.texto).toBe("Aguardando retirada");
      expect(r?.classe).toContain("amber");
    }
  });

  it("transferência, postagem e saída para entrega são azuis e distintas", () => {
    expect(resumirSituacao(objeto({ descricao: "Objeto em transferência - por favor aguarde" }))?.texto)
      .toBe("Em trânsito");
    expect(resumirSituacao(objeto({ descricao: "Objeto postado" }))?.texto)
      .toBe("Postado");
    expect(resumirSituacao(objeto({ descricao: "Objeto saiu para entrega ao destinatário" }))?.texto)
      .toBe("Saiu para entrega");
    expect(resumirSituacao(objeto({ descricao: "Objeto postado" }))?.classe).toContain("blue");
  });

  it("problema de entrega fica vermelho e preserva a frase inteira", () => {
    const r = resumirSituacao(objeto({
      descricao: "Objeto não entregue - carteiro não atendido",
    }));
    expect(r?.classe).toContain("red");
    // Aqui NÃO se encurta: o motivo do insucesso é o que a pessoa precisa ler.
    expect(r?.texto).toBe("Objeto não entregue - carteiro não atendido");
  });

  /**
   * Objeto de outro contrato, ou código digitado errado, volta com `mensagem`
   * no lugar dos eventos. Isso é informação para quem digitou, não erro de
   * sistema — some do vermelho e vira cinza.
   */
  it("mensagem do próprio Correios aparece em cinza", () => {
    const r = resumirSituacao(objeto({
      mensagem: "SRO-020: Objeto não encontrado na base de dados",
      descricao: null,
    }));
    expect(r?.texto).toContain("não encontrado");
    expect(r?.classe).toContain("slate");
  });

  it("evento desconhecido não some da tela", () => {
    const r = resumirSituacao(objeto({ descricao: "Frase nova que os Correios inventaram" }));
    expect(r?.texto).toBe("Frase nova que os Correios inventaram");
  });
});
