import { describe, expect, it } from "vitest";
import { dozeMeses, painelPeloFaturamento, type EntradaFaturamento } from "@/lib/operacional/painelPeloFaturamento";
import type { DadosPainelExecutivo } from "@/lib/operacional/painelExecutivo";
import type { NfFaturamento } from "@/pages/controladoria/faturamento/regras";

// 09/11/2026 — o Painel Executivo tem de bater com Controladoria › Faturamento
// da Empresa: lucro = Valor Líquido − Despesas do mês. Valores fictícios.

const nf = (contrato_id: string, competencia: string, liquido: number, extra: Partial<NfFaturamento> = {}): NfFaturamento => ({
  contrato_id, competencia, tipo_nota: "N", status: "concluida", valor_contrato_exec_total: 0,
  vlr_bruto_total: liquido, vlr_liquido_total: liquido, valor_pago: null, desconto_conta_vinculada: 0, ...extra,
});

const rpc: DadosPainelExecutivo = {
  competencia: "2026-01", ultima_dre: "2026-04", competencias: ["2026-01"],
  dre: { receita: 1, custo: 1, lucro: 0, margem: 0 }, dre_anterior: null,
  nf: { qtd: 1, recebido: 5, recebido_ant: 0, saldo: 7, saldo_ant: 0, vencido_90: 0, vencido_90_ant: 0 },
  serie: [], situacao: null, critico_anterior: null,
};

const entrada: EntradaFaturamento = {
  nfs: [
    nf("a", "2026-01-01", 600_000), nf("b", "2026-01-01", 400_000), nf("c", "2026-01-01", 5_000),
    nf("a", "2025-12-01", 500_000),
    nf("x", "2026-01-01", 999_999), // contrato fora do recorte (outra empresa)
    nf("a", "2026-01-01", 77_777, { status: "cancelada" }),
  ],
  custoPorContratoMes: new Map([["a|2026-01", 500_000], ["b|2026-01", 450_000], ["a|2025-12", 100_000], ["x|2026-01", 1]]),
  contratos: new Map([["a", "CONTRATO A"], ["b", "CONTRATO B"], ["c", "CONTRATO C"]]),
  ativos: 5,
};

describe("Painel Executivo pelo Faturamento da Empresa", () => {
  const d = painelPeloFaturamento(rpc, entrada);

  it("receita = líquido, custo = despesas, lucro e margem como na tela de Faturamento", () => {
    expect(d.dre).toEqual({ receita: 1_005_000, custo: 950_000, lucro: 55_000, margem: 5.47 });
    expect(d.dre_anterior).toEqual({ receita: 500_000, custo: 100_000, lucro: 400_000, margem: 80 });
  });

  it("nota cancelada e contrato fora do recorte não contam", () => {
    expect(d.dre?.receita).toBe(1_005_000);
  });

  it("situação por contrato no mês, com piso de R$ 10 mil", () => {
    expect(d.situacao).toEqual({ saudavel: 1, atencao: 0, critico: 1 });
    expect(d.situacao_detalhe?.contratos.critico?.[0]).toMatchObject({ nome: "CONTRATO B", margem: -12.5 });
    expect(d.situacao_detalhe?.abaixo_piso).toBe(1);
    expect(d.critico_anterior).toBe(0);
  });

  it("evolução: só meses com dado; os cards de nota NÃO vêm mais da RPC (10/11/2026)", () => {
    expect(d.serie.map((s) => s.competencia)).toEqual(["2025-12", "2026-01"]);
    expect(d.nf.recebido).toBe(0);
    expect(d.nf.saldo).toBe(1_005_000);
    expect(d.ultima_dre).toBe("2026-01");
  });

  it("mês sem nota nem despesa fica sem número", () => {
    const vazio = painelPeloFaturamento({ ...rpc, competencia: "2026-03" }, entrada);
    expect(vazio.dre).toBeNull();
    expect(vazio.situacao).toBeNull();
  });

  it("doze meses atravessam o ano", () => {
    expect(dozeMeses("2026-01")).toHaveLength(12);
    expect(dozeMeses("2026-01")[0]).toBe("2025-02");
  });
});
