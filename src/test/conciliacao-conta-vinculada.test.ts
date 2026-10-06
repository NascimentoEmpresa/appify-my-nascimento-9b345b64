import { describe, expect, it } from "vitest";
import { ignoraNaConciliacao, linhasFluxoParaPlanilhaRow } from "@/hooks/useConciliacaoFluxoCaixa";

const l = (tipo: "entrada" | "saida", descricao: string) =>
  ({ tipo, descricao, valor: 10, data_pagamento: "2026-01-12", banco_nome: "BB", despesa_id: "d", numero_parcela: null, origem: "importacao_historica", empresa_nome: "X" }) as any;

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
    const r = linhasFluxoParaPlanilhaRow([l("saida", "RESGATE CONTA VINCULADA"), l("entrada", "RECEBIMENTO DE NOTA - CONTA VINCULADA"), l("saida", "SALÁRIO")]);
    expect(r.map((x) => x.tipo)).toEqual(["ENTRADA", "SAÍDA"]);
  });
});
