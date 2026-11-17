import { describe, expect, it } from "vitest";
import { custosVazios, type LigacoesRubrica, type LinhaFluxoCusto } from "@/pages/controladoria/faturamento/regras";
import { catalogoDeEntradas, detalheReceitasExtras, montarFechamento, receitaExtraConta, receitasExtrasPorMes, receitasForaDaColuna, receitasForaDaColunaComCatalogo, totalDoFechamento } from "@/pages/controladoria/fechamento/regras";
import { linkFluxoDoRecorte } from "@/pages/controladoria/fechamento/linkFluxo";

// SIS-2026-0793: Receitas Extras = entradas dos administrativos; Resultado após Outras Receitas = Resultado Operacional + Receitas Extras.
const e = (o: Partial<LinhaFluxoCusto>): LinhaFluxoCusto => ({
  tipo: "entrada", data_pagamento: "2026-01-10", competencia: "2026-01-01", contrato_id: null, classificacao_id: "c-aluguel", classificacao_nome: "ALUGUEL", valor: 100, empresa_id: "HAGG", ...o,
});
const JAN = new Set(["2026-01"]);

describe("o que conta como receita extra (padrão)", () => {
  it("entrada comum conta; saída não", () => {
    expect(receitaExtraConta(e({}))).toBe(true);
    expect(receitaExtraConta(e({ tipo: "saida" }))).toBe(false);
  });
  it("o que não é receita fica de fora: transferência, aplicação, resgate, empréstimo, financiamento", () => {
    for (const nome of ["TRANSFERÊNCIA ENTRE CONTAS", "APLICAÇÃO FINANCEIRA", "RESGATE DE APLICAÇÃO", "EMPRÉSTIMOS", "FINANCIAMENTOS"]) {
      expect(receitaExtraConta(e({ classificacao_nome: nome })), nome).toBe(false);
    }
  });
  it("marcada 'Não é custo' na Lucratividade também não conta", () => {
    const lig: LigacoesRubrica = new Map([["c-aluguel", "nao_custo"]]);
    expect(receitaExtraConta(e({}), lig)).toBe(false);
  });
  it("sem classificação conta ('todas as entradas')", () => {
    expect(receitaExtraConta(e({ classificacao_id: null, classificacao_nome: null }))).toBe(true);
  });
  it("o ajuste do Fechamento vence o padrão, nos dois sentidos", () => {
    expect(receitaExtraConta(e({ classificacao_id: "c-transf", classificacao_nome: "TRANSFERÊNCIA ENTRE CONTAS" }), undefined, new Map([["c-transf", true]]))).toBe(true);
    expect(receitaExtraConta(e({}), undefined, new Map([["c-aluguel", false]]))).toBe(false);
  });
});

describe("receitas extras por mês e detalhamento", () => {
  const linhas = [
    e({ valor: 20000 }),
    e({ classificacao_id: "c-transf", classificacao_nome: "TRANSFERÊNCIA ENTRE CONTAS", valor: 9000 }),
    e({ classificacao_id: "c-cash", classificacao_nome: "CASHBACK", valor: 300 }),
    e({ valor: 777, data_pagamento: "2026-02-10", competencia: "2026-02-01" }),
    e({ valor: 55, empresa_id: "SN" }),
    e({ tipo: "saida", valor: 4000 }),
  ];

  it("soma por mês só o que conta, sem saída nem transferência", () => {
    const m = receitasExtrasPorMes(linhas);
    expect(m.get("2026-01")).toBe(20355);
    expect(m.get("2026-02")).toBe(777);
  });
  it("respeita a empresa escolhida", () => {
    expect(receitasExtrasPorMes(linhas, undefined, undefined, "HAGG").get("2026-01")).toBe(20300);
  });
  it("o detalhe soma o mesmo valor da coluna, e o que está fora é o restante das entradas", () => {
    const dentro = detalheReceitasExtras(linhas, JAN);
    const fora = receitasForaDaColuna(linhas, JAN);
    expect(dentro.reduce((t, i) => t + i.valor, 0)).toBe(receitasExtrasPorMes(linhas).get("2026-01"));
    expect(fora.map((i) => i.classificacao)).toEqual(["TRANSFERÊNCIA ENTRE CONTAS"]);
    expect(dentro.reduce((t, i) => t + i.valor, 0) + fora.reduce((t, i) => t + i.valor, 0)).toBe(29355);
  });
  it("adicionar traz a classificação para a coluna; tirar leva para fora", () => {
    const a = new Map([["c-transf", true], ["c-cash", false]]);
    expect(detalheReceitasExtras(linhas, JAN, undefined, a).map((i) => i.classificacao).sort()).toEqual(["ALUGUEL", "TRANSFERÊNCIA ENTRE CONTAS"]);
    expect(receitasForaDaColuna(linhas, JAN, undefined, a).map((i) => i.classificacao)).toEqual(["CASHBACK"]);
  });
});

