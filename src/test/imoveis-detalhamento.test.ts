import { describe, expect, it } from "vitest";
import { chaveVinculo, lancamentosPorImovel, resumoDoImovel, tipoDoGasto, totaisDosImoveis, type LancamentoImovel } from "@/pages/juridico/patrimonio/imoveisRegras";

// SIS-2026-0911: Imóveis Detalhamento separa capital aplicado (aquisição + investimentos/obras) de manutenção.
const l = (p: Partial<LancamentoImovel>): LancamentoImovel => ({
  patrimonio_id: 1, origem: "malote", despesa_id: "d1", numero_parcela: null, id_malote: "DM-1", data_pagamento: "2026-10-01", competencia: "2026-10-01",
  contrato_id: "c", contrato_nome: "AGPS - CONDOMINIO", tratamento_excecao: null, classificacao_nome: null, descricao: "x", valor: 0, ...p,
});

describe("tipo do gasto pelo contrato do lançamento", () => {
  it("contrato INVESTIMENTOS e OBRAS ADM são investimento/obra; os demais, manutenção", () => {
    expect(tipoDoGasto({ contrato_nome: "INVESTIMENTOS - HAGG", tratamento_excecao: null })).toBe("investimento_obra");
    expect(tipoDoGasto({ contrato_nome: "OBRAS ADM - SN", tratamento_excecao: null })).toBe("investimento_obra");
    expect(tipoDoGasto({ contrato_nome: "AGPS - CONDOMINIO", tratamento_excecao: null })).toBe("manutencao");
  });
  it("a exceção configurada na Controladoria vale mais que o nome", () => {
    expect(tipoDoGasto({ contrato_nome: "AGPS - REFORMA", tratamento_excecao: "investimento" })).toBe("investimento_obra");
    expect(tipoDoGasto({ contrato_nome: "INVESTIMENTOS - X", tratamento_excecao: "normal" })).toBe("manutencao");
  });
});

describe("resumo do imóvel (exemplo do chamado)", () => {
  it("aquisição + investimentos/obras + manutenção = total aplicado; resultado = estimado − total", () => {
    const r = resumoDoImovel({ valor_contrato: 500000, valor_estimado: 900000 }, [
      l({ valor: 100000, contrato_nome: "OBRAS ADM - HAGG" }), l({ valor: 50000, contrato_nome: "INVESTIMENTOS - HAGG" }),
      l({ valor: 20000 }), l({ valor: 10000 }),
    ]);
    expect(r).toMatchObject({ aquisicao: 500000, investimentosObras: 150000, manutencao: 30000, totalAplicado: 680000, valorEstimado: 900000, resultadoPotencial: 220000, status: "saudavel", qtdLancamentos: 4 });
  });
  it("sem valor estimado não inventa resultado; custo acima do estimado vira atenção", () => {
    expect(resumoDoImovel({ valor_contrato: 100 }, [])).toMatchObject({ resultadoPotencial: null, status: "sem_estimativa" });
    expect(resumoDoImovel({ valor_contrato: 100, valor_estimado: 120 }, [l({ valor: 50 })])).toMatchObject({ resultadoPotencial: -30, status: "atencao" });
  });
  it("soma em centavos, sem resto de ponto flutuante", () => {
    const r = resumoDoImovel({ valor_contrato: 0.1 }, [l({ valor: 0.2 }), l({ valor: 0.3 })]);
    expect(r.totalAplicado).toBe(0.6);
  });
});

describe("agrupamento, totais e chave", () => {
  it("agrupa por imóvel e totaliza só o que tem estimativa no resultado potencial", () => {
    const m = lancamentosPorImovel([l({ patrimonio_id: 1, valor: 10 }), l({ patrimonio_id: 2, valor: 5 }), l({ patrimonio_id: 1, valor: 1 })]);
    expect(m.get(1)).toHaveLength(2);
    const t = totaisDosImoveis([
      resumoDoImovel({ valor_contrato: 100, valor_estimado: 150 }, m.get(1) ?? []),
      resumoDoImovel({ valor_contrato: 50 }, m.get(2) ?? []),
    ]);
    expect(t).toMatchObject({ aquisicao: 150, manutencao: 16, totalAplicado: 166, valorEstimado: 150, resultadoPotencial: 39 });
  });
  it("chave do vínculo = origem|despesa|parcela (0 sem parcela), como a do ajuste", () => {
    expect(chaveVinculo({ origem: "malote", despesa_id: "d", numero_parcela: null })).toBe("malote|d|0");
    expect(chaveVinculo({ origem: "malote", despesa_id: "d", numero_parcela: 3 })).toBe("malote|d|3");
  });
});
