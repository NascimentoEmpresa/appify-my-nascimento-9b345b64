import { describe, expect, it } from "vitest";
import { contarMotivos, planejarTrocaDeCentroDeCusto, planejarTrocaDeClassificacao, type LinhaMassa } from "@/pages/financeiro/fluxo-caixa/alteracaoEmMassa";

// SIS-2026-0780: o que a alteração em massa do Fluxo de Caixa aplica e o que deixa de fora (e por quê).
const linha = (o: Partial<LinhaMassa> = {}): LinhaMassa => ({
  origem: "malote", despesa_id: "d1", numero_parcela: null, empresa_id: "E1", contrato_id: "C1", contrato_nome: "Centro 1",
  classificacao_id: "K1", classificacao_nome: "Classe 1", ...o,
});
const novo = { id: "C2", empresa_id: "E1" };

describe("troca de Centro de Custo em massa", () => {
  it("aplica nas origens que aceitam e na mesma empresa", () => {
    const p = planejarTrocaDeCentroDeCusto([linha(), linha({ origem: "debito_automatico", despesa_id: "d2" }), linha({ origem: "importacao_historica", despesa_id: "d3", empresa_id: "E9" })], novo);
    expect(p.aplicar.map((l) => l.despesa_id)).toEqual(["d1", "d2", "d3"]); // a importada não tem trava de empresa
    expect(p.ignoradas).toEqual([]);
  });
  it("deixa de fora cartão, aplicação, rateada, o que já está no centro e empresa diferente", () => {
    const p = planejarTrocaDeCentroDeCusto([
      linha({ origem: "cartao_fatura", despesa_id: "a" }),
      linha({ origem: "aplicacao_financeira", despesa_id: "b" }),
      linha({ despesa_id: "c", contrato_nome: "Rateio", contrato_id: null }),
      linha({ despesa_id: "d", contrato_id: "C2" }),
      linha({ despesa_id: "e", empresa_id: "E2" }),
      linha({ despesa_id: "f" }),
    ], novo);
    expect(p.aplicar.map((l) => l.despesa_id)).toEqual(["f"]);
    expect(p.ignoradas.map((i) => i.linha.despesa_id)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("parcelas da mesma despesa: a troca roda uma vez só", () => {
    const p = planejarTrocaDeCentroDeCusto([linha({ numero_parcela: 1 }), linha({ numero_parcela: 2 }), linha({ numero_parcela: 3 })], novo);
    expect(p.aplicar).toHaveLength(1);
    expect(p.ignoradas).toHaveLength(2);
  });
});

describe("troca de Classificação em massa", () => {
  it("aplica nas origens com ajuste e pula rateada em classificações, a mesma classificação e a aplicação financeira", () => {
    const p = planejarTrocaDeClassificacao([
      linha({ despesa_id: "a" }),
      linha({ origem: "cartao_fatura", despesa_id: "b" }),
      linha({ despesa_id: "c", classificacao_nome: "Rateio", classificacao_id: null, classificacoesIds: ["K1", "K3"] }),
      linha({ despesa_id: "d", classificacao_id: "K9" }),
      linha({ origem: "aplicacao_financeira", despesa_id: "e" }),
    ], "K9");
    expect(p.aplicar.map((l) => l.despesa_id)).toEqual(["a", "b"]);
    expect(p.ignoradas.map((i) => i.linha.despesa_id)).toEqual(["c", "d", "e"]);
  });
  it("parcelas diferentes da mesma despesa são ajustes diferentes: todas entram", () => {
    const p = planejarTrocaDeClassificacao([linha({ numero_parcela: 1 }), linha({ numero_parcela: 2 })], "K9");
    expect(p.aplicar).toHaveLength(2);
  });
});

describe("resumo de motivos", () => {
  it("agrupa e ordena pelo mais frequente", () => {
    expect(contarMotivos([{ motivo: "A" }, { motivo: "B" }, { motivo: "B" }])).toEqual([{ motivo: "B", quantidade: 2 }, { motivo: "A", quantidade: 1 }]);
  });
});
