import { describe, expect, it } from "vitest";
import { contratoConfiguravel, saiDasDespesas, tratamentoEfetivo, tratamentoPadraoPorNome } from "@/pages/controladoria/faturamento/tratamentoContrato";

// V1 da configuração (continuação do SIS-2026-0755): a exceção gravada manda; sem exceção vale a regra pelo nome de sempre.
describe("tratamento do contrato nos relatórios", () => {
  it("sem exceção, o padrão pelo nome reproduz a regra de antes", () => {
    expect(tratamentoPadraoPorNome("ESTOQUE HAGG")).toBe("fora_das_despesas");
    expect(tratamentoPadraoPorNome("MOVIMENTAÇÃO FINANCEIRA - SN")).toBe("fora_das_despesas");
    expect(tratamentoPadraoPorNome("INVESTIMENTOS AGPS")).toBe("investimento");
    expect(tratamentoPadraoPorNome("UFRGS - LIMPEZA GERAL - 047/2022")).toBe("normal");
    expect(tratamentoPadraoPorNome(null)).toBe("normal");
  });

  it("a exceção configurada vale mais que o nome, nos dois sentidos", () => {
    // contrato "ESTOQUE …" que na verdade é de cliente
    expect(tratamentoEfetivo("ESTOQUE HAGG", "normal")).toBe("normal");
    // contrato comum que passou a ser investimento
    expect(tratamentoEfetivo("OBRAS ADM - SN", "investimento")).toBe("investimento");
    // sem exceção, o padrão
    expect(tratamentoEfetivo("ESTOQUE SN", null)).toBe("fora_das_despesas");
    expect(tratamentoEfetivo("ESTOQUE SN", undefined)).toBe("fora_das_despesas");
  });

  it("sai das despesas: fora e investimento; no Fechamento o investimento é mantido para a coluna própria", () => {
    expect(saiDasDespesas("normal")).toBe(false);
    expect(saiDasDespesas("fora_das_despesas")).toBe(true);
    expect(saiDasDespesas("investimento")).toBe(true);
    expect(saiDasDespesas("investimento", { manterInvestimentos: true })).toBe(false);
    expect(saiDasDespesas("fora_das_despesas", { manterInvestimentos: true })).toBe(true);
  });

  it("administrativo e sócios têm regra própria e não entram na configuração", () => {
    expect(contratoConfiguravel("ADMINISTRATIVO - HAGG")).toBe(false);
    expect(contratoConfiguravel("ADMINISTRATIVO SÓCIOS - HELENA")).toBe(false);
    expect(contratoConfiguravel("ESTOQUE HAGG")).toBe(true);
    expect(contratoConfiguravel("UFFS PASSO FUNDO - 041/2021")).toBe(true);
  });
});
