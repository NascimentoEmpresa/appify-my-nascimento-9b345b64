import { describe, expect, it } from "vitest";
import { dataHoraBr, montarPdfRespostas } from "@/lib/formularios/respostasPdf";

const resposta = (quem: string, texto: string) => ({
  quem, enviadoEm: "2026-09-20T13:05:00Z", email: "a@b.com", setor: "RH",
  blocos: [
    { pergunta: "Como avalia o atendimento?", itens: [texto] },
    { pergunta: "Quais pontos?", itens: ["Pontualidade", "Organização"] },
  ],
});

describe("PDF de respostas de formulário", () => {
  it("capa + uma página por resposta", () => {
    const doc = montarPdfRespostas({ formulario: "Pesquisa", recorte: "Todas as respostas", nomeArquivo: "x.pdf",
      respostas: [resposta("ANA", "Bom"), resposta("JOÃO", "Ótimo")] });
    expect(doc.getNumberOfPages()).toBe(3);
  });

  it("resposta longa quebra página em vez de cortar", () => {
    const longo = "texto comprido de resposta ".repeat(400);
    const doc = montarPdfRespostas({ formulario: "Pesquisa", recorte: "Resposta individual", nomeArquivo: "x.pdf",
      respostas: [resposta("ANA", longo)] });
    expect(doc.getNumberOfPages()).toBeGreaterThan(2);
  });

  it("emoji não quebra a geração", () => {
    const doc = montarPdfRespostas({ formulario: "Pesquisa 📊", recorte: "Todas", nomeArquivo: "x.pdf",
      respostas: [{ ...resposta("🕶 Anônimo", "★★★ nota 3"), anonima: true }] });
    expect(doc.getNumberOfPages()).toBe(2);
  });

  it("data no padrão DD/MM/AAAA", () => {
    expect(dataHoraBr("2026-09-20T13:05:00")).toMatch(/^20\/09\/2026 13:05$/);
  });
});
