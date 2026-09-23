import { describe, it, expect } from "vitest";
import { reconciliar, type OFXTransaction, type PlanilhaRow } from "@/lib/conciliacaoBancariaEngine";
import { linhasFluxoParaPlanilhaRow } from "@/hooks/useConciliacaoFluxoCaixa";
import type { FluxoCaixaMaloteLinha } from "@/hooks/useFluxoCaixaMalote";

// SIS-2026-0492: a conciliação automática precisa rastrear despesaId/
// numeroParcela/origemFluxo de volta pro lançamento real (pra "Ajustar"
// funcionar) — testa que essa informação sobrevive ao motor de diff nos 3
// tipos de divergência que envolvem o lado Fluxo, e que o adaptador
// Fluxo→PlanilhaRow preenche esses campos corretamente.
describe("linhasFluxoParaPlanilhaRow", () => {
  it("mapeia FluxoCaixaMaloteLinha pra PlanilhaRow preservando despesaId/numeroParcela/origem", () => {
    const linha: FluxoCaixaMaloteLinha = {
      despesa_id: "d1",
      id_malote: "SD-2026-0001",
      data_pagamento: "2026-09-10",
      competencia: "2026-09-01",
      empresa_id: "e1",
      empresa_nome: "Empresa X",
      contrato_id: null,
      contrato_nome: null,
      classificacao_id: null,
      classificacao_nome: null,
      descricao: "Aluguel",
      forma_pagamento: "Pix",
      banco_id: "b1",
      banco_nome: "Bradesco",
      banco_logo_path: null,
      numero_parcela: 2,
      numero_parcelas: 3,
      valor: 1500.5,
      tipo: "saida",
      origem: "malote",
      ajustado: false,
    };
    const [row] = linhasFluxoParaPlanilhaRow([linha]);
    expect(row).toMatchObject({
      dia: "2026-09-10",
      valor: 1500.5,
      tipo: "SAÍDA",
      banco: "Bradesco",
      despesaId: "d1",
      numeroParcela: 2,
      origemFluxo: "malote",
    });
  });
});

describe("reconciliar — rastreio de despesaId/origemFluxo nas divergências", () => {
  const planRows: PlanilhaRow[] = [
    { dia: "2026-09-10", valor: 1000, tipo: "SAÍDA", banco: "Bradesco", despesaId: "d1", numeroParcela: null, origemFluxo: "malote" },
  ];

  it("VALOR SIMILAR carrega despesaId/origemFluxo da linha do Fluxo", () => {
    const ofx: OFXTransaction[] = [{ dia: "2026-09-10", valor: 998, tipo: "SAÍDA", memo: "PAGAMENTO", origem: "bradesco.ofx" }];
    const res = reconciliar(planRows, ofx);
    const div = res.lancamentos.find((l) => l.erro === "🔍 VALOR SIMILAR");
    expect(div).toBeDefined();
    expect(div?.despesaId).toBe("d1");
    expect(div?.origemFluxo).toBe("malote");
  });

  it("BANCO - NÃO ENCONTRADO (fluxo sem par no extrato) carrega despesaId/origemFluxo", () => {
    const res = reconciliar(planRows, []);
    const div = res.lancamentos.find((l) => l.erro === "⚠️ BANCO - NÃO ENCONTRADO");
    expect(div).toBeDefined();
    expect(div?.despesaId).toBe("d1");
    expect(div?.origemFluxo).toBe("malote");
  });

  it("FLUXO - NÃO ENCONTRADO (extrato sem par no fluxo) não tem despesaId — é candidato a 'Criar lançamento'", () => {
    const ofx: OFXTransaction[] = [{ dia: "2026-09-11", valor: 300, tipo: "ENTRADA", memo: "PIX RECEBIDO", origem: "bradesco.ofx" }];
    const res = reconciliar([], ofx);
    const div = res.lancamentos.find((l) => l.erro === "🚨 FLUXO - NÃO ENCONTRADO");
    expect(div).toBeDefined();
    expect(div?.despesaId).toBeUndefined();
  });

  it("ids de lançamento são estáveis por conteúdo (não por índice)", () => {
    const res1 = reconciliar(planRows, []);
    const res2 = reconciliar(planRows, []);
    expect(res1.lancamentos[0].id).toBe(res2.lancamentos[0].id);
  });
});
