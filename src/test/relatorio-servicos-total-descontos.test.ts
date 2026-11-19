import { describe, expect, it } from "vitest";
import { linhasDeDesconto, resumoDescontos, type ItemComDescontos, type NfParaTotais } from "@/pages/financeiro/relatorio-servicos/totais";

// SIS-2026-0952: KPI "Total de Descontos" do Relatório Geral e o detalhamento por tipo/classificação/contrato.
const nf = (o: Partial<NfParaTotais & { id: string; empresa_id: string; numero_nf: string }> = {}) => ({
  id: "n1", empresa_id: "e1", numero_nf: "100", data_emissao: "2026-09-10",
  contrato_id: "c1", competencia: "2026-09-01", tipo_nota: "N", status: "concluida", data_pagamento: null,
  valor_contrato_exec_total: 1000, vlr_bruto_total: 900, vlr_liquido_total: 800, valor_pago: 0, desconto_conta_vinculada: 50,
  ...o,
});
const item = (o: ItemComDescontos = {}): ItemComDescontos => ({
  faltas: 0, posto_nao_implementado: 0, multas: 0, glosas: 0, outros_descontos: 0,
  multas_pos_emissao: 0, glosas_pos_emissao: 0, outros_descontos_pos_emissao: 0, ...o,
});

describe("SIS-2026-0952 · descontos do Relatório de Serviços", () => {
  it("separa antes e após a NF por tipo, sem linha para valor zero", () => {
    const itens = new Map([["n1", [item({ faltas: 10, glosas: 20 }), item({ glosas_pos_emissao: 300, multas_pos_emissao: 5 })]]]);
    const l = linhasDeDesconto([nf()], itens);
    expect(l.map((x) => `${x.tipo}/${x.classificacao}=${x.valor}`).sort()).toEqual(["faltas/antes=10", "glosas/antes=20", "glosas/apos=300", "multas/apos=5"]);
  });

  it("conta vinculada não entra e nota cancelada fica de fora", () => {
    const itens = new Map([["n1", [item({ glosas: 20 })]], ["n2", [item({ glosas: 999 })]]]);
    const l = linhasDeDesconto([nf({ desconto_conta_vinculada: 5000 }), nf({ id: "n2", status: "cancelada" })], itens);
    expect(resumoDescontos(l).total).toBe(20);
  });

  it("agregados por tipo e por contrato batem com o total geral", () => {
    const itens = new Map([
      ["n1", [item({ glosas: 10.1, glosas_pos_emissao: 0.2 })]],
      ["n2", [item({ multas_pos_emissao: 100, outros_descontos: 7 })]],
      ["n3", [item({ posto_nao_implementado: 50 })]],
    ]);
    const r = resumoDescontos(linhasDeDesconto([nf(), nf({ id: "n2" }), nf({ id: "n3", contrato_id: "c2" })], itens));
    expect(r.total).toBe(167.3);
    expect(r.antes).toBe(67.1);
    expect(r.apos).toBe(100.2);
    expect(r.porTipo.reduce((s, t) => s + t.total, 0)).toBeCloseTo(r.total, 2);
    expect(r.porTipo.find((t) => t.tipo === "glosas")).toMatchObject({ antes: 10.1, apos: 0.2, total: 10.3 });
    expect(r.porContrato.map((c) => [c.contratoId, c.notas, c.total])).toEqual([["c1", 2, 117.3], ["c2", 1, 50]]);
  });

  it("nota sem itens carregados não gera linha", () => {
    expect(linhasDeDesconto([nf()], new Map())).toEqual([]);
    expect(linhasDeDesconto([nf()], undefined)).toEqual([]);
  });
});
