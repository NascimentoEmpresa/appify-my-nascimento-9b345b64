import { describe, expect, it } from "vitest";
import { totaisDeMovimentacao, totaisDeSaldos, type LinhaParaTotais, type SaldoMensal } from "@/lib/conciliacaoDashboard";

const S = (o: Partial<SaldoMensal>): SaldoMensal => ({
  chave: "x", empresaId: "A", bancoId: "b1", conta: "", mes: "2026-01", entradas: 0, saidas: 0, saldoSistema: 100, saldoExtrato: 100, diferenca: 0, confere: "sim", conciliacaoId: "c", ...o,
});

describe("SIS-2026-0724 — totais de saldo final (sistema × extrato)", () => {
  it("vale o último mês conferido de cada empresa/banco, somado entre eles (saldo é acumulado: não soma os meses)", () => {
    const r = totaisDeSaldos([
      S({ mes: "2026-01", saldoSistema: 190.16, saldoExtrato: 111.16, diferenca: 79, confere: "nao" }),
      S({ mes: "2026-02", saldoSistema: 214.3, saldoExtrato: 214.3 }),
      S({ empresaId: "B", mes: "2026-01", saldoSistema: 50, saldoExtrato: 40, diferenca: 10, confere: "nao" }),
    ]);
    expect(r).toEqual({ sistema: 264.3, extrato: 254.3, diferenca: 10, grupos: 2, divergentes: 1, semConferencia: 0 });
  });

  it("mês sem saldo do extrato não conta: usa o último mês que tem os dois", () => {
    const r = totaisDeSaldos([
      S({ mes: "2026-01", saldoSistema: 10, saldoExtrato: 10 }),
      S({ mes: "2026-02", saldoSistema: 30, saldoExtrato: null, diferenca: null, confere: "pendente", conciliacaoId: null }),
    ]);
    expect(r).toMatchObject({ sistema: 10, extrato: 10, diferenca: 0, grupos: 1 });
  });

  it("grupo sem nenhum mês conferido fica de fora e é contado; sem nada conferido, tudo zera", () => {
    const sem = S({ empresaId: "C", saldoExtrato: null, diferenca: null, confere: "pendente" });
    expect(totaisDeSaldos([S({}), sem])).toMatchObject({ sistema: 100, extrato: 100, grupos: 1, semConferencia: 1 });
    expect(totaisDeSaldos([sem])).toEqual({ sistema: 0, extrato: 0, diferenca: 0, grupos: 0, divergentes: 0, semConferencia: 1 });
  });

  it("Sistema − Extrato = Diferença (sem erro de centavo)", () => {
    const r = totaisDeSaldos([S({ saldoSistema: 0.3, saldoExtrato: 0.1, diferenca: 0.2, confere: "nao" }), S({ empresaId: "B", saldoSistema: 0.2, saldoExtrato: 0.2 })]);
    expect(r.diferenca).toBe(0.2);
  });
});

const l = (o: Partial<LinhaParaTotais>): LinhaParaTotais => ({
  despesa_id: "d" + Math.random(), numero_parcela: null, empresa_id: "A", banco_id: "b1", data_pagamento: "2026-01-10", tipo: "saida", valor: 100, ...o,
});
const hoje = "2026-10-26";
const todos = { dataDe: "", dataAte: "", empresaId: null, bancoId: null };

describe("SIS-2026-0736 — soma de entradas e saídas do período", () => {
  it("separa entradas de saídas", () => {
    const r = totaisDeMovimentacao([l({ tipo: "entrada", valor: 50.5 }), l({ valor: 30 }), l({ valor: 20 })], todos, hoje);
    expect(r).toEqual({ entradas: 50.5, saidas: 50, lancamentos: 3 });
  });

  it("respeita período, empresa e banco", () => {
    const linhas = [
      l({ valor: 10 }),
      l({ valor: 20, data_pagamento: "2026-02-05" }),
      l({ valor: 40, empresa_id: "B" }),
      l({ valor: 80, banco_id: "b2" }),
    ];
    expect(totaisDeMovimentacao(linhas, { ...todos, dataDe: "2026-01-01", dataAte: "2026-01-31" }, hoje).saidas).toBe(130);
    expect(totaisDeMovimentacao(linhas, { ...todos, empresaId: "B" }, hoje).saidas).toBe(40);
    expect(totaisDeMovimentacao(linhas, { ...todos, bancoId: "b2" }, hoje).saidas).toBe(80);
  });

  it("rateio é uma linha só pelo total, na empresa da primeira fatia (como o Fluxo)", () => {
    const rateio = [l({ despesa_id: "r", empresa_id: "HAGG", valor: 742.6 }), l({ despesa_id: "r", empresa_id: "NH", valor: 79 })];
    expect(totaisDeMovimentacao(rateio, { ...todos, empresaId: "HAGG" }, hoje)).toEqual({ entradas: 0, saidas: 821.6, lancamentos: 1 });
    expect(totaisDeMovimentacao(rateio, { ...todos, empresaId: "NH" }, hoje).saidas).toBe(0);
  });

  it("parcelas diferentes da mesma despesa são lançamentos separados", () => {
    const p = [l({ despesa_id: "p", numero_parcela: 1, valor: 10 }), l({ despesa_id: "p", numero_parcela: 2, valor: 10 })];
    expect(totaisDeMovimentacao(p, todos, hoje).lancamentos).toBe(2);
  });

  it("o que ainda não aconteceu (data depois de hoje ou previsto) fica de fora", () => {
    const r = totaisDeMovimentacao([l({ valor: 5 }), l({ valor: 7, data_pagamento: "2026-12-01" }), l({ valor: 9, situacao_base: "aberto" })], todos, hoje);
    expect(r.saidas).toBe(5);
  });
});
