import { describe, expect, it } from "vitest";
import {
  ehPerguntaQuantidadeAtual,
  itensRelacionados,
  respostaQuantidadeAtual,
  respostaResumoOperacional,
} from "../../supabase/functions/_shared/estoque-ia";

const itens = [
  { item: "MOLETOM CINZA", tamanho: "G", fisico: 0, disponivel: 0, reservado: 0 },
  { item: "MOLETOM CINZA", tamanho: "GG", fisico: 1, disponivel: 1, reservado: 0 },
  { item: "MOLETOM CINZA", tamanho: "EGG", fisico: 11, disponivel: 10, reservado: 1 },
  { item: "MOLETOM AZUL", tamanho: "EGG", fisico: 99, disponivel: 99, reservado: 0 },
];

describe("Assistente do Estoque — consulta exata no catálogo completo", () => {
  it("prioriza item e tamanho citados, sem confundir EGG com outros tamanhos", () => {
    const encontrados = itensRelacionados(
      "quanto de moletom cinza egg eu tenho no meu estoque atualmente?",
      itens,
    );

    expect(encontrados[0]).toMatchObject({ item: "MOLETOM CINZA", tamanho: "EGG" });
  });

  it("responde o saldo físico, disponível e reservado diretamente da RPC", () => {
    const resposta = respostaQuantidadeAtual(
      "quanto de moletom cinza egg eu tenho no meu estoque atualmente?",
      itens,
    );

    expect(resposta).toContain("MOLETOM CINZA (EGG)");
    expect(resposta).toContain("11 unidade(s) física(s)");
    expect(resposta).toContain("10 disponível(is)");
    expect(resposta).toContain("1 reservada(s)");
    expect(resposta).not.toContain("MOLETOM AZUL");
  });

  it("responde entradas registradas com o mesmo KPI da tela operacional", () => {
    const resposta = respostaResumoOperacional(
      "quantas entradas registradas tenho no meu estoque atualmente?",
      { entradas_registradas: 10584 },
    );

    expect(resposta).toContain("10.584 entradas registradas");
    expect(resposta).toContain("Estoque & Etiquetas");
  });

  it("não confunde um cadastro exato com a família de nome parecido", () => {
    const resposta = respostaQuantidadeAtual(
      "quanto temos de AVENTAL DE NAPA (BRANCO) em estoque atualmente?",
      [
        { codigo: "0000961", item: "AVENTAL DE NAPA", tamanho: null, fisico: 2, disponivel: 2, reservado: 0 },
        { codigo: "0002573", item: "AVENTAL DE NAPA (BRANCO)", tamanho: null, fisico: 5, disponivel: 5, reservado: 0 },
      ],
    );

    expect(resposta).toContain("AVENTAL DE NAPA (BRANCO) (único)");
    expect(resposta).toContain("0002573");
    expect(resposta).toContain("5 unidade(s) física(s)");
    expect(resposta).not.toContain("0000961");
    expect(resposta).not.toContain("2 unidade(s) física(s)");
  });

  it("recusa saldo aproximado quando falta o cadastro com todos os termos", () => {
    const resposta = respostaQuantidadeAtual(
      "quanto temos de AVENTAL DE NAPA (BRANCO) em estoque atualmente?",
      [{ codigo: "0000961", item: "AVENTAL DE NAPA", tamanho: null, fisico: 2, disponivel: 2, reservado: 0 }],
    );

    expect(resposta).toContain("não usei o saldo dele");
    expect(resposta).not.toContain("2 unidade(s) física(s)");
  });

  it("separa perguntas de saldo das perguntas de KPI e de dinheiro parado", () => {
    expect(ehPerguntaQuantidadeAtual(
      "quanto temos de AVENTAL DE NAPA (BRANCO) em estoque atualmente?",
    )).toBe(true);
    expect(ehPerguntaQuantidadeAtual(
      "quantas entradas registradas tenho no meu estoque atualmente?",
    )).toBe(false);
    expect(ehPerguntaQuantidadeAtual(
      "quanto dinheiro eu tenho parado no estoque hoje?",
    )).toBe(false);
  });
});
