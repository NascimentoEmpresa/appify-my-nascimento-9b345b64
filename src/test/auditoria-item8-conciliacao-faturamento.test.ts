import { describe, expect, it } from "vitest";
import type { NfEmissaoItemRow, NfEmissaoRow } from "@/hooks/useNfEmissao";
import { conciliar, type ContratoParaConciliacao } from "@/pages/financeiro/conciliacao-servicos/regras";
import { linksDoCard, situacaoComparacao, totaisConciliacaoFaturamento, valoresMudaramDesdeDecisao, VALIDACOES } from "@/pages/controladoria/auditoria/regras";

// SIS-2026-0874: item 8 da Auditoria da Controladoria — Relatório de Serviços × Faturamento da Empresa (conciliação do SIS-2026-0869).
const nf = (o: Partial<NfEmissaoRow> & { id: string }): NfEmissaoRow => ({
  empresa_id: "e1", contrato_id: "c1", competencia: "2026-01-01", tipo_nota: "N", status: "concluida", data_pagamento: null,
  numero_nf: o.id, variacao: null, valor_contrato_exec_total: 1000, vlr_bruto_total: 1000, vlr_liquido_total: 900, valor_pago: 0,
  desconto_conta_vinculada: 0, descontos_pos_emissao_total: 0, contrato: { id: "c1", nome: "UFRGS", cliente: "UFRGS" },
  ...o,
} as unknown as NfEmissaoRow);
const contratos = new Map<string, ContratoParaConciliacao>([["c1", { id: "c1", empresa_id: "e1", nome: "UFRGS", cliente: "UFRGS" }]]);
const filtros = { ano: 2026, competencia: "2026-01", empresaId: "", contratoId: "", cliente: "", codigo: "N", situacao: "" as const };
const itens = new Map<string, NfEmissaoItemRow[]>();

describe("SIS-2026-0874 · item 8 (Conciliação do Faturamento de Notas)", () => {
  it("está no catálogo como número 8, comparação 'igual', e leva às duas telas de origem", () => {
    const def = VALIDACOES.find((v) => v.tipo === "conciliacao_faturamento")!;
    expect(def.numero).toBe(8);
    expect(def.comparacao).toBe("igual");
    expect(linksDoCard("conciliacao_faturamento", "2026-01", null).map((l) => l.rotulo)).toEqual(["Relatório de Serviços", "Faturamento da Empresa"]);
  });

  it("telas que concordam: conciliado, sem diferença", () => {
    const t = totaisConciliacaoFaturamento(conciliar({ nfs: [nf({ id: "1" })], itensPorNf: itens, contratoPorId: contratos, filtros }));
    expect(t.painel?.kind).toBe("conciliacao_faturamento");
    if (t.painel?.kind !== "conciliacao_faturamento") return;
    expect(t.painel.conciliado).toBe(true);
    expect(t.painel.diferencas).toEqual({ bruto: 0, liquido: 0, recebido: 0, pendente: 0 });
    expect(situacaoComparacao(VALIDACOES[7], t)).toBe("confere");
    expect(t.painel.maioresDivergencias).toEqual([]);
  });

  it("NF de contrato fora do cadastro: diferença no bruto (Relatório maior), motivo e situação 'diverge'", () => {
    const nfs = [nf({ id: "1" }), nf({ id: "2", contrato_id: "c9", contrato: { id: "c9", nome: "ORFAO", cliente: "X" } })];
    const t = totaisConciliacaoFaturamento(conciliar({ nfs, itensPorNf: itens, contratoPorId: contratos, filtros }));
    if (t.painel?.kind !== "conciliacao_faturamento") throw new Error("painel");
    expect(t.painel.relatorio.bruto).toBe(2000);
    expect(t.painel.faturamento.bruto).toBe(1000);
    expect(t.painel.diferencas.bruto).toBe(1000);
    expect(t.painel.conciliado).toBe(false);
    expect(situacaoComparacao(VALIDACOES[7], t)).toBe("diverge");
    expect(t.painel.notasDivergentes).toBe(1);
    expect(t.painel.maioresDivergencias[0]).toMatchObject({ numero: "2", contratoNome: "ORFAO" });
    expect(t.painel.maioresDivergencias[0].motivo).toMatch(/não existe no cadastro/);
  });

  it("diferenças que se compensam em indicadores diferentes não escondem a divergência (a soma a/b é só o carimbo)", () => {
    const t = totaisConciliacaoFaturamento(conciliar({ nfs: [nf({ id: "1", valor_pago: 800, data_pagamento: "2026-02-10" })], itensPorNf: itens, contratoPorId: contratos, filtros }));
    if (t.painel?.kind !== "conciliacao_faturamento") throw new Error("painel");
    expect(t.painel.diferencas.pendente).toBe(100);
    expect(t.painel.conciliado).toBe(false);
    // o carimbo da aprovação muda quando qualquer um dos quatro indicadores muda
    expect(valoresMudaramDesdeDecisao({ a: t.a, b: t.b }, t)).toBe(false);
    expect(valoresMudaramDesdeDecisao({ a: t.a, b: t.b - 100 }, t)).toBe(true);
  });

  it("limita a lista às 5 maiores divergências, da maior para a menor", () => {
    const nfs = Array.from({ length: 7 }, (_, i) => nf({ id: String(i + 1), contrato_id: "c9", contrato: { id: "c9", nome: "ORFAO", cliente: "X" }, vlr_bruto_total: 100 * (i + 1), vlr_liquido_total: 90 * (i + 1) }));
    const t = totaisConciliacaoFaturamento(conciliar({ nfs, itensPorNf: itens, contratoPorId: contratos, filtros }));
    if (t.painel?.kind !== "conciliacao_faturamento") throw new Error("painel");
    expect(t.painel.notasDivergentes).toBe(7);
    expect(t.painel.maioresDivergencias).toHaveLength(5);
    expect(t.painel.maioresDivergencias.map((n) => n.numero)).toEqual(["7", "6", "5", "4", "3"]);
  });
});
