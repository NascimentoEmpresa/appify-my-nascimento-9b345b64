import { describe, it, expect } from "vitest";
import { problemaAssinatura, FONTES_ASSINATURA } from "@/pages/treinamentos/plataforma/assinaturaFolha";

// =====================================================================
// Treinamentos › Assinaturas (mig 20261005000003): o que a tela cobra antes
// de salvar — as mesmas regras do CHECK de "TRN_ASSINATURA".
// =====================================================================

const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("problemaAssinatura", () => {
  it("exige o nome completo do treinador", () => {
    expect(problemaAssinatura({ tipo: "desenho", imagem: PNG, nome_completo: "  " })).toMatch(/nome completo/);
  });
  it("desenhada: precisa do traço em PNG", () => {
    expect(problemaAssinatura({ tipo: "desenho", nome_completo: "Ana Souza", imagem: null })).toMatch(/Desenhe/);
    expect(problemaAssinatura({ tipo: "desenho", nome_completo: "Ana Souza", imagem: "data:image/jpeg;base64,xx" })).toMatch(/Desenhe/);
    expect(problemaAssinatura({ tipo: "desenho", nome_completo: "Ana Souza", imagem: PNG + "A".repeat(400_000) })).toMatch(/grande/);
    expect(problemaAssinatura({ tipo: "desenho", nome_completo: "Ana Souza", imagem: PNG })).toBeNull();
  });
  it("escrita: precisa do texto e de uma fonte da lista", () => {
    expect(problemaAssinatura({ tipo: "texto", nome_completo: "Ana Souza", texto: "", fonte: "Allura" })).toMatch(/Escreva/);
    expect(problemaAssinatura({ tipo: "texto", nome_completo: "Ana Souza", texto: "Ana Souza", fonte: "Comic Sans" })).toMatch(/letra/);
    expect(problemaAssinatura({ tipo: "texto", nome_completo: "Ana Souza", texto: "Ana Souza", fonte: FONTES_ASSINATURA[0].id })).toBeNull();
  });
});
