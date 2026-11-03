import { describe, expect, it } from "vitest";
import { abreNaAbaAnexo, motivoFalhaAnexo, nomeSalvarAnexo } from "@/pages/chamados/types";

describe("Chamados — abrir/baixar anexo que não é imagem", () => {
  it("PDF e texto abrem na aba; Word, planilha e HTML baixam", () => {
    expect(abreNaAbaAnexo({ mime_type: "application/pdf", nome_arquivo: "nota.pdf" })).toBe(true);
    expect(abreNaAbaAnexo({ mime_type: null, nome_arquivo: "LOG.TXT" })).toBe(true);
    expect(abreNaAbaAnexo({
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      nome_arquivo: "Pesquisa_Permanencia_Grupo_Nascimento_Relatorios_Detalhados.docx",
    })).toBe(false);
    expect(abreNaAbaAnexo({ mime_type: null, nome_arquivo: "base.xlsx" })).toBe(false);
    expect(abreNaAbaAnexo({ mime_type: "text/html", nome_arquivo: "tela.html" })).toBe(false);
  });

  it("salva com o nome original, ou o do caminho sem o carimbo de tempo", () => {
    expect(nomeSalvarAnexo({ nome_arquivo: "Relatorio.docx", storage_path: "x/1730-Relatorio.docx" })).toBe("Relatorio.docx");
    expect(nomeSalvarAnexo({ nome_arquivo: null, storage_path: "abc/1730000000-Relatorio.docx" })).toBe("Relatorio.docx");
  });

  it("arquivo ausente no Storage vira 'não encontrado no servidor'", () => {
    const naoAchou = /não encontrado no servidor/;
    expect(motivoFalhaAnexo({ message: "Object not found", status: 400, statusCode: "404" })).toMatch(naoAchou);
    expect(motivoFalhaAnexo({ message: "x", status: 404 })).toMatch(naoAchou);
    expect(motivoFalhaAnexo({ message: "The specified key does not exist", statusCode: "NoSuchKey" })).toMatch(naoAchou);
  });

  it("permissão, rede e erro sem detalhe têm frase própria", () => {
    expect(motivoFalhaAnexo({ message: "new row violates row-level security policy", status: 400 })).toMatch(/permissão/);
    expect(motivoFalhaAnexo({ message: "jwt expired", status: 400, statusCode: "403" })).toMatch(/permissão/);
    expect(motivoFalhaAnexo(new TypeError("Failed to fetch"))).toMatch(/conexão/);
    expect(motivoFalhaAnexo(null)).toMatch(/não devolveu/);
    expect(motivoFalhaAnexo({ message: "Internal Server Error", status: 500 })).toBe("Internal Server Error");
  });
});
