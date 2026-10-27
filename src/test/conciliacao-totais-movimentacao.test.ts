import { describe, expect, it } from "vitest";
import { totaisDeMovimentacao, type LinhaParaTotais } from "@/lib/conciliacaoDashboard";

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
