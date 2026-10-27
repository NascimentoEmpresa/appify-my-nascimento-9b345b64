import { describe, expect, it } from "vitest";
import { reconciliar } from "@/lib/conciliacaoBancariaEngine";
import { linhasFluxoParaPlanilhaRow } from "@/hooks/useConciliacaoFluxoCaixa";
import { incluirRateioPagoPorUmaConta, linhasDoFluxoParaConciliacao, processarConciliacao, separarRateioDeOutraConta } from "@/lib/conciliacaoCalculo";
import type { FluxoCaixaMaloteLinha } from "@/hooks/useFluxoCaixaMalote";

// Conciliação Bancária: a divergência "consta no Fluxo, não caiu no extrato" aponta para o ID do lançamento no Fluxo de Caixa.
const L = (extra: Partial<FluxoCaixaMaloteLinha>): FluxoCaixaMaloteLinha =>
  ({
    despesa_id: "d1", id_malote: "IMP-04715", data_pagamento: "2026-09-21", competencia: "2026-09-01", empresa_id: "nh", empresa_nome: "NH",
    contrato_id: null, contrato_nome: null, classificacao_id: null, classificacao_nome: "LUZ", descricao: "CEE - LUZ", forma_pagamento: "PIX",
    banco_id: "b1", banco_nome: "Banrisul", banco_logo_path: null, numero_parcela: null, numero_parcelas: null, valor: 79, tipo: "saida",
    origem: "importacao_historica", ajustado: false, ...extra,
  }) as FluxoCaixaMaloteLinha;

