// SIS-2026-0870: anexos no chat de justificativa dos contratos não faturados.
import { describe, expect, it } from "vitest";
import {
  ANEXO_JUSTIFICATIVA_MAX_BYTES, MAX_ANEXOS_POR_MENSAGEM, abreNaAba, caminhoAnexoJustificativa, juntarSelecao, pastaDoChat,
  podeEnviarMensagem, textoDaMensagem,
} from "@/lib/controladoria/anexosJustificativa";
import { limiteDoBucketMb } from "@/lib/limiteAnexo";

const arquivo = (nome: string, tamanho: number) => ({ name: nome, size: tamanho, type: "application/pdf" }) as File;
const CONTRATO = "11111111-1111-1111-1111-111111111111";

describe("caminho no bucket", () => {
  it("fica na pasta do contrato + competência que a RPC exige", () => {
    expect(pastaDoChat(CONTRATO, "2026-10-01")).toBe(`${CONTRATO}/2026-10-01/`);
    const c = caminhoAnexoJustificativa(CONTRATO, "2026-10-01", "Autorização de faturamento.pdf", 2, 1700000000000);
    expect(c).toBe(`${CONTRATO}/2026-10-01/1700000000000-2_Autorizacao_de_faturamento.pdf`);
    expect(c.startsWith(pastaDoChat(CONTRATO, "2026-10-01"))).toBe(true);
  });

  it("nome com barra ou '..' não sai da pasta", () => {
    const c = caminhoAnexoJustificativa(CONTRATO, "2026-10-01", "../../outro/x.pdf", 0, 1);
    expect(c.startsWith(`${CONTRATO}/2026-10-01/`)).toBe(true);
    expect(c.slice(pastaDoChat(CONTRATO, "2026-10-01").length)).not.toContain("/");
  });
});

describe("seleção de arquivos", () => {
  it("junta, ignora o mesmo arquivo duas vezes e recusa acima de 25 MB ou vazio", () => {
    const a = arquivo("comprovante.pdf", 1000);
    const { arquivos, avisos } = juntarSelecao([a], [arquivo("comprovante.pdf", 1000), arquivo("grande.pdf", ANEXO_JUSTIFICATIVA_MAX_BYTES + 1), arquivo("vazio.pdf", 0), arquivo("nf.pdf", 10)]);
    expect(arquivos.map((f) => f.name)).toEqual(["comprovante.pdf", "nf.pdf"]);
    expect(avisos).toHaveLength(2);
    expect(avisos[0]).toContain("grande.pdf");
  });

  it(`corta em ${MAX_ANEXOS_POR_MENSAGEM} por mensagem`, () => {
    const muitos = Array.from({ length: MAX_ANEXOS_POR_MENSAGEM + 2 }, (_, i) => arquivo(`f${i}.pdf`, 10));
    const { arquivos, avisos } = juntarSelecao([], muitos);
    expect(arquivos).toHaveLength(MAX_ANEXOS_POR_MENSAGEM);
    expect(avisos).toHaveLength(2);
  });

  it("o limite do navegador bate com o do bucket", () => {
    expect(limiteDoBucketMb("faturamento-justificativa-anexos") * 1024 * 1024).toBe(ANEXO_JUSTIFICATIVA_MAX_BYTES);
  });
});

describe("envio", () => {
  it("texto com 2+ caracteres, ou só anexo", () => {
    expect(podeEnviarMensagem("ok", 0)).toBe(true);
    expect(podeEnviarMensagem(" a ", 0)).toBe(false);
    expect(podeEnviarMensagem("", 0)).toBe(false);
    expect(podeEnviarMensagem("", 1)).toBe(true);
  });
});

describe("resumo na tabela", () => {
  const anexo = (nome: string) => ({ nome, path: `${CONTRATO}/2026-10-01/1-0_${nome}` });

  it("mensagem antiga (sem anexos) continua igual", () => {
    expect(textoDaMensagem({ texto: "Comprovantes enviados por e-mail" })).toBe("Comprovantes enviados por e-mail");
    expect(textoDaMensagem({ texto: "Oi", anexos: [] })).toBe("Oi");
  });

  it("só anexo mostra o nome (ou a quantidade)", () => {
    expect(textoDaMensagem({ texto: "", anexos: [anexo("autorizacao.pdf")] })).toBe("📎 autorizacao.pdf");
    expect(textoDaMensagem({ texto: "", anexos: [anexo("a.pdf"), anexo("b.pdf")] })).toBe("📎 2 anexos");
    expect(textoDaMensagem({ texto: "Segue", anexos: [anexo("a.pdf")] })).toBe("📎 Segue");
  });
});

describe("abrir ou baixar", () => {
  it("PDF e imagem abrem numa aba; planilha e Word baixam", () => {
    expect(abreNaAba({ nome: "a.pdf", tipo: "application/pdf" })).toBe(true);
    expect(abreNaAba({ nome: "foto.JPG", tipo: null })).toBe(true);
    expect(abreNaAba({ nome: "planilha.xlsx", tipo: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })).toBe(false);
    expect(abreNaAba({ nome: "carta.docx" })).toBe(false);
  });
});
