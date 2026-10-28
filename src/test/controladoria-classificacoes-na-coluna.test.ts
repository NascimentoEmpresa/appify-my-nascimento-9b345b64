// SIS-2026-0755 (passo das rubricas): os modais mostram as classificações que compõem a coluna, com o id para trocar a rubrica de cada uma.
import { describe, expect, it } from "vitest";
import { montarComposicao, type ContextoDetalhe, type EscopoDetalhe } from "@/pages/controladoria/faturamento/composicao";
import type { LigacoesRubrica, LinhaFluxoCusto } from "@/pages/controladoria/faturamento/regras";
import { detalheAdmPorClassificacao } from "@/pages/controladoria/fechamento/regras";

const linha = (classificacao_id: string | null, classificacao_nome: string | null, valor: number, contrato_id: string | null = "c1"): LinhaFluxoCusto =>
  ({ tipo: "saida", data_pagamento: "2026-01-10", contrato_id, classificacao_id, classificacao_nome, valor });

const ctx = (custos: LinhaFluxoCusto[], ligacoes?: LigacoesRubrica): ContextoDetalhe => ({
  contratoNome: (id) => `Contrato ${id}`,
  execDe: () => ({ valor: 0, fonte: "sem_valor" }),
  custos,
  ligacoes,
});
const escopo: EscopoDetalhe = { titulo: "jan/26", nfs: [], meses: ["2026-01"], contratoIds: ["c1"] };

describe("Faturamento: classificações que compõem a coluna Despesas", () => {
  it("agrupa por classificação (com o id), somando valor e lançamentos, do maior para o menor", () => {
    const c = montarComposicao("despesas", escopo, ctx([linha("k1", "SALARIO", 100), linha("k1", "SALARIO", 50), linha("k2", "UNIFORME", 300)]));
    expect(c.classificacoesNaColuna).toEqual([
      { id: "k2", nome: "UNIFORME", valor: 300, lancamentos: 1 },
      { id: "k1", nome: "SALARIO", valor: 150, lancamentos: 2 },
    ]);
  });

  it("classificação marcada como 'Não é custo' sai da lista (e da coluna)", () => {
    const ligacoes: LigacoesRubrica = new Map([["k2", "nao_custo"]]);
    const c = montarComposicao("despesas", escopo, ctx([linha("k1", "SALARIO", 100), linha("k2", "UNIFORME", 300)], ligacoes));
    expect(c.classificacoesNaColuna?.map((x) => x.id)).toEqual(["k1"]);
    expect(c.conta.find((l) => l.rotulo === "Despesas")?.valor).toBe(100);
  });

  it("ligar a classificação a outra rubrica move o valor de uma linha da conta para a outra", () => {
    const sem = montarComposicao("despesas", escopo, ctx([linha("k2", "UNIFORME", 300)]));
    expect(sem.conta.find((l) => l.rotulo === "Outras Despesas")?.valor).toBe(300);
    const com = montarComposicao("despesas", escopo, ctx([linha("k2", "UNIFORME", 300)], new Map([["k2", "salarios"]])));
    expect(com.conta.find((l) => l.rotulo === "Salários")?.valor).toBe(300);
  });
});

describe("Fechamento: item do detalhe por classificação carrega o id", () => {
  it("devolve o id da classificação para o modal trocar a rubrica", () => {
    const jan = new Set(["2026-01"]);
    const itens = detalheAdmPorClassificacao([linha("k1", "Luz", 10, null), linha("k1", "Luz", 5, null), linha(null, null, 7, null)], jan, null);
    // lançamento sem classificação não é custo de rubrica nenhuma (fica fora da coluna), então não aparece aqui
    expect(itens.map((i) => [i.classificacaoId, i.classificacao, i.valor])).toEqual([["k1", "Luz", 15]]);
  });
});
