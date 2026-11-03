// SIS-2026-0725: os filtros do Fluxo de Caixa aceitam mais de um item.
import { describe, expect, it } from "vitest";
import { FILTRO_SEM_VALOR, casaSelecao, nomesSelecionados, opcoesDe } from "@/pages/financeiro/fluxo-caixa/filtrosMultiplos";
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
