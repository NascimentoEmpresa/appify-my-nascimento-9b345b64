import { describe, expect, it } from "vitest";
import { validarArquivoManutencao } from "@/lib/suprimentos/anexoManutencao";

const MB = 1024 * 1024;
const arquivo = (name: string, type: string, size = 100_000) => ({ name, type, size });

describe("SIS-2026-0843 — anexos da solicitação de manutenção", () => {
  it("foto do equipamento aceita imagem e recusa PDF", () => {
    expect(validarArquivoManutencao(arquivo("maq.jpg", "image/jpeg"), "foto_equipamento")).toBeNull();
    expect(validarArquivoManutencao(arquivo("maq.pdf", "application/pdf"), "foto_equipamento")).toMatch(/imagem/);
  });

  it("orçamento aceita imagem ou PDF e recusa outros tipos", () => {
    expect(validarArquivoManutencao(arquivo("orc.png", "image/png"), "orcamento")).toBeNull();
    expect(validarArquivoManutencao(arquivo("orc.pdf", "application/pdf"), "orcamento")).toBeNull();
    expect(validarArquivoManutencao(arquivo("orc.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "orcamento")).toMatch(/PDF/);
  });

  it("recusa acima do limite de 5 MB do bucket", () => {
    expect(validarArquivoManutencao(arquivo("orc.pdf", "application/pdf", 6 * MB), "orcamento")).toMatch(/5 MB/);
    expect(validarArquivoManutencao(arquivo("maq.jpg", "image/jpeg", 5 * MB), "foto_equipamento")).toBeNull();
  });
});
