import { describe, expect, it } from "vitest";
import { souLancadorDespesa, classificacaoTemLancadorConfigurado, type MaloteDespesaRow } from "@/hooks/useMaloteDespesa";

// SIS-2026-0340 (Iury): "caso o item esteja com cotação aprovada, seja
// possível a gente definir quem vai lançar essa despesa no malote e não o
// solicitante como está hoje" — array vazio/undefined preserva o
// comportamento de sempre (solicitante lança); preenchido é SUBSTITUIÇÃO.
function despesaComLancadores(ids: string[] | undefined): MaloteDespesaRow {
  return {
    classificacao: { id: "c1", nome: "Classificação Teste", lancador_despesa_user_ids: ids },
  } as unknown as MaloteDespesaRow;
}

describe("souLancadorDespesa", () => {
  it("retorna true quando o userId está no array de lançadores", () => {
    expect(souLancadorDespesa(despesaComLancadores(["u1", "u2"]), "u2")).toBe(true);
  });

  it("retorna false quando o userId não está no array", () => {
    expect(souLancadorDespesa(despesaComLancadores(["u1", "u2"]), "u3")).toBe(false);
  });

  it("retorna false quando o array está vazio (ninguém configurado)", () => {
    expect(souLancadorDespesa(despesaComLancadores([]), "u1")).toBe(false);
  });

  it("retorna false quando o campo é undefined (classificação nunca configurada)", () => {
    expect(souLancadorDespesa(despesaComLancadores(undefined), "u1")).toBe(false);
  });

  it("retorna false sem userId (usuário deslogado/indefinido)", () => {
    expect(souLancadorDespesa(despesaComLancadores(["u1"]), null)).toBe(false);
    expect(souLancadorDespesa(despesaComLancadores(["u1"]), undefined)).toBe(false);
  });

  it("retorna false quando a despesa não tem classificação carregada", () => {
    const despesa = {} as MaloteDespesaRow;
    expect(souLancadorDespesa(despesa, "u1")).toBe(false);
  });
});

describe("classificacaoTemLancadorConfigurado", () => {
  it("true quando há pelo menos um lançador configurado", () => {
    expect(classificacaoTemLancadorConfigurado(despesaComLancadores(["u1"]))).toBe(true);
  });

  it("false quando o array está vazio — comportamento de hoje (solicitante lança)", () => {
    expect(classificacaoTemLancadorConfigurado(despesaComLancadores([]))).toBe(false);
  });

  it("false quando o campo é undefined", () => {
    expect(classificacaoTemLancadorConfigurado(despesaComLancadores(undefined))).toBe(false);
  });
});
