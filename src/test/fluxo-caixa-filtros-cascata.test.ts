// SIS-2026-0913: filtros do Fluxo de Caixa em cascata — as opções de cada filtro saem das linhas que passam nos OUTROS filtros.
import { describe, expect, it } from "vitest";
import {
  FILTRO_SEM_VALOR,
  baseDaFaceta,
  contratosDasLinhas,
  opcoesFacetadas,
  paresDasLinhas,
  separarPorFacetas,
  type ChaveFiltroFacetado,
} from "@/pages/financeiro/fluxo-caixa/filtrosMultiplos";

interface Linha {
  id: string;
  tipo: string;
  classificacao_id: string | null;
  contrato_id: string | null;
  contrato_nome: string | null;
  fatura_cartao_id?: string | null;
  rateioDetalhe?: { id: string; nome: string; valor: number }[];
}

const linhas: Linha[] = [
  { id: "1", tipo: "saida", classificacao_id: "transf", contrato_id: "mf-sn", contrato_nome: "MOVIMENTAÇÃO FINANCEIRA - SN" },
  { id: "2", tipo: "saida", classificacao_id: "transf", contrato_id: "mf-hagg", contrato_nome: "MOVIMENTAÇÃO FINANCEIRA - HAGG" },
  { id: "3", tipo: "saida", classificacao_id: "aluguel", contrato_id: "adm-nh", contrato_nome: "ADMINISTRATIVO - NH" },
  { id: "4", tipo: "entrada", classificacao_id: "transf", contrato_id: "adm-sn", contrato_nome: "ADMINISTRATIVO - SN" },
  { id: "5", tipo: "saida", classificacao_id: "aluguel", contrato_id: null, contrato_nome: null },
];

// Mesma regra da tela, só com Tipo, Classificação e Centro de Custo.
function separar(tipos: string[], classificacoes: string[], contratos: string[]) {
  return separarPorFacetas(linhas, (l) => {
    const falhas: ChaveFiltroFacetado[] = [];
    if (tipos.length > 0 && !tipos.includes(l.tipo)) falhas.push("tipo");
    if (classificacoes.length > 0 && !classificacoes.includes(l.classificacao_id ?? "")) falhas.push("classificacao");
    if (contratos.length > 0 && !contratos.includes(l.contrato_id ?? "")) falhas.push("contrato");
    return falhas;
  });
}

describe("separarPorFacetas / baseDaFaceta", () => {
  it("cenário do chamado: Saída + Transferência entre Contas → Centro de Custo só lista Movimentação Financeira", () => {
    const sep = separar(["saida"], ["transf"], []);
    expect(sep.passam.map((l) => l.id)).toEqual(["1", "2"]);
    const centros = contratosDasLinhas(baseDaFaceta(sep, "contrato")).map(([, nome]) => nome);
    expect(centros).toEqual(["MOVIMENTAÇÃO FINANCEIRA - HAGG", "MOVIMENTAÇÃO FINANCEIRA - SN"]);
  });

  it("o próprio filtro não restringe as suas opções (dá para marcar mais de um centro)", () => {
    const sep = separar(["saida"], ["transf"], ["mf-sn"]);
    expect(sep.passam.map((l) => l.id)).toEqual(["1"]);
    expect(contratosDasLinhas(baseDaFaceta(sep, "contrato")).map(([id]) => id)).toEqual(["mf-hagg", "mf-sn"]);
  });

  it("linha reprovada em dois filtros não entra em base nenhuma", () => {
    const sep = separar(["saida"], ["transf"], []);
    // linha 4: entrada (falha Tipo) mas é transf → só entra na base do Tipo
    expect(baseDaFaceta(sep, "tipo").map((l) => l.id)).toContain("4");
    expect(baseDaFaceta(sep, "contrato").map((l) => l.id)).not.toContain("4");
    // linha 3: saída + aluguel → só falha Classificação
    expect(baseDaFaceta(sep, "classificacao").map((l) => l.id)).toContain("3");
    expect(baseDaFaceta(sep, "contrato").map((l) => l.id)).not.toContain("3");
  });

  it("filtro sem faceta (reprova = null) tira a linha de todas as bases", () => {
    const sep = separarPorFacetas(linhas, (l) => (l.id === "1" ? null : []));
    for (const k of ["tipo", "contrato", "classificacao"] as ChaveFiltroFacetado[]) {
      expect(baseDaFaceta(sep, k).map((l) => l.id)).not.toContain("1");
    }
  });

  it("ao limpar os filtros, volta a listar todos os centros", () => {
    const sep = separar([], [], []);
    expect(contratosDasLinhas(baseDaFaceta(sep, "contrato"))).toHaveLength(4);
  });
});

describe("contratosDasLinhas", () => {
  it("inclui o centro que só aparece em cota de rateio, mas não as cotas da fatura do cartão", () => {
    const pares = contratosDasLinhas([
      { contrato_id: null, contrato_nome: "Rateio", rateioDetalhe: [{ id: "c1", nome: "ALFA" }, { id: "nome:ADM", nome: "ADM" }] },
      { contrato_id: "c2", contrato_nome: "BETA", fatura_cartao_id: "f1", rateioDetalhe: [{ id: "DM-1", nome: "DM-1 · Almoço" }] },
    ]);
    expect(pares).toEqual([["nome:ADM", "ADM"], ["c1", "ALFA"], ["c2", "BETA"]]);
  });
});

describe("opcoesFacetadas", () => {
  const todos: [string, string][] = [["a", "ALFA"], ["b", "BETA"], ["c", "GAMA"]];

  it("item marcado que ficou sem lançamento continua na lista (senão o filtro ficaria ativo e invisível)", () => {
    const op = opcoesFacetadas([["a", "ALFA"]], ["c"], todos);
    expect(op.map((o) => o.value)).toEqual(["a", "c"]);
  });

  it("'Sem …' só aparece quando há linha sem o campo, ou quando já está marcado", () => {
    expect(opcoesFacetadas([["a", "ALFA"]], [], todos, { rotulo: "Sem (—)", temLinhaSem: false }).map((o) => o.value)).toEqual(["a"]);
    expect(opcoesFacetadas([["a", "ALFA"]], [], todos, { rotulo: "Sem (—)", temLinhaSem: true }).map((o) => o.value)).toEqual([FILTRO_SEM_VALOR, "a"]);
    expect(opcoesFacetadas([["a", "ALFA"]], [FILTRO_SEM_VALOR], todos, { rotulo: "Sem (—)", temLinhaSem: false })[0].value).toBe(FILTRO_SEM_VALOR);
  });
});

describe("paresDasLinhas", () => {
  it("tira repetidos e ordena pelo nome", () => {
    const pares = paresDasLinhas(
      [{ id: "2", nome: "Zeta" }, { id: "1", nome: "Alfa" }, { id: "2", nome: "Zeta" }, { id: null, nome: "X" }],
      (l) => [l.id, l.nome],
    );
    expect(pares).toEqual([["1", "Alfa"], ["2", "Zeta"]]);
  });
});
