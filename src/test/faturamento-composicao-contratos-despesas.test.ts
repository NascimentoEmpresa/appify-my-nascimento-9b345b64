// SIS-2026-0755: o modal da coluna Despesas mostra os contratos que compõem o valor e os que ficam fora, para o usuário ajustar o tratamento ali mesmo.
import { describe, expect, it } from "vitest";
import { montarComposicao, type ContextoDetalhe, type EscopoDetalhe } from "@/pages/controladoria/faturamento/composicao";
import type { LinhaFluxoCusto } from "@/pages/controladoria/faturamento/regras";
import type { TratamentosContrato } from "@/pages/controladoria/faturamento/tratamentoContrato";

const nomes: Record<string, string> = {
  c1: "UFRGS - LIMPEZA GERAL - 047/2022",
  c2: "ADMINISTRATIVO - HAGG",
  c3: "ESTOQUE HAGG",
  c4: "OBRAS ADM - SN",
  c5: "INVESTIMENTOS AGPS",
};

const custo = (contrato_id: string, valor: number): LinhaFluxoCusto =>
  ({ tipo: "saida", data_pagamento: "2026-01-10", contrato_id, classificacao_id: null, classificacao_nome: "SALARIO", valor });

const ctx = (custos: LinhaFluxoCusto[], tratamentos?: TratamentosContrato): ContextoDetalhe => ({
  contratoNome: (id) => nomes[id] ?? id,
  execDe: () => ({ valor: 0, fonte: "sem_valor" }),
  custos,
  tratamentos,
});

const escopo = (contratoIds: string[]): EscopoDetalhe => ({ titulo: "jan/26", nfs: [], meses: ["2026-01"], contratoIds });

describe("modal Despesas: contratos dentro e fora da coluna", () => {
  it("lista os contratos que compõem o valor, do maior para o menor, e marca o que dá para configurar", () => {
    const c = montarComposicao("despesas", escopo(["c1", "c2", "c4"]), ctx([custo("c1", 100), custo("c4", 300), custo("c2", 50), custo("c1", 20)]));
    expect(c.contratosNaColuna?.map((x) => [x.nome, x.valor, x.configuravel])).toEqual([
      ["OBRAS ADM - SN", 300, true],
      ["UFRGS - LIMPEZA GERAL - 047/2022", 120, true],
      ["ADMINISTRATIVO - HAGG", 50, false], // administrativo tem regra própria
    ]);
  });

  it("sem exceção, os contratos tirados pelo nome aparecem em 'fora', marcados como padrão", () => {
    const c = montarComposicao("despesas", escopo(["c1", "c3", "c5"]), ctx([custo("c1", 100)]));
    expect(c.contratosForaDaColuna?.map((x) => [x.nome, x.tratamento, x.origem])).toEqual([
      ["ESTOQUE HAGG", "fora_das_despesas", "padrao"],
      ["INVESTIMENTOS AGPS", "investimento", "padrao"],
    ]);
  });

  it("a exceção configurada aparece como 'configurado'; contrato comum marcado 'normal' sai da lista de fora", () => {
    const tratamentos: TratamentosContrato = new Map([["c4", "fora_das_despesas"], ["c3", "normal"]]);
    const c = montarComposicao("despesas", escopo(["c3", "c4"]), ctx([], tratamentos));
    expect(c.contratosForaDaColuna?.map((x) => [x.nome, x.origem])).toEqual([["OBRAS ADM - SN", "configurado"]]);
  });

  it("administrativo nunca aparece na lista de fora (não é configurável)", () => {
    const tratamentos: TratamentosContrato = new Map([["c2", "fora_das_despesas"]]);
    expect(montarComposicao("despesas", escopo(["c2"]), ctx([], tratamentos)).contratosForaDaColuna).toEqual([]);
  });

  it("a conta do modal (total das despesas) não muda", () => {
    const c = montarComposicao("despesas", escopo(["c1"]), ctx([custo("c1", 100), custo("c1", 50)]));
    expect(c.conta.find((l) => l.rotulo === "Despesas")?.valor).toBe(150);
  });
});
