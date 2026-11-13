import { describe, it, expect } from "vitest";
import {
  aplicarBaixaDasContas, resumoDasParcelas, tipoDaParcelaPlanilha,
  type ContaDoContrato, type ParcelaPlanilha,
} from "@/pages/juridico/patrimonio/baixaParcelas";
import { mapaValorQueFalta } from "@/pages/juridico/patrimonio/parcelas";

// Caso real do TURIM (13/11/2026): planilha parada na 20ª, contas pagas até a
// 23ª (uma com baixa manual, as outras pelo Malote).
const planilha: ParcelaPlanilha[] = [
  { id: 1, numero: 19, vencimento: "2026-07-30", valor: 4567.12, valor_pago: 4567.12, situacao: "PAGA" },
  { id: 2, numero: 20, vencimento: "2026-08-30", valor: 4595.44, valor_pago: 4595.44, situacao: "PAGA" },
  { id: 3, numero: 21, vencimento: "2026-09-30", valor: 4166.66, situacao: "NAO PAGA" },
  { id: 4, numero: 22, vencimento: "2026-10-30", valor: 4166.66, situacao: "NAO PAGA" },
  { id: 5, numero: 23, vencimento: "2026-11-30", valor: 4166.66, situacao: "NAO PAGA" },
  { id: 6, numero: 24, vencimento: "2026-12-30", valor: 4166.66, situacao: "NAO PAGA" },
  { id: 7, rotulo: "REFORÇO", vencimento: "2027-02-10", valor: 50000, situacao: "NAO PAGA" },
];

const fin = (id: number, n: number, venc: string, extra: Partial<ContaDoContrato> = {}): ContaDoContrato => ({
  id, categoria: "Financiamento", tipo_lancamento: "parcela", parcela_numero: n, vencimento: venc, valor: 4166.66,
  descricao: `TURIM - MOISÉS OSMARINI X DE 72 PARCELAS · Parcela ${n}/72`, ...extra,
});

const pagaPor = (pagas: Record<string, "malote" | "conta">) => (c: ContaDoContrato) => pagas[String(c.id)] ?? null;

describe("baixa das parcelas da planilha pelas contas do contrato", () => {
  const contas = [
    fin(101, 20, "2026-08-30"),
    fin(102, 21, "2026-09-30"),
    fin(103, 22, "2026-10-30"),
    fin(104, 23, "2026-11-30"),
    fin(105, 24, "2026-12-30"),
  ];
  const r = aplicarBaixaDasContas(planilha, contas, pagaPor({ 101: "malote", 102: "conta", 103: "malote", 104: "malote" }));

  it("parcela paga pelo Malote ou com baixa na conta vira PAGA", () => {
    expect(r.find(x => x.id === 3)).toMatchObject({ situacao: "PAGA", baixa: "conta", conta_id: 102, valor_pago: 4166.66 });
    expect(r.find(x => x.id === 4)).toMatchObject({ situacao: "PAGA", baixa: "malote", conta_id: 103 });
    expect(r.find(x => x.id === 5)).toMatchObject({ situacao: "PAGA", baixa: "malote", conta_id: 104 });
  });

  it("conta não paga não inventa pagamento", () => {
    expect(r.find(x => x.id === 6)).toMatchObject({ situacao: "NAO PAGA", baixa: null, conta_id: null });
    expect(r.find(x => x.id === 7)?.baixa).toBeNull();
  });

  it("o que a planilha já dava como PAGA continua, sem trocar o valor", () => {
    expect(r.find(x => x.id === 2)).toMatchObject({ situacao: "PAGA", baixa: "planilha", valor_pago: 4595.44 });
  });

  it("resumo bate com a tabela", () => {
    const s = resumoDasParcelas(r);
    expect(s.pagas).toBe(5);
    expect(s.total).toBe(7);
    expect(s.somaPagas).toBe(Math.round((4567.12 + 4595.44 + 3 * 4166.66) * 100) / 100);
    expect(s.somaAberto).toBe(54166.66);
  });

  it("não usa conta de outra categoria nem a mesma conta duas vezes", () => {
    const luz: ContaDoContrato = { id: 200, categoria: "Luz", vencimento: "2026-12-26", valor: 90 };
    const r2 = aplicarBaixaDasContas(
      [planilha[5], { ...planilha[5], id: 66 }],
      [luz, fin(105, 24, "2026-12-30")],
      pagaPor({ 200: "malote", 105: "malote" }),
    );
    expect(r2.filter(x => x.baixa).length).toBe(1);
    expect(r2[0].conta_id).toBe(105);
  });

  it("reforço só casa com reforço, mesmo no mesmo mês de uma parcela", () => {
    const parcelaFev = { id: 8, numero: 26, vencimento: "2027-02-28", valor: 4166.66, situacao: "NAO PAGA" };
    const reforco: ContaDoContrato = {
      id: 300, categoria: "Financiamento", tipo_lancamento: "reforco", vencimento: "2027-02-10", valor: 50000,
      descricao: "TURIM · Reforço",
    };
    const r3 = aplicarBaixaDasContas([planilha[6], parcelaFev], [reforco], pagaPor({ 300: "conta" }));
    expect(r3[0]).toMatchObject({ baixa: "conta", conta_id: 300 });
    expect(r3[1].baixa).toBeNull();
  });

  it("mês diferente: aceita o mesmo número até 45 dias, não além", () => {
    const p = { id: 9, numero: 21, vencimento: "2026-09-30", valor: 4166.66, situacao: "NAO PAGA" };
    expect(aplicarBaixaDasContas([p], [fin(1, 21, "2026-10-01")], pagaPor({ 1: "malote" }))[0].baixa).toBe("malote");
    expect(aplicarBaixaDasContas([p], [fin(1, 21, "2026-12-01")], pagaPor({ 1: "malote" }))[0].baixa).toBeNull();
  });

  it("duas contas pagas no mesmo mês: prefere a do mesmo número", () => {
    const p = { id: 10, numero: 22, vencimento: "2026-10-30", valor: 4166.66, situacao: "NAO PAGA" };
    const r4 = aplicarBaixaDasContas([p], [fin(1, 21, "2026-10-02"), fin(2, 22, "2026-10-30")], pagaPor({ 1: "malote", 2: "malote" }));
    expect(r4[0].conta_id).toBe(2);
  });

  it("tipo da linha da planilha", () => {
    expect(tipoDaParcelaPlanilha({ id: 1, numero: 3 })).toBe("parcela");
    expect(tipoDaParcelaPlanilha({ id: 1, rotulo: "REFORÇO" })).toBe("reforco");
    expect(tipoDaParcelaPlanilha({ id: 1, rotulo: "A) SINAL" })).toBe("sinal");
  });
});

describe("valor que falta com o selo do Malote", () => {
  it("parcela paga pelo Malote (sem status Pago) sai do que falta", () => {
    const obrs = [
      { patrimonio_id: 1, categoria: "Financiamento", valor: 100, status: "Pendente", pago_malote: true },
      { patrimonio_id: 1, categoria: "Financiamento", valor: 50, status: "Pendente", pago_malote: false },
    ];
    expect(mapaValorQueFalta(obrs).get(1)).toBe(150);
    expect(mapaValorQueFalta(obrs, o => o.pago_malote).get(1)).toBe(50);
  });
});
