import { describe, expect, it } from "vitest";
import { ignoraNaConciliacao, linhasFluxoParaPlanilhaRow } from "@/hooks/useConciliacaoFluxoCaixa";

const l = (tipo: "entrada" | "saida", descricao: string, extra: Record<string, unknown> = {}) =>
  ({ tipo, descricao, valor: 10, data_pagamento: "2026-01-12", banco_nome: "BB", despesa_id: "d", numero_parcela: null, origem: "importacao_historica", empresa_nome: "X", ...extra }) as any;

describe("conciliação: conta vinculada", () => {
  it("ignora SAÍDA com CONTA VINCULADA na descrição (qualquer caixa)", () => {
    expect(ignoraNaConciliacao(l("saida", "RESGATE CONTA VINCULADA"))).toBe(true);
    expect(ignoraNaConciliacao(l("saida", "Embrapa - conta vinculada"))).toBe(true);
  });
  it("entrada de conta vinculada e saída comum continuam", () => {
    expect(ignoraNaConciliacao(l("entrada", "RECEBIMENTO DE NOTA - CONTA VINCULADA"))).toBe(false);
    expect(ignoraNaConciliacao(l("saida", "SALÁRIO"))).toBe(false);
  });
  it("o adaptador tira só as ignoradas", () => {
    const r = linhasFluxoParaPlanilhaRow([l("saida", "RESGATE CONTA VINCULADA"), l("entrada", "RECEBIMENTO DE NOTA - CONTA VINCULADA", { despesa_id: "e" }), l("saida", "SALÁRIO", { despesa_id: "f" })]);
    expect(r.map((x) => x.tipo)).toEqual(["ENTRADA", "SAÍDA"]);
  });

  // SIS-2026-0637
  it("resgate de conta vinculada lançado como ENTRADA no Banco do Brasil e na Caixa também fica de fora", () => {
    expect(ignoraNaConciliacao(l("entrada", "RESGATE CONTA VINCULADA", { banco_nome: "Banco do Brasil" }))).toBe(true);
    expect(ignoraNaConciliacao(l("entrada", "BENTO ADM - RESGATE CONTA VINCULADA", { banco_nome: "Caixa Econômica Federal" }))).toBe(true);
    expect(ignoraNaConciliacao(l("entrada", "RESGATE CONTA VINCULADA (REVISAR CONTRATO)", { banco_nome: "Caixa Econ�mica Federal" }))).toBe(true);
  });
  it("no Banrisul o resgate é dinheiro que cai na conta: continua na conciliação", () => {
    expect(ignoraNaConciliacao(l("entrada", "RESGATE CONTA VINCULADA", { banco_nome: "Banrisul" }))).toBe(false);
  });
  it("saldo anterior de conta vinculada nunca é ignorado", () => {
    expect(ignoraNaConciliacao(l("entrada", "AJUSTES DE CONTAS - CONTA VINCULADA", { banco_nome: "Banco do Brasil", classificacao_nome: "SALDO ANTERIOR" }))).toBe(false);
  });
});

describe("conciliação: rateio entra pelo total (SIS-2026-0637)", () => {
  const rateio = (valor: number, extra: Record<string, unknown> = {}) =>
    l("saida", "FGTS MENSAL HAGG", { valor, despesa_id: "rh-60", banco_nome: "Banrisul", ...extra });

  it("junta as linhas rateadas da mesma despesa num valor só", () => {
    const r = linhasFluxoParaPlanilhaRow([rateio(439.15), rateio(1863.02), rateio(530630.96)]);
    expect(r).toHaveLength(1);
    expect(r[0].valor).toBe(532933.13);
    expect(r[0].despesaId).toBe("rh-60");
  });
  it("não junta parcelas, dias, bancos, tipos ou despesas diferentes", () => {
    const r = linhasFluxoParaPlanilhaRow([
      rateio(10, { numero_parcela: 1 }),
      rateio(10, { numero_parcela: 2 }),
      rateio(10, { data_pagamento: "2026-01-13" }),
      rateio(10, { banco_nome: "Sicredi" }),
      rateio(10, { despesa_id: "outra" }),
    ]);
    expect(r).toHaveLength(5);
  });
  it("lançamento sem despesa_id não é agrupado", () => {
    const r = linhasFluxoParaPlanilhaRow([rateio(5, { despesa_id: null }), rateio(5, { despesa_id: null })]);
    expect(r).toHaveLength(2);
  });
});
