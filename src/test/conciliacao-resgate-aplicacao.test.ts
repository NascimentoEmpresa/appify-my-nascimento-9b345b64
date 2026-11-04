import { describe, expect, it } from "vitest";
import type { FluxoCaixaMaloteLinha } from "@/hooks/useFluxoCaixaMalote";
import { linhasDoFluxoParaConciliacao, processarConciliacao } from "@/lib/conciliacaoCalculo";
import type { OFXTransaction } from "@/lib/conciliacaoBancariaEngine";

// SIS-2026-0778: o resgate de Aplicação Financeira (entrada no Fluxo) saía do Fluxo com banco_id nulo, então a conciliação do banco nunca o via do lado do
// Fluxo e o crédito do extrato virava divergência. Com o banco gravado no resgate, ele entra na conciliação e fecha com o extrato.
const resgate = (o: Partial<FluxoCaixaMaloteLinha> = {}): FluxoCaixaMaloteLinha =>
  ({
    despesa_id: "r1", id_malote: "RG-2026-0001", data_pagamento: "2026-10-15", competencia: "2026-10-01", empresa_id: "HAGG", empresa_nome: "HAGG",
    contrato_id: null, contrato_nome: null, classificacao_id: "k1", classificacao_nome: "Aplicação Financeira", descricao: "Resgate de Aplicação Financeira",
    forma_pagamento: null, banco_id: "sicredi", banco_nome: "Sicredi", banco_logo_path: null, numero_parcela: null, numero_parcelas: null,
    valor: 50250.8, tipo: "entrada", origem: "aplicacao_financeira", ajustado: false, ...o,
  }) as FluxoCaixaMaloteLinha;

const escopo = { bancoId: "sicredi", todasEmpresas: false, empresaIds: ["HAGG"], dataDe: "2026-10-01", dataAte: "2026-10-31" };
const extrato: OFXTransaction[] = [{ dia: "2026-10-15", valor: 50250.8, tipo: "ENTRADA", memo: "RESGATE APLICACAO", origem: "SICREDI" }];

describe("conciliação × resgate de aplicação financeira", () => {
  it("sem banco no resgate ele não entra no lado Fluxo da conciliação do banco (a causa do chamado)", () => {
    expect(linhasDoFluxoParaConciliacao([resgate({ banco_id: null, banco_nome: null })], escopo)).toEqual([]);
  });

  it("com o banco gravado o resgate entra no lado Fluxo da conciliação do banco certo", () => {
    expect(linhasDoFluxoParaConciliacao([resgate()], escopo)).toHaveLength(1);
    expect(linhasDoFluxoParaConciliacao([resgate()], { ...escopo, bancoId: "outro" })).toEqual([]);
  });

  it("o resgate com banco fecha com o crédito do extrato (sem divergência)", () => {
    const r = processarConciliacao({
      linhasDoBancoEmpresa: linhasDoFluxoParaConciliacao([resgate()], escopo),
      trns: extrato, dataDe: escopo.dataDe, dataAte: escopo.dataAte, saldoExtrato: null, bancoNome: "Sicredi",
    });
    expect(r.resultado.lancamentos).toEqual([]);
  });

  it("sem o resgate do lado Fluxo, o crédito do extrato vira divergência", () => {
    const r = processarConciliacao({
      linhasDoBancoEmpresa: linhasDoFluxoParaConciliacao([resgate({ banco_id: null })], escopo),
      trns: extrato, dataDe: escopo.dataDe, dataAte: escopo.dataAte, saldoExtrato: null, bancoNome: "Sicredi",
    });
    expect(r.resultado.lancamentos.length).toBeGreaterThan(0);
  });
});
