import { describe, expect, it } from "vitest";
import {
  aplicarMinuta, podeMarcarFinal, podeRedigirDocumento, situacaoDocumento,
} from "@/pages/comite-etica/documentos";
import {
  MINUTAS, blocoAnexos, conferirMinuta, distribuirOrcamento, leituraDoAnexo, minutaPorId,
  montarPedidoMinuta, textoDeDocxXml,
} from "../../supabase/functions/_shared/denuncia-minuta-ia";

describe("quem redige os documentos da investigação", () => {
  const base = { userId: "u1", relatorId: "u2", presidencia: false, capacidadeDocumentos: false };
  it("o relator do caso redige", () => expect(podeRedigirDocumento({ ...base, relatorId: "u1" })).toBe(true));
  it("a Presidência redige", () => expect(podeRedigirDocumento({ ...base, presidencia: true })).toBe(true));
  it("a capacidade própria redige", () => expect(podeRedigirDocumento({ ...base, capacidadeDocumentos: true })).toBe(true));
  it("outro membro do Comitê só lê", () => expect(podeRedigirDocumento(base)).toBe(false));
  it("caso sem relator não libera ninguém por acaso", () =>
    expect(podeRedigirDocumento({ ...base, userId: "u1", relatorId: null })).toBe(false));
  it("sem login, ninguém", () => expect(podeRedigirDocumento({ ...base, userId: null, presidencia: true })).toBe(false));
});

describe("situação do documento", () => {
  it("vazio, rascunho, final e alterado", () => {
    expect(situacaoDocumento(null, "")).toBe("vazio");
    expect(situacaoDocumento(null, "texto")).toBe("alterado");
    expect(situacaoDocumento({ conteudo: "a", final: false }, "a")).toBe("rascunho");
    expect(situacaoDocumento({ conteudo: "a", final: true }, "a")).toBe("final");
    expect(situacaoDocumento({ conteudo: "a", final: false }, "ab")).toBe("alterado");
  });

  it("versão final só com texto salvo e sem alteração pendente", () => {
    expect(podeMarcarFinal(null, "x")).toBe(false);
    expect(podeMarcarFinal({ conteudo: "x", final: false }, "x")).toBe(true);
    expect(podeMarcarFinal({ conteudo: "x", final: false }, "xy")).toBe(false);
    expect(podeMarcarFinal({ conteudo: "  ", final: false }, "  ")).toBe(false);
    expect(podeMarcarFinal({ conteudo: "x", final: true }, "x")).toBe(false);
  });
});

describe("minuta da I.A no editor", () => {
  it("substitui ou acrescenta, nunca perde o texto atual ao acrescentar", () => {
    expect(aplicarMinuta("antigo", " nova ", "substituir")).toBe("nova");
    expect(aplicarMinuta("termo\n", "roteiro", "acrescentar")).toBe("termo\n\nroteiro");
    expect(aplicarMinuta("", "roteiro", "acrescentar")).toBe("roteiro");
  });

  it("as três minutas existem e o roteiro vai para a aba do termo", () => {
    expect(MINUTAS.map((m) => m.id)).toEqual(["termo_abertura", "roteiro_entrevista", "parecer_conclusivo"]);
    expect(minutaPorId("roteiro_entrevista")?.aba).toBe("termo_abertura");
    expect(minutaPorId("qualquer")).toBeUndefined();
  });

  it("orientação do relator entra no pedido, cortada", () => {
    const m = minutaPorId("parecer_conclusivo")!;
    expect(montarPedidoMinuta(m, "foco nas mensagens")).toContain("foco nas mensagens");
    expect(montarPedidoMinuta(m, "x".repeat(5000)).length).toBeLessThan(m.estrutura.length + 1700);
  });

  it("conferência limpa Markdown e recusa minuta curta", () => {
    const m = minutaPorId("termo_abertura")!;
    expect(conferirMinuta("curto", m).ok).toBe(false);
    const r = conferirMinuta("```\n# TERMO\n**negrito** " + "a".repeat(600) + "\n```", m);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.texto.startsWith("TERMO")).toBe(true);
      expect(r.texto).not.toContain("**");
      expect(r.texto).not.toContain("```");
    }
  });
});

describe("leitura dos anexos", () => {
  it("anexo sigiloso nunca é lido", () => {
    expect(leituraDoAnexo({ nome_arquivo: "a.pdf", mime_type: "application/pdf", sensivel: true })).toBe("nenhuma");
  });
  it("classifica pelo tipo e pela extensão", () => {
    expect(leituraDoAnexo({ nome_arquivo: "a.PDF", mime_type: null })).toBe("pdf");
    expect(leituraDoAnexo({ nome_arquivo: "b.docx", mime_type: "" })).toBe("docx");
    expect(leituraDoAnexo({ nome_arquivo: "c.jpg", mime_type: "image/jpeg" })).toBe("imagem");
    expect(leituraDoAnexo({ nome_arquivo: "d.heic", mime_type: "image/heic" })).toBe("nenhuma");
    expect(leituraDoAnexo({ nome_arquivo: "e.txt", mime_type: "text/plain" })).toBe("texto");
    expect(leituraDoAnexo({ nome_arquivo: "f.mp4", mime_type: "video/mp4" })).toBe("nenhuma");
  });
  it("tira o texto do document.xml do Word", () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Ata &amp; registro</w:t></w:r></w:p><w:p><w:r><w:t>Linha 2</w:t></w:r></w:p></w:body></w:document>';
    expect(textoDeDocxXml(xml)).toBe("Ata & registro\nLinha 2");
  });
  it("respeita o teto por arquivo e o total", () => {
    const r = distribuirOrcamento(["a".repeat(100), "b".repeat(100), "c".repeat(100)], 60, 100);
    expect(r[0]).toBe(`${"a".repeat(60)}… [cortado]`);
    expect(r[1]).toBe(`${"b".repeat(40)}… [cortado]`);
    expect(r[2]).toBe("");
  });
  it("o bloco cita o motivo de não ter lido", () => {
    const b = blocoAnexos([
      { numero: 1, nome: "anexo sigiloso", categoria: "evidencia", leitura: "nenhuma", aviso: "anexo sigiloso — não é enviado à I.A" },
      { numero: 2, nome: "ata.docx", categoria: "documento_suporte", leitura: "docx", texto: "conteúdo" },
    ]);
    expect(b).toContain("[Anexo 1] anexo sigiloso");
    expect(b).toContain("conteúdo não lido");
    expect(b).toContain("[Anexo 2] ata.docx (documento suporte)");
    expect(b).toContain("conteúdo");
  });
});
