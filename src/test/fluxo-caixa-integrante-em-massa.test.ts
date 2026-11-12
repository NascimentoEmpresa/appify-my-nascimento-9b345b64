import { describe, expect, it } from "vitest";
import { planejarTrocaDeIntegrante, type LinhaMassa } from "@/pages/financeiro/fluxo-caixa/alteracaoEmMassa";

// SIS-2026-0823: alteração em massa do Integrante no Fluxo de Caixa.
const linha = (o: Partial<LinhaMassa> = {}): LinhaMassa => ({
  origem: "malote", despesa_id: "d1", numero_parcela: null, empresa_id: "E1", contrato_id: "c1", contrato_nome: "Adm", classificacao_id: "k", classificacao_nome: "Luz",
  integrante_empregado_id: null, qtdLinhasRateio: 1, ...o,
});

describe("planejarTrocaDeIntegrante", () => {
  it("despesa do Malote com uma linha de rateio entra, com ou sem integrante anterior", () => {
    const r = planejarTrocaDeIntegrante([linha({ despesa_id: "a" }), linha({ despesa_id: "b", integrante_empregado_id: 7 })], 5755);
    expect(r.aplicar.map((l) => l.despesa_id)).toEqual(["a", "b"]);
    expect(r.ignoradas).toHaveLength(0);
  });
  it("só Malote e importação têm integrante: débito automático, cartão, aplicação e conta garantida ficam de fora", () => {
    const origens: LinhaMassa["origem"][] = ["debito_automatico", "cartao_fatura", "aplicacao_financeira", "conta_garantida"];
    const r = planejarTrocaDeIntegrante(origens.map((o, i) => linha({ origem: o, despesa_id: `x${i}` })), 1);
    expect(r.aplicar).toHaveLength(0);
    expect(r.ignoradas.every((i) => /Malote ou lançamento importado/.test(i.motivo))).toBe(true);
  });
  // SIS-2026-0859: IMP-… (planilha) entra, com ou sem integrante, rateado ou não (a RPC grava em todas as cotas).
  it("lançamento importado da planilha entra, mesmo rateado em várias cotas", () => {
    const r = planejarTrocaDeIntegrante([
      linha({ origem: "importacao_historica", despesa_id: "imp1" }),
      linha({ origem: "importacao_historica", despesa_id: "imp2", qtdLinhasRateio: 3, integrante_empregado_id: 7 }),
    ], 5755);
    expect(r.aplicar.map((l) => l.despesa_id)).toEqual(["imp1", "imp2"]);
    expect(r.ignoradas).toHaveLength(0);
  });
  it("importado que já está com o integrante escolhido fica de fora", () => {
    const r = planejarTrocaDeIntegrante([linha({ origem: "importacao_historica", integrante_empregado_id: 5755 })], 5755);
    expect(r.ignoradas[0].motivo).toBe("Já está com este integrante");
  });
  it("despesa rateada em várias linhas e fatura de cartão do Malote ficam de fora", () => {
    const r = planejarTrocaDeIntegrante([linha({ despesa_id: "r", qtdLinhasRateio: 3 }), linha({ despesa_id: "f", fatura_cartao_id: "cartao" })], 1);
    expect(r.aplicar).toHaveLength(0);
    expect(r.ignoradas.map((i) => i.motivo)).toEqual([
      "Rateada em várias linhas: ajuste o integrante de cada uma na grade de rateio do Malote",
      "Fatura de cartão: o integrante é de cada despesa, no Malote",
    ]);
  });
  it("despesa sem linha de rateio fica de fora", () => {
    expect(planejarTrocaDeIntegrante([linha({ qtdLinhasRateio: 0 })], 1).ignoradas[0].motivo).toMatch(/sem linha de rateio/);
  });
  it("quem já está com o integrante escolhido fica de fora", () => {
    const r = planejarTrocaDeIntegrante([linha({ integrante_empregado_id: 5755 })], 5755);
    expect(r.aplicar).toHaveLength(0);
    expect(r.ignoradas[0].motivo).toBe("Já está com este integrante");
  });
  it("parcelas da mesma despesa: a primeira troca e as outras são cobertas por ela", () => {
    const r = planejarTrocaDeIntegrante([linha({ numero_parcela: 1 }), linha({ numero_parcela: 2 }), linha({ numero_parcela: 3 })], 9);
    expect(r.aplicar).toHaveLength(1);
    expect(r.ignoradas).toHaveLength(2);
  });
});
