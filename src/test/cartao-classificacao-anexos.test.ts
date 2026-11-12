import { describe, expect, it } from "vitest";
import {
  ANEXO_CLASSIFICACAO_MAX_BYTES,
  MAX_ANEXOS_POR_ITEM,
  abreNaAba,
  caminhoAnexoClassificacao,
  complementoMudou,
  juntarArquivos,
} from "@/lib/cartaoFatura/anexosClassificacao";

// SIS-2026-0879: anexos (NF, prints) e observação no "Classificar item" do Cartão de Crédito.
const arquivo = (nome: string, tamanho: number, tipo = "application/pdf") => {
  const f = new File([new Uint8Array(1)], nome, { type: tipo });
  Object.defineProperty(f, "size", { value: tamanho });
  return f;
};

describe("anexos da classificação do cartão", () => {
  it("monta o caminho direto na pasta do item, sem acento nem espaço", () => {
    expect(caminhoAnexoClassificacao("item-1", "NF Mercado Livre ção.pdf", 2, 1000)).toBe("item-1/1000-2_NF_Mercado_Livre_cao.pdf");
  });

  it("ignora o mesmo arquivo duas vezes e recusa vazio e acima de 25 MB", () => {
    const nf = arquivo("nf.pdf", 100);
    const r = juntarArquivos([nf], [arquivo("nf.pdf", 100), arquivo("vazio.png", 0), arquivo("grande.pdf", ANEXO_CLASSIFICACAO_MAX_BYTES + 1), arquivo("print.png", 50, "image/png")], 0);
    expect(r.arquivos.map((f) => f.name)).toEqual(["nf.pdf", "print.png"]);
    expect(r.avisos).toHaveLength(2);
  });

  it("conta os já salvos no limite de arquivos por item", () => {
    const r = juntarArquivos([], [arquivo("a.pdf", 1), arquivo("b.pdf", 1)], MAX_ANEXOS_POR_ITEM - 1);
    expect(r.arquivos.map((f) => f.name)).toEqual(["a.pdf"]);
    expect(r.avisos[0]).toContain("b.pdf");
  });

  it("só considera mudança quando a observação ou os anexos mudam", () => {
    expect(complementoMudou({ observacaoSalva: "ok", observacao: " ok ", removidos: 0, novos: 0 })).toBe(false);
    expect(complementoMudou({ observacaoSalva: "", observacao: "NF em anexo", removidos: 0, novos: 0 })).toBe(true);
    expect(complementoMudou({ observacaoSalva: "", observacao: "", removidos: 1, novos: 0 })).toBe(true);
    expect(complementoMudou({ observacaoSalva: "", observacao: "", removidos: 0, novos: 1 })).toBe(true);
  });

  it("PDF e print abrem na aba; XML da NF baixa", () => {
    expect(abreNaAba({ nome: "nf.pdf", tipo: "application/pdf" })).toBe(true);
    expect(abreNaAba({ nome: "print.png", tipo: null })).toBe(true);
    expect(abreNaAba({ nome: "nf.xml", tipo: "text/xml" })).toBe(false);
  });
});
