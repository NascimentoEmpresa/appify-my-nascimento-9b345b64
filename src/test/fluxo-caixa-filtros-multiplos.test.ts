// SIS-2026-0725: os filtros do Fluxo de Caixa aceitam mais de um item.
import { describe, expect, it } from "vitest";
import { FILTRO_SEM_VALOR, casaSelecao, classificacoesDoTipo, contratosDasEmpresas, manterSelecionadasDisponiveis, nomesSelecionados, opcoesDe } from "@/pages/financeiro/fluxo-caixa/filtrosMultiplos";
import { filtrarPorSituacaoFluxo } from "@/pages/financeiro/fluxo-caixa/abasFluxo";
import { linhasDoExport } from "@/pages/financeiro/fluxo-caixa/exportRateio";

describe("casaSelecao", () => {
  const linha = { contrato_id: "c1", contrato_nome: "ALFA" };
  const semContrato = { contrato_id: null, contrato_nome: null };
  const casa = (l: typeof linha | typeof semContrato, sel: string[]) => casaSelecao(sel, !!l.contrato_nome, (id) => l.contrato_id === id);

  it("sem seleção, tudo passa", () => {
    expect(casa(linha, [])).toBe(true);
    expect(casa(semContrato, [])).toBe(true);
  });

  it("com vários itens, basta casar com um deles", () => {
    expect(casa(linha, ["c9", "c1"])).toBe(true);
    expect(casa(linha, ["c8", "c9"])).toBe(false);
  });

  it("'Sem …' junto com outros itens traz as linhas sem valor e as dos itens escolhidos", () => {
    expect(casa(semContrato, [FILTRO_SEM_VALOR, "c1"])).toBe(true);
    expect(casa(linha, [FILTRO_SEM_VALOR, "c1"])).toBe(true);
    expect(casa(linha, [FILTRO_SEM_VALOR])).toBe(false);
    expect(casa(semContrato, ["c1"])).toBe(false);
  });
});

describe("situação com mais de uma opção", () => {
  const hoje = "2026-10-28";
  const base = { tipo: "saida", valor: 1, forma_pagamento: null, situacao_base: "previsto" } as any;
  const linhas = [
    { ...base, id: "venc", data_pagamento: "2026-10-01" },
    { ...base, id: "aven", data_pagamento: "2026-10-30" },
    { ...base, id: "prev", data_pagamento: "2026-12-01" },
    { ...base, id: "canc", data_pagamento: "2026-12-01", situacao_base: "cancelado" },
  ];
  const ids = (r: any[]) => r.map((x) => x.id);

  it("junta as situações escolhidas", () => {
    expect(ids(filtrarPorSituacaoFluxo(linhas, ["vencido", "a_vencer"], hoje))).toEqual(["venc", "aven"]);
  });

  it("lista vazia mantém o comportamento antigo (tudo, menos canceladas) e a forma de texto único segue valendo", () => {
    expect(ids(filtrarPorSituacaoFluxo(linhas, [], hoje))).not.toContain("canc");
    expect(ids(filtrarPorSituacaoFluxo(linhas, "cancelado", hoje))).toEqual(["canc"]);
  });
});

describe("exportação com mais de um contrato", () => {
  const rateio = {
    valor: "100", contrato_id: null, contrato_nome: "Rateio", descricao: "x",
    rateioDetalhe: [{ id: "c1", nome: "ALFA", valor: 40 }, { id: "c2", nome: "BETA", valor: 35 }, { id: "c3", nome: "GAMA", valor: 25 }],
  };

  it("fica só com as cotas dos contratos escolhidos", () => {
    expect(linhasDoExport(rateio, ["c1", "c3"]).map((x) => x.contrato)).toEqual(["ALFA", "GAMA"]);
  });

  it("lista vazia mantém todas as cotas", () => {
    expect(linhasDoExport(rateio, []).length).toBe(3);
  });
});

