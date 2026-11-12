import { describe, expect, it } from "vitest";
import type { NfEmissaoItemRow, NfEmissaoRow } from "@/hooks/useNfEmissao";
import { conciliar, somaPorFonte, type ContratoParaConciliacao, type FiltrosConciliacao } from "@/pages/financeiro/conciliacao-servicos/regras";

// SIS-2026-0869: a conciliação compara Relatório Geral × Dashboard × Faturamento da Empresa sobre as mesmas NFs.
const nf = (o: Partial<NfEmissaoRow> & { id: string }): NfEmissaoRow => ({
  empresa_id: "e1", contrato_id: "c1", competencia: "2026-03-01", tipo_nota: "N", status: "concluida", data_pagamento: null,
  numero_nf: o.id, variacao: null, valor_contrato_exec_total: 1000, vlr_bruto_total: 1000, vlr_liquido_total: 900, valor_pago: 0,
  desconto_conta_vinculada: 0, descontos_pos_emissao_total: 0, contrato: { id: "c1", nome: "UFRGS", cliente: "UFRGS" },
  ...o,
} as unknown as NfEmissaoRow);

const contratos = new Map<string, ContratoParaConciliacao>([["c1", { id: "c1", empresa_id: "e1", nome: "UFRGS", cliente: "UFRGS" }]]);
const filtros: FiltrosConciliacao = { ano: 2026, competencia: "", empresaId: "", contratoId: "", cliente: "", codigo: "N", situacao: "" };
const itensVazios = new Map<string, NfEmissaoItemRow[]>();

