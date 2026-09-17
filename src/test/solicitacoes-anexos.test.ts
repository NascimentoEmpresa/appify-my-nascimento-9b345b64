import { describe, it, expect } from "vitest";
import { arquivosDaColagem, caminhoAnexo, ehImagem, erroDoAnexo, fmtTamanho, nomeDeColagem, nomeSeguro } from "@/lib/solicitacoes/anexos";

// Anexos de solicitação e da conversa (17/09/2026): caminho no bucket, o que
// é imagem (vai inline no chat) e o nome da imagem colada com Ctrl+V.
describe("anexos de solicitação", () => {
  it("caminho: modulo/id/carimbo_nome-seguro", () => {
    expect(caminhoAnexo("advertencia", 65, "Relatório da ocorrência.pdf", 1700000000000))
      .toBe("advertencia/65/1700000000000_Relatorio_da_ocorrencia.pdf");
  });
  it("nome seguro tira acento, espaço e o que o storage recusa", () => {
    expect(nomeSeguro("foto do posto (1).JPG")).toBe("foto_do_posto_1_.JPG");
    expect(nomeSeguro("")).toBe("arquivo");
  });
  it("imagem pelo mime ou pela extensão", () => {
    expect(ehImagem("image/png", "x")).toBe(true);
    expect(ehImagem(null, "foto.jpeg")).toBe(true);
    expect(ehImagem("application/pdf", "doc.pdf")).toBe(false);
  });
  it("imagem colada ganha nome com data e hora", () => {
    const f = new File([new Uint8Array(3)], "image.png", { type: "image/png" });
    expect(nomeDeColagem(f, new Date(2026, 8, 17, 9, 5, 7))).toBe("colado-20260917-090507.png");
    const g = new File([new Uint8Array(3)], "print.png", { type: "image/png" });
    expect(nomeDeColagem(g)).toBe("print.png");
  });
  it("tamanho legível e limite de 25 MB", () => {
    expect(fmtTamanho(900)).toBe("900 B");
    expect(fmtTamanho(55 * 1024)).toBe("55 KB");
    expect(fmtTamanho(2.5 * 1024 * 1024)).toBe("2.5 MB");
    expect(erroDoAnexo(new File([new Uint8Array(10)], "ok.pdf"))).toBeNull();
    expect(erroDoAnexo({ name: "grande.mp4", size: 30 * 1024 * 1024 } as File)).toMatch(/limite é 25 MB/);
  });
  it("colagem sem arquivos devolve lista vazia", () => {
    expect(arquivosDaColagem(null)).toEqual([]);
  });
});
