import { describe, expect, it } from "vitest";
import type { OrcamentoContratoGrupo } from "@/hooks/useOrcamentoContratos";
import type { UtilizadoOrcamentoLinha } from "@/hooks/useUtilizadoOrcamento";
import {
  contratoDaAba, orcadoPorEmpresa, saldoDaOrigemPorEmpresa, utilizadoPorEmpresa, validarDistribuicao, type LinhaOrcamento,
} from "@/pages/malote/orcamento-adm-socios/regras";

// SIS-2026-0702: regras do novo Orçamento Administrativo / Sócios.
const grupo = (id: string, nome: string, empresa: string, valores: Record<string, number>): OrcamentoContratoGrupo => ({
  contrato: { id, nome, empresa_id: empresa } as any,
  rubricas: Object.entries(valores).map(([malote, valor]) => ({ campo: malote, label: malote, grupo: "g", valor, classificacaoMaloteId: malote })),
  valorTotal: Object.values(valores).reduce((s, v) => s + v, 0),
});
const gasto = (extra: Partial<UtilizadoOrcamentoLinha>): UtilizadoOrcamentoLinha => ({
  despesa_id: "d", id_malote: "M1", descricao: "", status: "Despesa Paga" as any, competencia: "2026-10-01", data_pagamento: "2026-10-05", forma_pagamento: null,
  classificacao_id: "origem", classificacao_nome: "", empresa_id: "hagg", empresa_nome: "", contrato_id: "c1", contrato_nome: "UFRGS", valor: 0, ...extra,
});
const linha = (extra: Partial<LinhaOrcamento>): LinhaOrcamento => ({
  classificacaoAdministrativaId: "a1", descricao: "", modo: "percentual", percentual: 20, origemIds: ["origem"], valorManual: 0, distribuicao: {}, ...extra,
});

describe("saldo remanescente da origem (regra 6)", () => {
  it("origem R$1.000, já usado R$100 → saldo R$900", () => {
    const saldo = saldoDaOrigemPorEmpresa([grupo("c1", "UFRGS", "hagg", { origem: 1000 })], [gasto({ valor: 100 })], ["origem"], "2026-10");
    expect(saldo.get("hagg")).toBe(900);
  });
  it("soma contratos da mesma empresa e separa empresas", () => {
    const saldo = saldoDaOrigemPorEmpresa(
      [grupo("c1", "UFRGS", "hagg", { origem: 1000 }), grupo("c2", "SAMU", "hagg", { origem: 500 }), grupo("c3", "PF", "sn", { origem: 200 })],
      [gasto({ valor: 100 })], ["origem"], "2026-10");
    expect(saldo.get("hagg")).toBe(1400);
    expect(saldo.get("sn")).toBe(200);
  });
  it("contrato estourado não come o saldo de outro (fica em zero)", () => {
    const saldo = saldoDaOrigemPorEmpresa(
      [grupo("c1", "UFRGS", "hagg", { origem: 100 }), grupo("c2", "SAMU", "hagg", { origem: 500 })],
      [gasto({ valor: 300 })], ["origem"], "2026-10");
    expect(saldo.get("hagg")).toBe(500);
  });
  it("só conta o mês escolhido, a origem escolhida e ignora contratos ADMINISTRATIVO", () => {
    const saldo = saldoDaOrigemPorEmpresa(
      [grupo("c1", "UFRGS", "hagg", { origem: 1000, outra: 50 }), grupo("c9", "ADMINISTRATIVO - HAGG", "hagg", { origem: 777 })],
      [gasto({ valor: 100, competencia: "2026-09-01" }), gasto({ valor: 30, classificacao_id: "outra" })], ["origem"], "2026-10");
    expect(saldo.get("hagg")).toBe(1000);
  });
  it("várias origens somam", () => {
    const saldo = saldoDaOrigemPorEmpresa([grupo("c1", "UFRGS", "hagg", { origem: 1000, outra: 50 })], [], ["origem", "outra"], "2026-10");
    expect(saldo.get("hagg")).toBe(1050);
  });
});

