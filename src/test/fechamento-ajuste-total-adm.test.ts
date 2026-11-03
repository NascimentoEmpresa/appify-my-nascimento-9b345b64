import { describe, expect, it } from "vitest";
import type { LigacoesRubrica, LinhaFluxoCusto } from "@/pages/controladoria/faturamento/regras";
import { admPorMesRubrica, detalheAdmForaDaColuna, detalheAdmPorClassificacao, despesaAdmPorContrato, ligacoesDoFechamento } from "@/pages/controladoria/fechamento/regras";

// Ajuste do Total Desp. Adm só no Fechamento: a ligação do Fechamento se sobrepõe à global (Lucratividade) apenas na despesa administrativa.
const l = (o: Partial<LinhaFluxoCusto>): LinhaFluxoCusto => ({
  tipo: "saida", data_pagamento: "2026-01-10", competencia: "2026-01-01", contrato_id: null, classificacao_id: "c-pessoal", classificacao_nome: "SALÁRIO", valor: 100, empresa_id: "HAGG", ...o,
});
const JAN = new Set(["2026-01"]);

describe("ligação do Fechamento sobre a global", () => {
  it("sem ajuste devolve a global; com ajuste, o do Fechamento vence só na classificação ajustada", () => {
    const globais: LigacoesRubrica = new Map([["a", "ferias"], ["b", "va"]]);
    expect(ligacoesDoFechamento(globais, new Map())).toBe(globais);
    expect(ligacoesDoFechamento(undefined, undefined).size).toBe(0);
    const m = ligacoesDoFechamento(globais, new Map([["a", "nao_custo"]]));
    expect(m.get("a")).toBe("nao_custo");
    expect(m.get("b")).toBe("va");
    expect(globais.get("a")).toBe("ferias"); // a global não é alterada
  });
});

describe("Total Desp. Adm com o ajuste do Fechamento", () => {
  const linhas = [
    l({ classificacao_id: "c-sal", classificacao_nome: "SALÁRIO", valor: 1000 }),
    l({ classificacao_id: "c-tarifa", classificacao_nome: "TARIFA BANCÁRIA", valor: 50 }),
    l({ classificacao_id: "c-transf", classificacao_nome: "TRANSFERÊNCIA ENTRE CONTAS", valor: 9000 }),
  ];
  const total = (m: Map<string, Record<string, number>>) => Object.values(m.get("2026-01") ?? {}).reduce((t, v) => t + v, 0);

  it("sem ajuste: transferência fica de fora (não é custo)", () => {
    expect(total(admPorMesRubrica(linhas) as any)).toBe(1050);
  });
  it("remover: classificação marcada fora sai do total", () => {
    const a = ligacoesDoFechamento(undefined, new Map([["c-tarifa", "nao_custo"]]));
    expect(total(admPorMesRubrica(linhas, a) as any)).toBe(1000);
  });
  it("adicionar: classificação que estava fora entra na rubrica escolhida", () => {
    const a = ligacoesDoFechamento(undefined, new Map([["c-transf", "outras"]]));
    const m = admPorMesRubrica(linhas, a).get("2026-01")!;
    expect(m.outras).toBe(9050);
    expect(total(admPorMesRubrica(linhas, a) as any)).toBe(10050);
  });
  it("alterar: muda a rubrica sem mudar o total", () => {
    const a = ligacoesDoFechamento(undefined, new Map([["c-tarifa", "va"]]));
    const m = admPorMesRubrica(linhas, a).get("2026-01")!;
    expect(m.va).toBe(50);
    expect(total(admPorMesRubrica(linhas, a) as any)).toBe(1050);
  });
  it("o detalhe da coluna segue o mesmo ajuste (a soma do modal é o valor da célula)", () => {
    const a = ligacoesDoFechamento(undefined, new Map([["c-transf", "outras"]]));
    const itens = detalheAdmPorClassificacao(linhas, JAN, null, a);
    expect(itens.reduce((t, i) => t + i.valor, 0)).toBe(10050);
  });
});

