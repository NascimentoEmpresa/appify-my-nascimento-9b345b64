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

  // SIS-2026-0927: vários IDs separados por vírgula
  it("vírgula: casa com qualquer um dos termos", () => {
    const a = { id_malote: "DM-2026-2845", descricao: "FGTS" };
    const b = { id_malote: "DM-2026-2846", descricao: "CONSIGNADO" };
    const c = { id_malote: "DM-2026-9999", descricao: "OUTRA" };
    const termo = "dm-2026-2845, dm-2026-2846";
    expect(linhaCasaBusca(a, termo)).toBe(true);
    expect(linhaCasaBusca(b, termo)).toBe(true);
    expect(linhaCasaBusca(c, termo)).toBe(false);
    expect(linhaCasaBusca(c, "dm-2026-2845,")).toBe(false);
    expect(linhaCasaBusca(c, ",")).toBe(true);
  });
});
