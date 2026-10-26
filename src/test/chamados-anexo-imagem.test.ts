import { describe, expect, it } from "vitest";
import { ehImagemAnexo, opcoesDownloadAnexo } from "@/pages/chamados/types";

describe("Chamados — anexo que abre no visualizador (card no centro)", () => {
  it("foto e print abrem no card, pelo mime ou pela extensão", () => {
    expect(ehImagemAnexo({ mime_type: "image/png", nome_arquivo: "print.png" })).toBe(true);
    expect(ehImagemAnexo({ mime_type: null, nome_arquivo: "FOTO.JPEG" })).toBe(true);
    expect(ehImagemAnexo({ mime_type: "image/webp", nome_arquivo: "tela" })).toBe(true);
    expect(ehImagemAnexo({ mime_type: null, nome_arquivo: "", storage_path: "abc/1729-print.gif" })).toBe(true);
  });

  it("PDF, planilha e HTML continuam abrindo como antes", () => {
    expect(ehImagemAnexo({ mime_type: "application/pdf", nome_arquivo: "nota.pdf" })).toBe(false);
    expect(ehImagemAnexo({ mime_type: null, nome_arquivo: "base.xlsx" })).toBe(false);
    expect(ehImagemAnexo({ mime_type: "text/html", nome_arquivo: "tela.html" })).toBe(false);
  });

  it("SVG fica fora: o Storage serve como texto e ele já vem com download forçado", () => {
    expect(ehImagemAnexo({ mime_type: "image/svg+xml", nome_arquivo: "logo.svg" })).toBe(false);
    expect(ehImagemAnexo({ mime_type: null, nome_arquivo: "logo.SVG" })).toBe(false);
    expect(opcoesDownloadAnexo("abc/1729-logo.svg")).toEqual({ download: "logo.svg" });
  });
});