describe("classificações fora da coluna (de onde se adiciona)", () => {
  const linhas = [
    l({ classificacao_id: "c-sal", classificacao_nome: "SALÁRIO", valor: 1000 }),
    l({ classificacao_id: "c-transf", classificacao_nome: "TRANSFERÊNCIA ENTRE CONTAS", valor: 9000 }),
    l({ classificacao_id: "c-irpj", classificacao_nome: "IRPJ", valor: 700 }),
    l({ classificacao_id: null, classificacao_nome: null, valor: 30 }),
    l({ classificacao_id: "c-outro-mes", classificacao_nome: "EMPRÉSTIMO", valor: 5, data_pagamento: "2026-02-10", competencia: "2026-02-01" }),
    l({ classificacao_id: "c-entrada", classificacao_nome: "RECEBIMENTO", valor: 8, tipo: "entrada" }),
    l({ classificacao_id: "c-hagg", classificacao_nome: "EMPRÉSTIMO", valor: 11, empresa_id: "SN" }),
  ];

  it("Total Desp. Adm: lista o que não é custo; fica de fora o que já está na coluna, IRPJ/CSLL, sem classificação, outro mês e entrada", () => {
    const fora = detalheAdmForaDaColuna(linhas, JAN, null, undefined, null);
    expect(fora.map((i) => i.classificacao).sort()).toEqual(["EMPRÉSTIMO", "TRANSFERÊNCIA ENTRE CONTAS"]);
    expect(fora.find((i) => i.classificacao === "TRANSFERÊNCIA ENTRE CONTAS")?.valor).toBe(9000);
  });
  it("respeita a empresa escolhida", () => {
    expect(detalheAdmForaDaColuna(linhas, JAN, null, undefined, "HAGG").map((i) => i.classificacao)).toEqual(["TRANSFERÊNCIA ENTRE CONTAS"]);
  });
  it("coluna de rubrica: classificação de outra rubrica também aparece como candidata", () => {
    const fora = detalheAdmForaDaColuna([l({ classificacao_id: "c-sal", classificacao_nome: "SALÁRIO", valor: 1000 })], JAN, ["fgts"], undefined, null);
    expect(fora.map((i) => i.classificacao)).toEqual(["SALÁRIO"]);
  });
  it("depois de adicionada, a classificação sai da lista de fora", () => {
    const a = ligacoesDoFechamento(undefined, new Map([["c-transf", "outras"]]));
    expect(detalheAdmForaDaColuna(linhas, JAN, null, a, null).map((i) => i.classificacao)).toEqual(["EMPRÉSTIMO"]);
  });
  it("o ids das classificações vêm no item, para o botão gravar o ajuste", () => {
    expect(detalheAdmForaDaColuna(linhas, JAN, null, undefined, "HAGG")[0].classificacaoIds).toEqual(["c-transf"]);
  });
});

describe("contratos administrativos que compõem a coluna", () => {
  const ADM = new Set(["adm-hagg", "adm-sn"]);
  const linhas = [
    l({ contrato_id: "adm-hagg", classificacao_id: "c-sal", classificacao_nome: "SALÁRIO", valor: 400 }),
    l({ contrato_id: "adm-hagg", classificacao_id: "c-sal", classificacao_nome: "SALÁRIO", valor: 100 }),
    l({ contrato_id: "adm-sn", classificacao_id: "c-sal", classificacao_nome: "SALÁRIO", valor: 300, empresa_id: "SN" }),
    l({ contrato_id: "adm-hagg", classificacao_id: "c-transf", classificacao_nome: "TRANSFERÊNCIA ENTRE CONTAS", valor: 9999 }),
    l({ contrato_id: "cliente-x", classificacao_id: "c-sal", classificacao_nome: "SALÁRIO", valor: 777 }),
    l({ contrato_id: "adm-hagg", classificacao_id: "c-sal", classificacao_nome: "SALÁRIO", valor: 50, competencia: "2026-02-01", data_pagamento: "2026-02-10" }),
  ];

  it("soma por contrato administrativo, só despesa (sem o que não é custo) e só do mês", () => {
    const r = despesaAdmPorContrato(linhas, ADM, JAN, null, undefined, null);
    expect(r).toEqual([
      { id: "adm-hagg", valor: 500, lancamentos: 2 },
      { id: "adm-sn", valor: 300, lancamentos: 1 },
    ]);
  });
  it("filtra por empresa e por rubrica", () => {
    expect(despesaAdmPorContrato(linhas, ADM, JAN, null, undefined, "SN").map((c) => c.id)).toEqual(["adm-sn"]);
    expect(despesaAdmPorContrato(linhas, ADM, JAN, ["va"], undefined, null)).toEqual([]);
    expect(despesaAdmPorContrato(linhas, ADM, JAN, ["salarios"], undefined, null)).toHaveLength(2);
  });
  it("contrato de cliente não entra", () => {
    expect(despesaAdmPorContrato(linhas, ADM, JAN, null, undefined, null).some((c) => c.id === "cliente-x")).toBe(false);
  });
});
