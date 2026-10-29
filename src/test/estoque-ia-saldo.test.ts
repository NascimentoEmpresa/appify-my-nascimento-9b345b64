import { describe, expect, it } from "vitest";
import {
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
});
