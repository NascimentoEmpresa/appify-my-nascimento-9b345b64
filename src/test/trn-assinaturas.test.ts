import { describe, it, expect } from "vitest";
import { assinaturaValeParaPublicar, cargoERegistro, problemaAssinatura, FONTES_ASSINATURA } from "@/pages/treinamentos/plataforma/assinaturaFolha";

// =====================================================================
// Treinamentos › Assinaturas (mig 20261005000003): o que a tela cobra antes
// de salvar — as mesmas regras do CHECK de "TRN_ASSINATURA". Cargo e
// registro obrigatórios, e só Técnico(a) em Segurança publica curso
// (mig 20261006000001 — trn_assinatura_eh_tst no banco).
// =====================================================================

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const BASE = { nome_completo: "Ana Souza", cargo: "Técnica em Segurança do Trabalho", registro: "0031036" };

describe("problemaAssinatura", () => {
  it("exige o nome completo do treinador", () => {
    expect(problemaAssinatura({ ...BASE, tipo: "desenho", imagem: PNG, nome_completo: "  " })).toMatch(/nome completo/);
  });
  it("exige cargo e registro", () => {
    expect(problemaAssinatura({ ...BASE, tipo: "desenho", imagem: PNG, cargo: "" })).toMatch(/cargo/);
    expect(problemaAssinatura({ ...BASE, tipo: "desenho", imagem: PNG, registro: " " })).toMatch(/registro/);
  });
  it("desenhada: precisa do traço em PNG", () => {
    expect(problemaAssinatura({ ...BASE, tipo: "desenho", imagem: null })).toMatch(/Desenhe/);
    expect(problemaAssinatura({ ...BASE, tipo: "desenho", imagem: "data:image/jpeg;base64,xx" })).toMatch(/Desenhe/);
    expect(problemaAssinatura({ ...BASE, tipo: "desenho", imagem: PNG + "A".repeat(400_000) })).toMatch(/grande/);
    expect(problemaAssinatura({ ...BASE, tipo: "desenho", imagem: PNG })).toBeNull();
  });
  it("escrita: precisa do texto e de uma fonte da lista", () => {
    expect(problemaAssinatura({ ...BASE, tipo: "texto", texto: "", fonte: "Allura" })).toMatch(/Escreva/);
    expect(problemaAssinatura({ ...BASE, tipo: "texto", texto: "Ana Souza", fonte: "Comic Sans" })).toMatch(/letra/);
    expect(problemaAssinatura({ ...BASE, tipo: "texto", texto: "Ana Souza", fonte: FONTES_ASSINATURA[0].id })).toBeNull();
  });
});

describe("assinaturaValeParaPublicar", () => {
  it("aceita Técnico(a) em Segurança, por extenso ou abreviado, com registro", () => {
    expect(assinaturaValeParaPublicar(BASE)).toBe(true);
    expect(assinaturaValeParaPublicar({ cargo: "TÉCNICO DE SEGURANÇA DO TRABALHO", registro: "12" })).toBe(true);
    expect(assinaturaValeParaPublicar({ cargo: "Téc em segurança", registro: "12" })).toBe(true);
  });
  it("recusa outro cargo ou sem registro", () => {
    expect(assinaturaValeParaPublicar({ cargo: "Instrutor de Treinamentos", registro: "12" })).toBe(false);
    expect(assinaturaValeParaPublicar({ cargo: "Técnica em Segurança do Trabalho", registro: "" })).toBe(false);
    expect(assinaturaValeParaPublicar(null)).toBe(false);
  });
  it("monta a linha Cargo · Registro", () => {
    expect(cargoERegistro(BASE)).toBe("Técnica em Segurança do Trabalho · Registro: 0031036");
  });
});

describe("letras e tamanho (06/10/2026)", () => {
  it("as 8 letras originais continuam na lista (assinatura salva não quebra)", () => {
    for (const id of ["Great Vibes", "Dancing Script", "Allura", "Alex Brush", "Sacramento", "Pinyon Script", "Parisienne", "Caveat"])
      expect(FONTES_ASSINATURA.some((f) => f.id === id)).toBe(true);
    expect(FONTES_ASSINATURA.length).toBeGreaterThanOrEqual(30);
    expect(new Set(FONTES_ASSINATURA.map((f) => f.id)).size).toBe(FONTES_ASSINATURA.length);
  });
  it("tamanho só entre 60% e 140%", () => {
    const ok = { ...BASE, tipo: "texto" as const, texto: "Ana", fonte: "Kristi" };
    expect(problemaAssinatura({ ...ok, tamanho: 1.4 })).toBeNull();
    expect(problemaAssinatura({ ...ok, tamanho: 0.5 })).toMatch(/Tamanho/);
    expect(problemaAssinatura({ ...ok, tamanho: 1.5 })).toMatch(/Tamanho/);
  });
});