describe("Resultado após Outras Receitas no Fechamento", () => {
  const base = (receitas: Map<string, number>, mesAtual = "2026-01", meses = ["2026-01"]) => {
    const adm = custosVazios();
    adm.outras = 113830.51;
    const socios = new Map<string, Map<string, number>>([
      ["Antonio", new Map([["2026-01", 41327.29]])], ["Carlos Eduardo", new Map([["2026-01", 24310.97]])], ["Guiomar", new Map([["2026-01", 40487.61]])],
      ["Helena", new Map([["2026-01", 48551.62]])], ["Senilton", new Map([["2026-01", 12939.01]])], ["Investimentos", new Map([["2026-01", 123145.03]])], ["Obras Adm", new Map([["2026-01", 2200]])],
    ]);
    return montarFechamento({
      meses, mesAtual,
      liquidoPorMes: new Map([["2026-01", 1_000_000]]), executavelPorMes: new Map(), custosContratoPorMes: new Map([["2026-01", 400_000]]),
      admPorMes: new Map([["2026-01", adm]]), sociosPorMes: socios, receitasExtrasPorMes: receitas,
    });
  };

  it("confere o exemplo do chamado (jan/26)", () => {
    const [jan] = base(new Map([["2026-01", 20000]]));
    expect(jan.resultado).toBe(486169.49);
    expect(jan.receitasExtras).toBe(20000);
    expect(jan.resultadoAposOutrasReceitas).toBe(506169.49);
    expect(jan.lucroLiquido).toBe(213207.96); // Resultado Gerencial após Ajustes
    expect(jan.resultadoGerencialLiquido).toBe(213207.96); // sem tributos
  });
  it("sem receitas extras nada muda: o Resultado Operacional segue o mesmo e o gerencial é o de antes", () => {
    const [jan] = base(new Map());
    expect(jan.receitasExtras).toBe(0);
    expect(jan.resultadoAposOutrasReceitas).toBe(jan.resultado);
    expect(jan.lucroLiquido).toBe(193207.96);
  });
  it("o Resultado Operacional não inclui as receitas extras", () => {
    expect(base(new Map([["2026-01", 20000]]))[0].resultado).toBe(base(new Map())[0].resultado);
  });
  it("mês projetado: só o lançado, sem média dos meses anteriores", () => {
    const linhas = base(new Map([["2026-01", 20000]]), "2026-01", ["2026-01", "2026-02"]);
    expect(linhas[1].projetado).toBe(true);
    expect(linhas[1].receitasExtras).toBe(0);
    const comLancado = base(new Map([["2026-01", 20000], ["2026-02", 5000]]), "2026-01", ["2026-01", "2026-02"]);
    expect(comLancado[1].receitasExtras).toBe(5000);
  });
  it("o total soma as receitas e refaz o resultado após outras receitas", () => {
    const t = totalDoFechamento(base(new Map([["2026-01", 20000]])));
    expect(t.receitasExtras).toBe(20000);
    expect(t.resultadoAposOutrasReceitas).toBe(506169.49);
    expect(t.lucroLiquido).toBe(213207.96);
  });
});

describe("Ver todos das receitas abre o Fluxo nas entradas", () => {
  it("tipo entrada no link; saída continua o padrão", () => {
    const r = { base: "competencia" as const, meses: ["2026-01"], classificacaoIds: ["c1"], contratoIds: [], semContrato: true };
    expect(linkFluxoDoRecorte({ ...r, tipo: "entrada" })).toContain("tipo=entrada");
    expect(linkFluxoDoRecorte(r)).toContain("tipo=saida");
  });
});

// SIS-2026-0836: a lista de baixo traz todas as classificações que ainda não contam, não só as com entrada no período.
describe("entradas fora da coluna com o catálogo", () => {
  const catalogo = [
    { id: "c-cash", nome: "CASHBACK", ativo: true },
    { id: "c-transf", nome: "TRANSFERÊNCIA ENTRE CONTAS", ativo: true },
    { id: "c-velha", nome: "RESGATE ANTIGO", ativo: false },
    { id: "c-aluguel", nome: "ALUGUEL", ativo: true },
  ];
  const lig: LigacoesRubrica = new Map([["c-cash", "nao_custo"], ["c-transf", "nao_custo"], ["c-velha", "nao_custo"]]);
  const linhas = [e({ classificacao_id: "c-transf", classificacao_nome: "TRANSFERÊNCIA ENTRE CONTAS", valor: 9000 })];

  it("o que tem entrada no período vem com valor e o resto do catálogo vem zerado, para poder adicionar", () => {
    const r = receitasForaDaColunaComCatalogo(linhas, JAN, lig, undefined, undefined, catalogo);
    // SIS-2026-0932: ALUGUEL (sem lançamento) agora aparece, marcado como já contando pelo padrão.
    expect(r.map((i) => [i.classificacao, i.valor, i.contaSemMovimento])).toEqual([["TRANSFERÊNCIA ENTRE CONTAS", 9000, undefined], ["ALUGUEL", 0, "padrao"], ["CASHBACK", 0, undefined]]);
    expect(r[2].classificacaoIds).toEqual(["c-cash"]);
  });
  it("não repete a que já aparece com movimento, nem traz inativa, nem a que já está na coluna em cima", () => {
    const r = receitasForaDaColunaComCatalogo(linhas, JAN, lig, undefined, undefined, catalogo);
    expect(r.filter((i) => i.classificacao === "TRANSFERÊNCIA ENTRE CONTAS")).toHaveLength(1);
    expect(r.some((i) => i.classificacao === "RESGATE ANTIGO")).toBe(false);
    const comAluguel = [...linhas, e({})];   // ALUGUEL com lançamento: está na coluna, não se repete embaixo
    expect(receitasForaDaColunaComCatalogo(comAluguel, JAN, lig, undefined, undefined, catalogo).some((i) => i.classificacao === "ALUGUEL")).toBe(false);
  });
  it("depois de adicionada (ajuste = conta), sem lançamento no período, continua na lista marcada como ajustada", () => {
    const r = receitasForaDaColunaComCatalogo(linhas, JAN, lig, new Map([["c-cash", true]]), undefined, catalogo);
    expect(r.find((i) => i.classificacao === "CASHBACK")?.contaSemMovimento).toBe("ajuste");
  });
});