describe("resumo e opções", () => {
  const lista: [string, string][] = [["e1", "HAGG"], ["e2", "AGPS"]];
  it("nomes escolhidos, na ordem da seleção", () => {
    expect(nomesSelecionados(lista, [], "Todas")).toBe("Todas");
    expect(nomesSelecionados(lista, ["e2", FILTRO_SEM_VALOR], "Todas")).toBe("AGPS, Sem (—)");
  });
  it("a opção 'Sem' vem antes das demais", () => {
    expect(opcoesDe(lista, "Sem contrato (—)")[0]).toEqual({ value: FILTRO_SEM_VALOR, label: "Sem contrato (—)" });
    expect(opcoesDe(lista)).toHaveLength(2);
  });
});

describe("classificação acompanha o filtro Tipo", () => {
  const linhas = [
    { tipo: "entrada", classificacao_id: "rec", classificacao_nome: "RECEBIMENTO DE NOTA" },
    { tipo: "entrada", classificacao_id: "transf", classificacao_nome: "TRANSFERÊNCIA ENTRE CONTAS" },
    { tipo: "saida", classificacao_id: "assid", classificacao_nome: "ADD ASSIDUIDADE" },
    { tipo: "saida", classificacao_id: "transf", classificacao_nome: "TRANSFERÊNCIA ENTRE CONTAS" },
    { tipo: "saida", classificacao_id: null, classificacao_nome: null },
  ];

  it("com Entrada, só lista classificações usadas em entradas", () => {
    expect(classificacoesDoTipo(linhas, ["entrada"]).map(([id]) => id)).toEqual(["rec", "transf"]);
  });

  it("com Saída, só as de saída; sem tipo, todas", () => {
    expect(classificacoesDoTipo(linhas, ["saida"]).map(([id]) => id)).toEqual(["assid", "transf"]);
    expect(classificacoesDoTipo(linhas, []).map(([id]) => id)).toEqual(["assid", "rec", "transf"]);
    expect(classificacoesDoTipo(linhas, ["entrada", "saida"])).toHaveLength(3);
  });

  it("ao trocar o tipo, tira da seleção o que não existe mais e mantém 'Sem …'", () => {
    const entrada = classificacoesDoTipo(linhas, ["entrada"]);
    expect(manterSelecionadasDisponiveis(["assid", "transf", FILTRO_SEM_VALOR], entrada)).toEqual(["transf", FILTRO_SEM_VALOR]);
  });
});

// Filtro Centro de Custo acompanha o filtro Empresa: com uma empresa marcada só lista os contratos dela.
describe("contratosDasEmpresas", () => {
  const linhas = [
    { empresa_id: "agps", contrato_id: "c1", contrato_nome: "INVESTIMENTOS AGPS" },
    { empresa_id: "agps", contrato_id: "c2", contrato_nome: "ADMINISTRATIVO AGPS" },
    { empresa_id: "sn", contrato_id: "c3", contrato_nome: "SALTO DO JACUI" },
    { empresa_id: "sn", contrato_id: "c1", contrato_nome: "INVESTIMENTOS AGPS" },
    { empresa_id: "hagg", contrato_id: null, contrato_nome: null },
  ];

  it("sem empresa, lista todos os contratos (ordem alfabética)", () => {
    expect(contratosDasEmpresas(linhas, []).map(([id]) => id)).toEqual(["c2", "c1", "c3"]);
  });

  it("com uma empresa, só os contratos dela", () => {
    expect(contratosDasEmpresas(linhas, ["agps"]).map(([id]) => id)).toEqual(["c2", "c1"]);
    expect(contratosDasEmpresas(linhas, ["hagg"])).toEqual([]);
  });

  it("com várias empresas, junta os contratos delas sem repetir", () => {
    expect(contratosDasEmpresas(linhas, ["agps", "sn"]).map(([id]) => id)).toEqual(["c2", "c1", "c3"]);
  });

  it("ao trocar a empresa, tira da seleção o contrato de outra empresa e mantém 'Sem …'", () => {
    expect(manterSelecionadasDisponiveis(["c3", "c1", FILTRO_SEM_VALOR], contratosDasEmpresas(linhas, ["agps"]))).toEqual(["c1", FILTRO_SEM_VALOR]);
  });
});
