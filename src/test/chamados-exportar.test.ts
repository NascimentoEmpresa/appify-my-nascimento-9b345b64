import { describe, it, expect } from "vitest";
import { nomeNoZip, nomeSeguro } from "@/pages/chamados/exportarUtils";

// =====================================================================
// Nomes dos anexos dentro do ZIP.
//
// É a parte que falha em silêncio: `zip.file()` sobrescreve a entrada de
// mesmo nome sem erro nenhum, então um bug aqui entrega um pacote com
// menos arquivos do que o chamado tem e ninguém percebe.
// =====================================================================

const ax = (nome_arquivo: string, campo = "abertura") => ({ nome_arquivo, campo });

describe("nomeSeguro", () => {
  it("tira acento e caractere que atrapalha em sistema de arquivos", () => {
    expect(nomeSeguro("Relatório de Não-Conformidade.pdf", 1))
      .toBe("Relatorio de Nao-Conformidade.pdf");
    expect(nomeSeguro("nota 1/2: cópia*.png", 1)).toBe("nota 1_2_ copia_.png");
  });

  it("preserva a extensão", () => {
    expect(nomeSeguro("planilha.xlsx", 1).endsWith(".xlsx")).toBe(true);
  });

  it("nome vazio vira um nome utilizável", () => {
    expect(nomeSeguro("", 3)).toBe("anexo-3");
    expect(nomeSeguro("###", 4)).toBe("_");   // sobra o separador, mas não fica vazio
  });
});

describe("nomeNoZip", () => {
  it("separa por pasta conforme a origem do anexo", () => {
    const u = new Set<string>();
    expect(nomeNoZip(ax("a.pdf", "abertura"), 0, u)).toBe("1-abertura/a.pdf");
    expect(nomeNoZip(ax("b.pdf", "chat"), 1, u)).toBe("2-conversa/b.pdf");
    expect(nomeNoZip(ax("c.pdf", "interno"), 2, u)).toBe("3-interno/c.pdf");
  });

  it("anexo legado ('resposta') cai na conversa em vez de sumir", () => {
    const u = new Set<string>();
    expect(nomeNoZip(ax("d.pdf", "resposta"), 0, u)).toBe("2-conversa/d.pdf");
  });

  it("nome repetido na MESMA pasta ganha sufixo, sem sobrescrever", () => {
    const u = new Set<string>();
    const a = nomeNoZip(ax("print.png"), 0, u);
    const b = nomeNoZip(ax("print.png"), 1, u);
    expect(a).toBe("1-abertura/print.png");
    expect(b).toBe("1-abertura/print (2).png");
    expect(a).not.toBe(b);
    expect(u.size).toBe(2);
  });

  it("mesmo nome em pastas DIFERENTES não vira colisão", () => {
    const u = new Set<string>();
    expect(nomeNoZip(ax("print.png", "abertura"), 0, u)).toBe("1-abertura/print.png");
    expect(nomeNoZip(ax("print.png", "chat"), 1, u)).toBe("2-conversa/print.png");
  });

  it("arquivo sem extensão recebe o sufixo no fim", () => {
    const u = new Set<string>();
    nomeNoZip(ax("LEIAME"), 0, u);
    expect(nomeNoZip(ax("LEIAME"), 1, u)).toBe("1-abertura/LEIAME (2)");
  });

  it("ponto só na pasta não é confundido com extensão", () => {
    // O nome do arquivo não tem ponto, mas o caminho tem barra depois dele:
    // sem comparar as posições, o sufixo entraria no meio da pasta.
    const u = new Set<string>();
    nomeNoZip(ax("relatorio"), 0, u);
    const segundo = nomeNoZip(ax("relatorio"), 1, u);
    expect(segundo.startsWith("1-abertura/")).toBe(true);
    expect(segundo).toBe("1-abertura/relatorio (2)");
  });

  it("três iguais geram três entradas distintas", () => {
    const u = new Set<string>();
    const nomes = [0, 1, 2].map((i) => nomeNoZip(ax("foto.jpg"), i, u));
    expect(new Set(nomes).size).toBe(3);
  });
});
