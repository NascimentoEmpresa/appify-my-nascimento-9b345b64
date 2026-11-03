import { describe, expect, it } from "vitest";
import type { LinhaFluxoCusto } from "@/pages/controladoria/faturamento/regras";
import { detalheAdmPorClassificacao, detalheSocioPorClassificacao, ROTULO_SEM_CLASSIFICACAO } from "@/pages/controladoria/fechamento/regras";
import { linkFluxoDoRecorte } from "@/pages/controladoria/fechamento/linkFluxo";
import { competenciaNoIntervalo } from "@/pages/financeiro/fluxo-caixa/filtroCompetencia";

// SIS-2026-0781: seta com os lançamentos de cada classificação no Fechamento da Empresa e "Ver todos" abrindo o Fluxo no mesmo recorte.
const l = (o: Partial<LinhaFluxoCusto>): LinhaFluxoCusto => ({
  tipo: "saida", data_pagamento: "2026-01-10", competencia: "2026-01-01", contrato_id: null, classificacao_id: "k1", classificacao_nome: "SEGURO DE VIDA ADM", valor: 100, empresa_id: "e1", ...o,
});
const jan = new Set(["2026-01"]);

describe("detalhe por classificação — lançamentos de cada uma", () => {
  it("guarda ID, descrição, data e valor, por data, e a soma bate com o valor da classificação", () => {
    const itens = detalheAdmPorClassificacao([
      l({ id_malote: "DM-2", descricao: "Seguro Bradesco", data_pagamento: "2026-01-20", valor: 10.5 }),
      l({ id_malote: "DM-1", descricao: "Seguro Porto", data_pagamento: "2026-01-05", valor: 20.25 }),
    ], jan, null);
    expect(itens).toHaveLength(1);
    expect(itens[0].itens.map((x) => [x.idMalote, x.data])).toEqual([["DM-1", "2026-01-05"], ["DM-2", "2026-01-20"]]);
    expect(Math.round(itens[0].itens.reduce((s, x) => s + x.valor, 0) * 100) / 100).toBe(itens[0].valor);
  });

  it("sem data de pagamento, mostra a competência", () => {
    const [item] = detalheAdmPorClassificacao([l({ data_pagamento: null, competencia: "2026-01-01" })], jan, null);
    expect(item.itens[0].data).toBe("2026-01-01");
  });

  it("duas classificações com o mesmo nome somam numa linha e juntam os ids", () => {
    const [item] = detalheAdmPorClassificacao([l({ classificacao_id: "k1" }), l({ classificacao_id: "k2" }), l({ classificacao_id: "k2" })], jan, null);
    expect(item.lancamentos).toBe(3);
    expect(item.classificacaoIds).toEqual(["k1", "k2"]);
  });

  it("sem classificação (despesa de sócio) cai no grupo próprio e sem ids", () => {
    const [item] = detalheSocioPorClassificacao([l({ contrato_id: "cH", classificacao_id: null, classificacao_nome: null })], jan, "Helena", new Map([["cH", "Helena"]]));
    expect(item.classificacao).toBe(ROTULO_SEM_CLASSIFICACAO);
    expect(item.classificacaoIds).toEqual([]);
  });
});

describe("link do Fechamento para o Fluxo de Caixa", () => {
  const base = { classificacaoIds: ["k1"], contratoIds: ["c1", "c2"], semContrato: true, empresaId: "e1", valorEsperado: 54408.98 };

  it("base competência: intervalo de competências, só saídas, consolidado, mesma empresa, classificação e contratos", () => {
    const q = new URL(linkFluxoDoRecorte({ ...base, base: "competencia", meses: ["2026-03", "2026-01", "2026-02"] }), "http://x").searchParams;
    expect(q.get("aba")).toBe("consolidado");
    expect(q.get("tipo")).toBe("saida");
    expect(q.get("competenciaDe")).toBe("2026-01");
    expect(q.get("competenciaAte")).toBe("2026-03");
    expect(q.get("de")).toBeNull();
    expect(q.get("empresa")).toBe("e1");
    expect(q.get("classificacao")).toBe("k1");
    expect(q.get("contrato")).toBe("__sem,c1,c2");
    expect(q.get("esperado")).toBe("54408.98");
  });

  it("base data de pagamento: de/ate do primeiro ao último dia", () => {
    const q = new URL(linkFluxoDoRecorte({ ...base, base: "pagamento", meses: ["2026-02"] }), "http://x").searchParams;
    expect(q.get("de")).toBe("2026-02-01");
    expect(q.get("ate")).toBe("2026-02-28");
    expect(q.get("competenciaDe")).toBeNull();
  });

  it("sem classificação usa a opção 'Sem classificação' e sem empresa/contrato omite os filtros", () => {
    const q = new URL(linkFluxoDoRecorte({ base: "competencia", meses: ["2026-01"], classificacaoIds: [], semClassificacao: true, contratoIds: [] }), "http://x").searchParams;
    expect(q.get("classificacao")).toBe("__sem");
    expect(q.get("contrato")).toBeNull();
    expect(q.get("empresa")).toBeNull();
    expect(q.get("esperado")).toBeNull();
  });
});

describe("filtro de competência do Fluxo em intervalo", () => {
  const linha = (competencia: string | null, data_pagamento: string | null = null) => ({ competencia, data_pagamento });
  it("só o primeiro mês = aquele mês; sem filtro passa tudo", () => {
    expect(competenciaNoIntervalo(linha("2026-02-01"), "2026-02", "")).toBe(true);
    expect(competenciaNoIntervalo(linha("2026-03-01"), "2026-02", "")).toBe(false);
    expect(competenciaNoIntervalo(linha(null), "", "")).toBe(true);
  });
  it("de … até inclui as pontas", () => {
    expect(competenciaNoIntervalo(linha("2026-01-01"), "2026-01", "2026-03")).toBe(true);
    expect(competenciaNoIntervalo(linha("2026-03-01"), "2026-01", "2026-03")).toBe(true);
    expect(competenciaNoIntervalo(linha("2026-04-01"), "2026-01", "2026-03")).toBe(false);
  });
  it("sem competência vale o mês do pagamento, como no Fechamento", () => {
    expect(competenciaNoIntervalo(linha(null, "2026-02-15"), "2026-02", "2026-02")).toBe(true);
    expect(competenciaNoIntervalo(linha(null, null), "2026-02", "")).toBe(false);
  });
});