describe("SIS-2026-0869 · conciliação financeira do Relatório de Serviços", () => {
  it("telas que concordam: tudo conciliado, nenhuma NF divergente", () => {
    const r = conciliar({ nfs: [nf({ id: "1" }), nf({ id: "2", vlr_bruto_total: 500, vlr_liquido_total: 450, valor_pago: 450, data_pagamento: "2026-04-10" })], itensPorNf: itensVazios, contratoPorId: contratos, filtros });
    expect(r.indicadores.every((i) => i.conciliado)).toBe(true);
    expect(r.resumo.notasDivergentes).toBe(0);
    expect(r.resumo.notasAvaliadas).toBe(2);
    expect(r.resumo.diferencaTotal).toBe(0);
  });

  it("NF paga com valor pago menor que o líquido: Relatório/Dashboard têm saldo, Faturamento zera", () => {
    const r = conciliar({ nfs: [nf({ id: "1", valor_pago: 800, data_pagamento: "2026-04-10" })], itensPorNf: itensVazios, contratoPorId: contratos, filtros });
    const pend = r.indicadores.find((i) => i.id === "pendente")!;
    expect(pend.valores.geral).toBe(100);
    expect(pend.valores.dashboard).toBe(100);
    expect(pend.valores.faturamento).toBe(0);
    expect(pend.conciliado).toBe(false);
    expect(pend.destoantes).toEqual(["faturamento"]);
    expect(r.notas[0].divergente).toBe(true);
    expect(r.notas[0].motivos[0]).toMatch(/paga/i);
    // bruto, líquido e recebido seguem conciliados
    expect(r.indicadores.filter((i) => i.conciliado).map((i) => i.id)).toEqual(["bruto", "liquido", "recebido"]);
  });

  it("NF de contrato fora do cadastro entra no Relatório mas não no Faturamento da Empresa", () => {
    const r = conciliar({ nfs: [nf({ id: "1" }), nf({ id: "2", contrato_id: "c9", contrato: { id: "c9", nome: "ORFAO", cliente: "X" } })], itensPorNf: itensVazios, contratoPorId: contratos, filtros });
    const bruto = r.indicadores.find((i) => i.id === "bruto")!;
    expect(bruto.valores).toEqual({ geral: 2000, dashboard: 2000, faturamento: 1000 });
    const orfa = r.notas.find((n) => n.id === "2")!;
    expect(orfa.divergente).toBe(true);
    expect(orfa.motivos[0]).toMatch(/não existe no cadastro/);
  });

  it("descontos pós-emissão no cabeçalho diferentes dos itens aparecem como motivo", () => {
    const itens = new Map<string, NfEmissaoItemRow[]>([["1", [{ multas_pos_emissao: 50, glosas_pos_emissao: 0, outros_descontos_pos_emissao: 0 } as NfEmissaoItemRow]]]);
    const r = conciliar({ nfs: [nf({ id: "1", descontos_pos_emissao_total: 0 })], itensPorNf: itens, contratoPorId: contratos, filtros });
    expect(r.notas[0].difTotal).toBe(50);
    expect(r.notas[0].motivos[0]).toMatch(/pós-emissão/);
  });

  it("cancelada/substituída não entra em valor nenhum nem na lista de divergências", () => {
    const r = conciliar({ nfs: [nf({ id: "1" }), nf({ id: "2", status: "cancelada", data_pagamento: "2026-04-01" })], itensPorNf: itensVazios, contratoPorId: contratos, filtros });
    expect(r.resumo.notasAvaliadas).toBe(1);
    expect(r.indicadores.find((i) => i.id === "bruto")!.valores.geral).toBe(1000);
  });

  it("o fechamento por NF soma exatamente os agregados de cada tela", () => {
    const nfs = [
      nf({ id: "1", valor_pago: 800, data_pagamento: "2026-04-10" }),
      nf({ id: "2", competencia: "2026-04-01", vlr_bruto_total: 333.33, vlr_liquido_total: 300.11, valor_pago: 100.05 }),
      nf({ id: "3", contrato_id: "c9", contrato: { id: "c9", nome: "ORFAO", cliente: "X" } }),
    ];
    const r = conciliar({ nfs, itensPorNf: itensVazios, contratoPorId: contratos, filtros });
    const somas = somaPorFonte(r.notas);
    for (const ind of r.indicadores) {
      expect(somas.geral[ind.id]).toBeCloseTo(ind.valores.geral, 2);
      expect(somas.dashboard[ind.id]).toBeCloseTo(ind.valores.dashboard, 2);
      expect(somas.faturamento[ind.id]).toBeCloseTo(ind.valores.faturamento, 2);
    }
  });

  it("filtros: ano, competência, código e empresa recortam as três telas igualmente", () => {
    const nfs = [nf({ id: "1" }), nf({ id: "2", competencia: "2025-03-01" }), nf({ id: "3", tipo_nota: "R" }), nf({ id: "4", empresa_id: "e2" })];
    expect(conciliar({ nfs, itensPorNf: itensVazios, contratoPorId: contratos, filtros }).resumo.notasAvaliadas).toBe(2);
    expect(conciliar({ nfs, itensPorNf: itensVazios, contratoPorId: contratos, filtros: { ...filtros, codigo: "" } }).resumo.notasAvaliadas).toBe(3);
    // NF 4 é da empresa e2 mas o contrato é da e1: o Relatório (empresa da NF) a exclui e o Faturamento (empresa do contrato) a inclui — divergência real.
    const r = conciliar({ nfs, itensPorNf: itensVazios, contratoPorId: contratos, filtros: { ...filtros, competencia: "2026-03", empresaId: "e1" } });
    expect(r.resumo.notasAvaliadas).toBe(2);
    expect(r.notas.filter((n) => n.divergente).map((n) => n.id)).toEqual(["4"]);
    expect(r.notas[0].motivos[0]).toMatch(/empresa/i);
  });

  it("agrupa a diferença por competência e por contrato", () => {
    const nfs = [nf({ id: "1", valor_pago: 800, data_pagamento: "2026-04-10" }), nf({ id: "2", competencia: "2026-04-01", valor_pago: 850, data_pagamento: "2026-05-10" })];
    const r = conciliar({ nfs, itensPorNf: itensVazios, contratoPorId: contratos, filtros });
    expect(r.porCompetencia.map((g) => [g.chave, g.difTotal])).toEqual([["2026-03", 100], ["2026-04", 50]]);
    expect(r.porContrato).toHaveLength(1);
    expect(r.porContrato[0].difTotal).toBe(150);
  });
});
