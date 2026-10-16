import { describe, expect, it } from "vitest";
import { linhaCasaBusca } from "@/pages/financeiro/fluxo-caixa/buscaLinha";

const fatura = {
  id_malote: "SICREDI 119 — fatura 11/2026",
  descricao: "Fatura SICREDI 119 11/2026",
  rateioDetalhe: [
    { nome: "DM-2026-0100 · Posto Shell", idMalote: "DM-2026-0100", descricao: "Posto Shell" },
    { nome: "DA-2026-0525 · CHATGPT", idMalote: "DA-2026-0525", descricao: "CHATGPT" },
  ],
};

describe("busca do Fluxo", () => {
  it("termo vazio casa tudo", () => expect(linhaCasaBusca(fatura, "")).toBe(true));
  it("acha pelo ID da própria linha", () => {
    expect(linhaCasaBusca({ id_malote: "DM-2026-0007", descricao: "x" }, "dm-2026-0007")).toBe(true);
  });
  it("acha a despesa que está dentro da fatura, por ID e por descrição", () => {
    expect(linhaCasaBusca(fatura, "dm-2026-0100")).toBe(true);
    expect(linhaCasaBusca(fatura, "da-2026-0525")).toBe(true);
    expect(linhaCasaBusca(fatura, "chatgpt")).toBe(true);
  });
  it("não acha o que não está", () => expect(linhaCasaBusca(fatura, "dm-2026-9999")).toBe(false));
});
