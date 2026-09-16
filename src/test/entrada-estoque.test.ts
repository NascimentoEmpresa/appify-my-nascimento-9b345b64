import { describe, it, expect } from "vitest";
import { motivoBloqueioEntrada, type EstadoEntrada } from "@/lib/suprimentos/entradaEstoque";

/**
 * O relato de 16/09/2026 foi "preencho todas as informações de um novo item e
 * o botão de dar entrada continua indisponível". O que faltava era o TIPO do
 * material novo — um campo que a pessoa nem tinha visto aparecer, porque o
 * botão não dizia nada.
 *
 * Estes testes fixam as duas metades da correção: o botão só habilita quando
 * dá mesmo para gravar, e quando não dá, tem SEMPRE uma frase dizendo o quê.
 */

/** Formulário completo e válido, com material novo digitado. */
const COMPLETO: EstadoEntrada = {
  almoxarifado: "alm-1",
  materialId: "",
  nomeNovo: "TESTE EDUARDO",
  tipoNovo: "uniforme",
  decisaoDeTamanhoPendente: false,
  total: 15,
  erroCa: null,
  laudoCarregando: false,
  enviando: false,
};

const com = (patch: Partial<EstadoEntrada>): EstadoEntrada => ({ ...COMPLETO, ...patch });

describe("motivoBloqueioEntrada", () => {
  it("libera material novo digitado, sem exigir item do catálogo", () => {
    expect(motivoBloqueioEntrada(COMPLETO)).toBeNull();
  });

  it("libera material escolhido no catálogo, que não precisa de tipo", () => {
    expect(motivoBloqueioEntrada(com({ materialId: "item-1", nomeNovo: null, tipoNovo: "" })))
      .toBeNull();
  });

  // O caso exato do relato: tudo preenchido, menos o tipo do material novo.
  it("aponta o tipo faltando no material novo", () => {
    expect(motivoBloqueioEntrada(com({ tipoNovo: "" })))
      .toBe("Escolha o tipo do material novo.");
  });

  it("não cobra tipo de quem escolheu material do catálogo", () => {
    expect(motivoBloqueioEntrada(com({ materialId: "item-1", tipoNovo: "" }))).toBeNull();
  });

  it("pede o almoxarifado antes de qualquer outra coisa", () => {
    // Formulário vazio: a primeira frase é a do primeiro campo, de cima para
    // baixo — mandar a pessoa ao último campo vazio seria mandá-la ao lugar
    // errado.
    const vazio = com({ almoxarifado: "", nomeNovo: null, tipoNovo: "", total: 0 });
    expect(motivoBloqueioEntrada(vazio)).toBe("Escolha o almoxarifado.");
  });

  it("pede o material quando nada foi escolhido nem digitado", () => {
    expect(motivoBloqueioEntrada(com({ nomeNovo: null, tipoNovo: "" })))
      .toBe("Escolha o material no catálogo ou digite o nome de um novo.");
  });

  it("pede a decisão quando o nome parece tamanho de outro material", () => {
    // "TESTE EDUARDO" com "TESTE" no catálogo: enquanto a pessoa não disser se
    // é tamanho ou material próprio, não há material — mas o motivo é a
    // pergunta aberta, não um campo em branco.
    const m = motivoBloqueioEntrada(com({ nomeNovo: null, decisaoDeTamanhoPendente: true }));
    expect(m).toContain("tamanho de um material que já existe");
  });

  it("a decisão de tamanho some quando já há material escolhido", () => {
    expect(motivoBloqueioEntrada(com({ materialId: "item-1", decisaoDeTamanhoPendente: true })))
      .toBeNull();
  });

  it("pede quantidade quando todos os blocos estão zerados", () => {
    expect(motivoBloqueioEntrada(com({ total: 0 })))
      .toBe("Informe a quantidade de pelo menos um tamanho.");
  });

  it("repassa o erro de CA do SST como está", () => {
    const erro = "A validade informada não atende aos 6 meses mínimos exigidos pelo laudo do SST.";
    expect(motivoBloqueioEntrada(com({ erroCa: erro }))).toBe(erro);
  });

  it("segura o botão enquanto o laudo carrega e enquanto grava", () => {
    expect(motivoBloqueioEntrada(com({ laudoCarregando: true }))).not.toBeNull();
    expect(motivoBloqueioEntrada(com({ enviando: true }))).not.toBeNull();
  });

  it("o CA vem antes do laudo carregando: erro real ganha de estado transitório", () => {
    expect(motivoBloqueioEntrada(com({ erroCa: "Informe a validade do CA", laudoCarregando: true })))
      .toBe("Informe a validade do CA");
  });
});
