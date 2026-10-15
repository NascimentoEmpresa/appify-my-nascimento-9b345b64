// Fluxo de Caixa: ratear linhas importadas da planilha (regras puras da tela; a regra de verdade é a RPC
// fluxo_caixa_importado_ratear, migration 20261015000010).
import { describe, expect, it } from "vitest";
import {
  acaoDeRateio, cotasIniciais, cotasParaRpc, diferencaCotas, distribuirIgualmente, erroCotas, lerValor, SEM_CONTRATO, somaCotas,
  type CotaRateio,
} from "@/pages/financeiro/fluxo-caixa/rateioImportado";

const C = (contratoId: string, valor: string): CotaRateio => ({ contratoId, valor });

describe("valores digitados", () => {
  it("aceita vírgula, ponto de milhar e ponto decimal", () => {
    expect(lerValor("1.234,56")).toBe(1234.56);
    expect(lerValor("1234,5")).toBe(1234.5);
    expect(lerValor("1234.56")).toBe(1234.56);
    expect(lerValor("")).toBe(0);
    expect(lerValor("abc")).toBe(0);
    expect(lerValor("-50,10")).toBe(-50.1);
  });
});

describe("distribuir igualmente", () => {
  it("não perde centavos: a última cota absorve a sobra", () => {
    expect(distribuirIgualmente(100, 3)).toEqual([33.33, 33.33, 33.34]);
    expect(distribuirIgualmente(100, 3).reduce((s, v) => s + v, 0)).toBeCloseTo(100, 2);
    expect(distribuirIgualmente(0.05, 2)).toEqual([0.02, 0.03]);
    expect(distribuirIgualmente(10, 0)).toEqual([]);
  });
});

describe("validação das cotas", () => {
  it("soma e diferença", () => {
    const cotas = [C("a", "60,00"), C("b", "39,90")];
    expect(somaCotas(cotas)).toBe(99.9);
    expect(diferencaCotas(100, cotas)).toBe(0.1);
  });

  it("fecha quando a soma é igual ao valor da linha", () => {
    expect(erroCotas(100, [C("a", "60"), C("b", "40")], false)).toBeNull();
  });

  it("recusa soma diferente, dizendo quanto falta ou sobra", () => {
    expect(erroCotas(100, [C("a", "60"), C("b", "30")], false)).toMatch(/faltam R\$\s?10,00/);
    expect(erroCotas(100, [C("a", "60"), C("b", "50")], false)).toMatch(/sobram R\$\s?10,00/);
  });

  it("ratear exige 2 cotas; com 1 só só vale para desfazer um rateio criado no ERP", () => {
    expect(erroCotas(100, [C("a", "100")], false)).toMatch(/ao menos 2 cotas/);
    expect(erroCotas(100, [C("a", "100")], true)).toBeNull();
  });

  it("toda cota tem contrato (ou 'sem contrato') e valor diferente de zero", () => {
    expect(erroCotas(100, [C("", "50"), C("b", "50")], false)).toMatch(/contrato/);
    expect(erroCotas(100, [C("a", "100"), C("b", "0")], false)).toMatch(/diferente de zero/);
    expect(erroCotas(100, [C(SEM_CONTRATO, "50"), C("b", "50")], false)).toBeNull();
  });

  it("estorno (valor negativo): as cotas têm o mesmo sinal da linha", () => {
    expect(erroCotas(-100, [C("a", "-60"), C("b", "-40")], false)).toBeNull();
    expect(erroCotas(-100, [C("a", "-160"), C("b", "60")], false)).toMatch(/mesmo sinal/);
  });
});

describe("corpo da RPC", () => {
  it("'sem contrato' vira contrato_id nulo e o valor vira número", () => {
    expect(cotasParaRpc([C(SEM_CONTRATO, "10,5"), C("uuid-1", "20")])).toEqual([
      { contrato_id: null, valor: 10.5 },
      { contrato_id: "uuid-1", valor: 20 },
    ]);
  });
});

describe("o que a tela oferece em cada linha", () => {
  it("só linha importada: avulsa = ratear; rateio criado no ERP = refazer; rateio da planilha = nada", () => {
    expect(acaoDeRateio({ origem: "importacao_historica", contrato_nome: "ALFA" })).toBe("ratear");
    expect(acaoDeRateio({ origem: "importacao_historica", contrato_nome: "Rateio", rateio_erp: true })).toBe("refazer");
    expect(acaoDeRateio({ origem: "importacao_historica", contrato_nome: "Rateio", rateio_erp: false })).toBeNull();
    expect(acaoDeRateio({ origem: "malote", contrato_nome: "ALFA" })).toBeNull();
    expect(acaoDeRateio({ origem: "debito_automatico" })).toBeNull();
  });
});

describe("cotas iniciais do diálogo", () => {
  it("linha avulsa: 2 cotas dividindo o valor, a 1ª já no contrato atual", () => {
    const cotas = cotasIniciais(100.01, "c1", undefined, false);
    expect(cotas).toHaveLength(2);
    expect(cotas[0].contratoId).toBe("c1");
    expect(cotas[1].contratoId).toBe("");
    expect(somaCotas(cotas)).toBe(100.01);
  });

  it("refazer: parte do detalhe atual; id 'nome:...' (contrato sem cadastro) vira 'sem contrato'", () => {
    const cotas = cotasIniciais(100, null, [{ id: "c1", valor: 70 }, { id: "nome:ADMINISTRATIVO", valor: 30 }], true);
    expect(cotas).toEqual([C("c1", "70"), C(SEM_CONTRATO, "30")]);
  });
});
