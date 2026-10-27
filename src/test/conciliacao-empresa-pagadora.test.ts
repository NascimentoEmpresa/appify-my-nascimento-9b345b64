import { describe, expect, it } from "vitest";
import type { FluxoCaixaMaloteLinha } from "@/hooks/useFluxoCaixaMalote";
import { aplicarEmpresaPagadora, mapaEmpresaPagadora } from "@/lib/conciliacaoEmpresaPagadora";
import { linhasDoFluxoParaConciliacao, processarConciliacao } from "@/lib/conciliacaoCalculo";

const l = (o: Partial<FluxoCaixaMaloteLinha>): FluxoCaixaMaloteLinha =>
  ({
    despesa_id: "d1", id_malote: "DM-2026-0733", data_pagamento: "2026-09-21", competencia: "2026-09-01", empresa_id: "HAGG", empresa_nome: "HAGG",
    contrato_id: null, contrato_nome: null, classificacao_id: null, classificacao_nome: "Uniforme", descricao: "RUVERIM", forma_pagamento: "Boleto",
    banco_id: "b1", banco_nome: "Banrisul", banco_logo_path: null, numero_parcela: null, numero_parcelas: null, valor: 100, tipo: "saida", origem: "malote", ajustado: false, ...o,
  }) as FluxoCaixaMaloteLinha;

// Boleto de 821,60 = 742,60 (HAGG) + 79,00 (NH), pago pela HAGG.
const fluxo = [l({ empresa_id: "HAGG", empresa_nome: "HAGG", valor: 742.6 }), l({ empresa_id: "NH", empresa_nome: "NH", valor: 79 })];
const nomes = new Map([["HAGG", "HAGG"], ["NH", "NH"]]);
const escopo = (empresaId: string) => ({ bancoId: "b1", todasEmpresas: false, empresaIds: [empresaId], dataDe: "2026-09-01", dataAte: "2026-09-30" });
const extratoHagg = [{ dia: "2026-09-21", valor: 821.6, tipo: "SAÍDA", memo: "BOLETO", origem: "Banrisul" }] as const as any;

describe("conciliação — empresa que pagou a despesa rateada", () => {
  const pagadora = mapaEmpresaPagadora([{ origem: "malote", despesa_id: "d1", numero_parcela: null, empresa_pagadora_id: "HAGG" }]);

  it("sem marcação nada muda", () => {
    expect(aplicarEmpresaPagadora(fluxo, new Map(), nomes)).toBe(fluxo);
  });

  it("a fatia da NH passa a ser da HAGG e some da conciliação da NH", () => {
    const linhas = aplicarEmpresaPagadora(fluxo, pagadora, nomes);
    expect(linhasDoFluxoParaConciliacao(linhas, escopo("NH"))).toEqual([]);
    expect(linhasDoFluxoParaConciliacao(linhas, escopo("HAGG"))).toHaveLength(2);
  });

  it("na conciliação da HAGG a despesa fecha pelo total do extrato", () => {
    const linhas = aplicarEmpresaPagadora(fluxo, pagadora, nomes);
    const r = processarConciliacao({
      linhasDoBancoEmpresa: linhasDoFluxoParaConciliacao(linhas, escopo("HAGG")),
      trns: extratoHagg, dataDe: "2026-09-01", dataAte: "2026-09-30", saldoExtrato: null, bancoNome: "Banrisul",
    });
    expect(r.resultado.lancamentos).toEqual([]);
  });

  it("marcação por parcela vale só para aquela parcela, e a da despesa inteira vale para todas", () => {
    const p = [l({ numero_parcela: 1, empresa_id: "NH" }), l({ numero_parcela: 2, empresa_id: "NH" })];
    const m = mapaEmpresaPagadora([{ origem: "malote", despesa_id: "d1", numero_parcela: 2, empresa_pagadora_id: "HAGG" }]);
    expect(aplicarEmpresaPagadora(p, m, nomes).map((x) => x.empresa_id)).toEqual(["NH", "HAGG"]);
    expect(aplicarEmpresaPagadora(p, pagadora, nomes).map((x) => x.empresa_id)).toEqual(["HAGG", "HAGG"]);
  });
});