describe("ID do lançamento do Fluxo na divergência", () => {
  it("a linha do Fluxo leva o ID e a descrição para o resultado da conciliação", () => {
    const plan = linhasFluxoParaPlanilhaRow([L({})]);
    const r = reconciliar(plan, []);
    expect(r.lancamentos).toHaveLength(1);
    expect(r.lancamentos[0]).toMatchObject({ erro: "⚠️ BANCO - NÃO ENCONTRADO", valor: 79, idMalote: "IMP-04715", descricaoFluxo: "CEE - LUZ", partes: 1 });
  });

  it("rateio da mesma despesa é somado numa linha só, com o mesmo ID e a contagem das partes", () => {
    const plan = linhasFluxoParaPlanilhaRow([L({ valor: 20 }), L({ valor: 30 }), L({ valor: 29 })]);
    expect(plan).toHaveLength(1);
    const r = reconciliar(plan, []);
    expect(r.lancamentos[0]).toMatchObject({ valor: 79, idMalote: "IMP-04715", partes: 3 });
  });

  // DM-2026-0733: boleto de R$ 821,60 rateado 79,00 (fatia de uma empresa) + 742,60 (fatia de outra), pago inteiro por UMA conta.
  describe("rateio entre empresas pago de uma conta só", () => {
    const fatiaNH = L({ despesa_id: "dm0733", id_malote: "DM-2026-0733", empresa_id: "nh", empresa_nome: "NH", valor: 79, origem: "malote" });
    const fatiaHAGG = L({ despesa_id: "dm0733", id_malote: "DM-2026-0733", empresa_id: "hagg", empresa_nome: "HAGG", valor: 742.6, origem: "malote" });
    const doBanco = [fatiaNH, fatiaHAGG];
    const escopo = (empresa: string) => ({ bancoId: "b1", todasEmpresas: false, empresaIds: [empresa], dataDe: "2026-09-01", dataAte: "2026-09-30" });
    const trn = (valor: number) => ({ dia: "2026-09-21", valor, tipo: "SAÍDA" as const });

    it("o extrato da conta que pagou traz o total: a conciliação dela compara 821,60 e fecha", () => {
      const daEmpresa = linhasDoFluxoParaConciliacao(doBanco, escopo("hagg"));
      expect(daEmpresa).toHaveLength(1); // só a fatia de 742,60
      const linhas = incluirRateioPagoPorUmaConta(daEmpresa, doBanco, [trn(821.6)]);
      const plan = linhasFluxoParaPlanilhaRow(linhas);
      expect(plan).toHaveLength(1);
      expect(plan[0]).toMatchObject({ valor: 821.6, partes: 2, idMalote: "DM-2026-0733" });
      expect(reconciliar(plan, [{ ...trn(821.6), memo: "BOLETO", origem: "hagg.ofx" }]).lancamentos).toHaveLength(0);
    });

    it("o extrato não tem o total: vale só a fatia da empresa, como sempre foi (a fatia sem par aparece como divergência)", () => {
      const daEmpresa = linhasDoFluxoParaConciliacao(doBanco, escopo("nh"));
      expect(incluirRateioPagoPorUmaConta(daEmpresa, doBanco, [trn(10)])).toEqual(daEmpresa);
      expect(incluirRateioPagoPorUmaConta(daEmpresa, doBanco, [])).toEqual(daEmpresa);
    });

    it("a fatia da empresa tem o próprio valor no extrato (pagou sozinha): não puxa o total", () => {
      const daEmpresa = linhasDoFluxoParaConciliacao(doBanco, escopo("hagg"));
      expect(incluirRateioPagoPorUmaConta(daEmpresa, doBanco, [trn(742.6), trn(821.6)])).toEqual(daEmpresa);
    });

    it("rateio todo dentro da empresa e despesas de uma empresa só ficam intactos", () => {
      const sozinha = [L({ despesa_id: "x", empresa_id: "nh", valor: 30, origem: "malote" }), L({ despesa_id: "x", empresa_id: "nh", valor: 20, origem: "malote" })];
      expect(incluirRateioPagoPorUmaConta(sozinha, sozinha, [trn(50)])).toEqual(sozinha);
    });

    // SIS-2026-0736: a conciliação lê o total; fatia de despesa paga por outra conta não é pendência.
    describe("total da despesa rateada (escopo parcial)", () => {
      it("o total não está no extrato da NH nem a fatia: a fatia sai da comparação e vira aviso, sem divergência", () => {
        const daEmpresa = linhasDoFluxoParaConciliacao(doBanco, escopo("nh"));
        const r = separarRateioDeOutraConta(daEmpresa, doBanco, [trn(10)]);
        expect(r.linhas).toEqual([]);
        expect(r.informativas).toEqual([
          { idMalote: "DM-2026-0733", descricao: "CEE - LUZ", dia: "2026-09-21", tipo: "saida", total: 821.6, daEmpresa: 79, empresas: ["NH", "HAGG"] },
        ]);
        const p = processarConciliacao({ linhasDoBancoEmpresa: daEmpresa, linhasDoBancoTodasEmpresas: doBanco, trns: [], dataDe: "2026-09-01", dataAte: "2026-09-30", saldoExtrato: null, bancoNome: "Banrisul" });
        expect(p.resultado.lancamentos).toHaveLength(0);
        expect(p.rateiosDeOutraConta).toHaveLength(1);
      });

      it("a fatia da NH tem o próprio valor no extrato dela: foi paga por ela, segue normal", () => {
        const daEmpresa = linhasDoFluxoParaConciliacao(doBanco, escopo("nh"));
        const r = separarRateioDeOutraConta(daEmpresa, doBanco, [trn(79)]);
        expect(r.linhas).toEqual(daEmpresa);
        expect(r.informativas).toEqual([]);
      });

      it("o total está no extrato da HAGG: entra inteiro, sem aviso", () => {
        const daEmpresa = linhasDoFluxoParaConciliacao(doBanco, escopo("hagg"));
        const comTotal = incluirRateioPagoPorUmaConta(daEmpresa, doBanco, [trn(821.6)]);
        const r = separarRateioDeOutraConta(comTotal, doBanco, [trn(821.6)]);
        expect(r.linhas).toHaveLength(2);
        expect(r.informativas).toEqual([]);
      });

      it("escopo que cobre todas as empresas do rateio: total fora do extrato é pendência de verdade", () => {
        const todas = { ...escopo("nh"), empresaIds: ["nh", "hagg"] };
        const daEmpresa = linhasDoFluxoParaConciliacao(doBanco, todas);
        const r = separarRateioDeOutraConta(daEmpresa, doBanco, []);
        expect(r.linhas).toEqual(daEmpresa);
        expect(r.informativas).toEqual([]);
        const p = processarConciliacao({ linhasDoBancoEmpresa: daEmpresa, linhasDoBancoTodasEmpresas: doBanco, trns: [], dataDe: "2026-09-01", dataAte: "2026-09-30", saldoExtrato: null, bancoNome: "Banrisul" });
        expect(p.resultado.lancamentos).toHaveLength(1);
        expect(p.resultado.lancamentos[0]).toMatchObject({ valor: 821.6, partes: 2 });
      });
    });
  });

  it("linha só do extrato não tem ID do Fluxo", () => {
    const r = reconciliar([], [{ dia: "2026-09-21", valor: 10, tipo: "SAÍDA", memo: "TARIFA", origem: "a.ofx" }]);
    expect(r.lancamentos[0].idMalote).toBeUndefined();
  });
});

// Botão "Usar o mês" do conciliador: competência → primeiro e último dia.
import { periodoDoMes } from "@/lib/conciliacaoCalculo";
describe("periodoDoMes", () => {
  it("do dia 1 ao último dia do mês, inclusive fevereiro e ano bissexto", () => {
    expect(periodoDoMes("2026-10")).toEqual({ de: "2026-10-01", ate: "2026-10-31" });
    expect(periodoDoMes("2026-09")).toEqual({ de: "2026-09-01", ate: "2026-09-30" });
    expect(periodoDoMes("2026-02")).toEqual({ de: "2026-02-01", ate: "2026-02-28" });
    expect(periodoDoMes("2028-02")).toEqual({ de: "2028-02-01", ate: "2028-02-29" });
  });
  it("mês vazio ou inválido não gera período", () => {
    expect(periodoDoMes("")).toBeNull();
    expect(periodoDoMes("2026-13")).toBeNull();
    expect(periodoDoMes("10/2026")).toBeNull();
  });
});