describe("valor orçado por empresa (regras 5 e 7)", () => {
  it("percentual sobre o saldo: 20% de 900 = 180", () => {
    expect(orcadoPorEmpresa(linha({}), new Map([["hagg", 900]]), ["hagg", "sn"]).get("hagg")).toBe(180);
    expect(orcadoPorEmpresa(linha({}), new Map([["hagg", 900]]), ["hagg", "sn"]).get("sn")).toBe(0);
  });
  it("modo manual rateia pelo percentual e a soma fecha no valor digitado", () => {
    const r = orcadoPorEmpresa(linha({ modo: "manual", valorManual: 100, distribuicao: { a: 33.33, b: 33.33, c: 33.34 } }), new Map(), ["a", "b", "c"]);
    expect([...r.values()].reduce((s, v) => Math.round((s + v) * 100) / 100, 0)).toBe(100);
  });
});

describe("centro de custo da aba (regra 4)", () => {
  it("ADM = ADMINISTRATIVO - EMPRESA; Sócios = ADMINISTRATIVO SÓCIOS - NOME", () => {
    expect(contratoDaAba("ADMINISTRATIVO - NH", "administrativo")).toBe(true);
    expect(contratoDaAba("ADMINISTRATIVO - NH", "socios")).toBe(false);
    expect(contratoDaAba("ADMINISTRATIVO SÓCIOS - GUIOMAR", "socios")).toBe(true);
    expect(contratoDaAba("ADMINISTRATIVO SÓCIOS - GUIOMAR", "administrativo")).toBe(false);
    expect(contratoDaAba("UFRGS - LIMPEZA", "administrativo")).toBe(false);
  });
});

describe("utilizado da classificação administrativa", () => {
  it("soma o Malote da classificação ligada, nos contratos da aba, no mês, por empresa", () => {
    const u = utilizadoPorEmpresa([
      gasto({ classificacao_id: "m1", contrato_nome: "ADMINISTRATIVO - HAGG", empresa_id: "hagg", valor: 40, data_pagamento: "2026-10-03" }),
      gasto({ classificacao_id: "m1", contrato_nome: "ADMINISTRATIVO - HAGG", empresa_id: "hagg", valor: 10, data_pagamento: "2026-10-09" }),
      gasto({ classificacao_id: "m1", contrato_nome: "ADMINISTRATIVO SÓCIOS - GUIOMAR", empresa_id: "hagg", valor: 99 }),
      gasto({ classificacao_id: "m1", contrato_nome: "UFRGS", empresa_id: "hagg", valor: 77 }),
      gasto({ classificacao_id: "m1", contrato_nome: "ADMINISTRATIVO - SN", empresa_id: "sn", valor: 5, competencia: "2026-09-01" }),
    ], "m1", "administrativo", "2026-10");
    expect(u.get("hagg")).toEqual({ valor: 50, ultima: "2026-10-09" });
    expect(u.has("sn")).toBe(false);
    expect(utilizadoPorEmpresa([], null, "administrativo", "2026-10").size).toBe(0);
  });
});

describe("validação do percentual (regra 7)", () => {
  const nomes = new Map([["a1", "CONSÓRCIOS"], ["a2", "IPTU"]]);
  it("só salva se os percentuais fecham EXATAMENTE 100%", () => {
    expect(validarDistribuicao([linha({ percentual: 60 }), linha({ classificacaoAdministrativaId: "a2", percentual: 40 })], nomes)).toEqual([]);
    expect(validarDistribuicao([linha({ percentual: 60 }), linha({ classificacaoAdministrativaId: "a2", percentual: 39.99 })], nomes)[0].mensagem).toMatch(/100%/);
  });
  it("percentual sem origem não salva; modo manual precisa de 100% entre empresas", () => {
    expect(validarDistribuicao([linha({ percentual: 100, origemIds: [] })], nomes)[0].mensagem).toMatch(/origem/);
    expect(validarDistribuicao([linha({ modo: "manual", distribuicao: { a: 50, b: 40 } })], nomes)[0].mensagem).toMatch(/distribuição/);
    expect(validarDistribuicao([linha({ modo: "manual", distribuicao: { a: 50, b: 50 } })], nomes)).toEqual([]);
  });
  it("classificação recém-incluída (0%, sem origem) não trava o salvamento", () => {
    expect(validarDistribuicao([linha({ percentual: 100 }), linha({ classificacaoAdministrativaId: "a2", percentual: 0, origemIds: [] })], nomes)).toEqual([]);
  });
  it("sem classificações percentuais não há o que validar", () => {
    expect(validarDistribuicao([], nomes)).toEqual([]);
  });
});