// SIS-2026-0932: a lista "Entradas fora desta coluna" usa o Fluxo de Caixa como referência (toda classificação de entrada), sem incluir nada sozinha.
describe("catálogo das entradas pelo Fluxo de Caixa", () => {
  const cadastro = [
    { id: "c-cash", nome: "CASHBACK", ativo: true },
    { id: "c-velha", nome: "RESGATE ANTIGO", ativo: false },
  ];
  // entradas do ano em qualquer contrato (não só os administrativos), como o filtro do Fluxo com Tipo = Entrada
  const entradasDoFluxo = [
    e({ contrato_id: "ct-cliente", classificacao_id: "c-acao", classificacao_nome: "AÇÃO TRABALHISTA" }),
    e({ contrato_id: "ct-cliente", classificacao_id: "c-acao", classificacao_nome: "AÇÃO TRABALHISTA" }),
    e({ classificacao_id: "c-cash", classificacao_nome: "CASHBACK" }),
    e({ tipo: "saida", classificacao_id: "c-so-saida", classificacao_nome: "SÓ SAÍDA" }),
    e({ classificacao_id: null, classificacao_nome: null }),
  ];

  it("traz toda classificação que aparece numa entrada do Fluxo, mais o cadastro ativo, sem repetir", () => {
    const cat = catalogoDeEntradas(cadastro, entradasDoFluxo);
    expect(cat.map((c) => c.nome).sort()).toEqual(["AÇÃO TRABALHISTA", "CASHBACK"]);
  });
  it("classificação só de saída, inativa sem lançamento e entrada sem classificação não entram", () => {
    const nomes = catalogoDeEntradas(cadastro, entradasDoFluxo).map((c) => c.nome);
    expect(nomes).not.toContain("SÓ SAÍDA");
    expect(nomes).not.toContain("RESGATE ANTIGO");
  });
  it("classificação de entrada que só existe no Fluxo (fora do cadastro) pode ser adicionada, mas não conta sozinha", () => {
    const cat = catalogoDeEntradas([], [e({ contrato_id: "ct-cliente", classificacao_id: "c-apl", classificacao_nome: "Aplicação Financeira" })]);
    const fora = receitasForaDaColunaComCatalogo([], JAN, undefined, undefined, undefined, cat);
    expect(fora.map((i) => [i.classificacao, i.classificacaoIds, i.valor])).toEqual([["Aplicação Financeira", ["c-apl"], 0]]);
    expect(receitasExtrasPorMes([], undefined, undefined).size).toBe(0);
  });
  it("o mesmo nome com dois ids vira uma linha só, e adicionar pega os dois", () => {
    const cat = catalogoDeEntradas([{ id: "c-tr1", nome: "TRANSFERÊNCIA ENTRE CONTAS", ativo: true }], [e({ classificacao_id: "c-tr2", classificacao_nome: "Transferência entre contas" })]);
    const fora = receitasForaDaColunaComCatalogo([], JAN, undefined, undefined, undefined, cat);
    expect(fora).toHaveLength(1);
    expect(fora[0].classificacaoIds.sort()).toEqual(["c-tr1", "c-tr2"]);
  });
  it("estar na lista não muda a coluna: só o ajuste salvo traz a classificação", () => {
    const linhas = [e({ classificacao_id: "c-apl", classificacao_nome: "APLICAÇÃO FINANCEIRA", valor: 500 })];
    expect(receitasExtrasPorMes(linhas).get("2026-01") ?? 0).toBe(0);
    expect(receitasExtrasPorMes(linhas, undefined, new Map([["c-apl", true]])).get("2026-01")).toBe(500);
  });
});
