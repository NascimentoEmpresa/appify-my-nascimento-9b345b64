import { describe, it, expect } from "vitest";
import {
  arteDaEmpresa, certificadoLiberado, nomeParaAssinar, payloadAssinatura, problemaAssinaturaColaborador, rascunhoInicial,
} from "@/lib/treinamentos/certificadoColaborador";

// =====================================================================
// Treinamentos › certificado com a assinatura do colaborador (13/11/2026,
// mig 20261115000200): sem assinar não abre; a arte depende da empresa.
// =====================================================================

const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("arteDaEmpresa", () => {
  it("SN (sigla ou código 2) usa a arte da SN", () => {
    expect(arteDaEmpresa("SN")).toBe("sn");
    expect(arteDaEmpresa(" sn ")).toBe("sn");
    expect(arteDaEmpresa(2)).toBe("sn");
  });
  it("NH (sigla ou código 5) usa a arte da NH", () => {
    expect(arteDaEmpresa("NH")).toBe("nh");
    expect(arteDaEmpresa(" nh ")).toBe("nh");
    expect(arteDaEmpresa(5)).toBe("nh");
    expect(arteDaEmpresa("5")).toBe("nh");
  });
  it("HAGG e as outras empresas usam a da Nascimento", () => {
    expect(arteDaEmpresa("HAGG")).toBe("nascimento");
    expect(arteDaEmpresa("1")).toBe("nascimento");
    expect(arteDaEmpresa("CANAÃ")).toBe("nascimento");
    expect(arteDaEmpresa(3)).toBe("nascimento");
    expect(arteDaEmpresa("NHX")).toBe("nascimento");
    expect(arteDaEmpresa(null)).toBe("nascimento");
  });
});

describe("problemaAssinaturaColaborador", () => {
  it("exige escolher desenho ou texto", () => {
    expect(problemaAssinaturaColaborador(null)).toMatch(/desenhar ou escrever/);
    expect(problemaAssinaturaColaborador({})).toMatch(/desenhar ou escrever/);
  });
  it("desenho precisa do PNG e com tamanho limite", () => {
    expect(problemaAssinaturaColaborador({ tipo: "desenho", imagem: null })).toMatch(/Desenhe/);
    expect(problemaAssinaturaColaborador({ tipo: "desenho", imagem: "data:image/jpeg;base64,xx" })).toMatch(/Desenhe/);
    expect(problemaAssinaturaColaborador({ tipo: "desenho", imagem: PNG + "a".repeat(400_001) })).toMatch(/grande demais/);
    expect(problemaAssinaturaColaborador({ tipo: "desenho", imagem: PNG })).toBeNull();
  });
  it("texto precisa do nome, da letra e de tamanho válido", () => {
    expect(problemaAssinaturaColaborador({ tipo: "texto", texto: " a ", fonte: "Great Vibes" })).toMatch(/Escreva/);
    expect(problemaAssinaturaColaborador({ tipo: "texto", texto: "x".repeat(81), fonte: "Great Vibes" })).toMatch(/80/);
    expect(problemaAssinaturaColaborador({ tipo: "texto", texto: "Maria Silva", fonte: "" })).toMatch(/letra/);
    expect(problemaAssinaturaColaborador({ tipo: "texto", texto: "Maria Silva", fonte: "Caveat", tamanho: 2 })).toMatch(/Tamanho/);
    expect(problemaAssinaturaColaborador({ tipo: "texto", texto: "Maria Silva", fonte: "Caveat" })).toBeNull();
  });
});

describe("payloadAssinatura", () => {
  it("manda só os campos do tipo escolhido", () => {
    expect(payloadAssinatura({ tipo: "desenho", imagem: PNG, texto: "sobra", fonte: "Caveat" })).toEqual({ tipo: "desenho", imagem: PNG });
    expect(payloadAssinatura({ tipo: "texto", texto: "  Maria ", fonte: "Caveat", imagem: PNG })).toEqual({ tipo: "texto", texto: "Maria", fonte: "Caveat", tamanho: 1 });
  });
});

describe("rascunhoInicial (já assinou antes)", () => {
  it("reaproveita a última assinatura válida como ponto de partida", () => {
    expect(rascunhoInicial({ tipo: "desenho", imagem: PNG }, "Maria", "Great Vibes")).toEqual({ tipo: "desenho", imagem: PNG });
  });
  it("sem assinatura anterior (ou inválida) começa pelo nome escrito", () => {
    const esperado = { tipo: "texto", texto: "Maria da Silva", fonte: "Great Vibes", tamanho: 1 };
    expect(rascunhoInicial(null, " MARIA DA  SILVA ", "Great Vibes")).toEqual(esperado);
    expect(rascunhoInicial({ tipo: "desenho", imagem: null }, "Maria da Silva", "Great Vibes")).toEqual(esperado);
  });
});

describe("nomeParaAssinar", () => {
  it("tira o nome do cadastro da caixa alta, sem capitalizar as ligações", () => {
    expect(nomeParaAssinar("JOSÉ DOS SANTOS E SOUZA")).toBe("José dos Santos e Souza");
    expect(nomeParaAssinar("ÂNGELA DE ÁVILA")).toBe("Ângela de Ávila");
  });
});

describe("certificadoLiberado", () => {
  it("só abre com a assinatura do colaborador gravada", () => {
    expect(certificadoLiberado(null)).toBe(false);
    expect(certificadoLiberado({ pendente_assinatura: true })).toBe(false);
    expect(certificadoLiberado({ assinatura_aluno: null })).toBe(false);
    expect(certificadoLiberado({ assinatura_aluno: { tipo: "desenho", imagem: PNG } })).toBe(true);
  });
});
