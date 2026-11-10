import { describe, expect, it } from "vitest";
import {
  faturadoNoPrazo, painelPeloFaturamento, prazoChecklist, vencidoMais90,
  type EntradaChecklist, type EntradaFaturamento, type NfComEmissao,
} from "@/lib/operacional/painelPeloFaturamento";
import { montarCards, type DadosPainelExecutivo } from "@/lib/operacional/painelExecutivo";

// 10/11/2026 — Pablo: "valor recebido de abril tinha que ser 7.247.842,20 /
// a receber 11.091,94" (Controladoria › Faturamento da Empresa). Recebido e
// A Receber são das notas DA COMPETÊNCIA, não do que foi pago no mês.
// Valores fictícios.

const nf = (contrato_id: string, competencia: string, liquido: number, extra: Partial<NfComEmissao> = {}): NfComEmissao => ({
  contrato_id, competencia, tipo_nota: "N", status: "concluida", valor_contrato_exec_total: 0,
  vlr_bruto_total: liquido, vlr_liquido_total: liquido, valor_pago: null, desconto_conta_vinculada: 0, ...extra,
});

const rpc: DadosPainelExecutivo = {
  competencia: "2026-04", ultima_dre: "2026-04", competencias: ["2026-04"],
  dre: null, dre_anterior: null,
  // O que a RPC devolvia (pago no mês, saldo de tudo em aberto): tem de ser ignorado.
  nf: { qtd: 9, recebido: 7_836_613.77, recebido_ant: 1, saldo: 5_838_084.75, saldo_ant: 1, vencido_90: 0, vencido_90_ant: 0 },
  serie: [], situacao: null, critico_anterior: null,
};

const hoje = new Date(2026, 10, 10); // 10/11/2026

const entrada: EntradaFaturamento = {
  nfs: [
    // abr/26: uma paga inteira, uma paga em parte, uma com conta vinculada retida.
    nf("a", "2026-04-01", 1_000, { valor_pago: 1_000, data_pagamento: "2026-05-20", data_emissao: "2026-05-05" }),
    nf("b", "2026-04-01", 500, { valor_pago: 200, data_emissao: "2026-05-05" }),
    nf("c", "2026-04-01", 300, { desconto_conta_vinculada: 50, data_emissao: "2026-10-20" }),
    // Nota de março paga em abril: NÃO é Recebido de abril.
    nf("a", "2026-03-01", 800, { valor_pago: 800, data_pagamento: "2026-04-10", data_emissao: "2026-04-02" }),
    nf("a", "2026-04-01", 9_999, { status: "cancelada" }),
  ],
  custoPorContratoMes: new Map(),
  contratos: new Map([["a", "CONTRATO A"], ["b", "CONTRATO B"], ["c", "CONTRATO C"]]),
  ativos: 3,
  hoje,
};

describe("Painel Executivo: Recebido e A Receber como no Faturamento da Empresa", () => {
  const d = painelPeloFaturamento(rpc, entrada);

  it("Recebido = pago das notas da competência; A Receber = aReceberDaNf", () => {
    expect(d.nf.recebido).toBe(1_200);
    expect(d.nf.saldo).toBe(550); // 300 (b) + 250 (c, sem a conta vinculada)
    expect(d.nf.recebido_ant).toBe(800);
    expect(d.nf.saldo_ant).toBe(0);
    expect(d.nf.qtd).toBe(3);
  });

  it("vencido > 90 dias: só o saldo cuja emissão + 30 + 90 já passou", () => {
    expect(d.nf.vencido_90).toBe(300); // b; c foi emitida em outubro
  });

  it("cards de recebido e saldo mostram a conta nova e são 'real'", () => {
    const cards = montarCards(d);
    const recebido = cards.find((c) => c.chave === "recebido")!;
    expect(recebido.medida).toBe("real");
    expect(recebido.valor).toContain("1.200,00");
    expect(cards.find((c) => c.chave === "saldo")!.valor).toContain("550,00");
  });
});

describe("vencidoMais90", () => {
  it("nota paga não vence; sem emissão usa o fim da competência", () => {
    expect(vencidoMais90(nf("a", "2026-01-01", 100, { valor_pago: 100, data_pagamento: "2026-02-01" }), hoje)).toBe(0);
    expect(vencidoMais90(nf("a", "2026-01-01", 100), hoje)).toBe(100);
    expect(vencidoMais90(nf("a", "2026-09-01", 100), hoje)).toBe(0);
  });
});

describe("% Faturado no Prazo pelo Checklist de Faturamento", () => {
  const ck: EntradaChecklist = {
    configs: new Map([
      ["a", { dia: 10, inicio: null }],
      ["b", { dia: 10, inicio: null }],
      ["c", { dia: 10, inicio: null }],
      ["d", { dia: 10, inicio: "2026-12-01" }], // ainda não participa
      ["e", { dia: null, inicio: null }],        // sem prazo
    ]),
    excecoes: new Map([["c|2026-09", "2026-10-20"]]),
    envios: new Map([
      ["a|2026-09", "2026-10-09T15:00:00"], // no prazo (10/10)
      ["b|2026-09", "2026-10-12T09:00:00"], // atrasado
      ["c|2026-09", "2026-10-15T09:00:00"], // no prazo pela exceção (20/10)
    ]),
  };
  const ids = ["a", "b", "c", "d", "e"];

  it("prazo = dia-limite do mês seguinte", () => {
    expect(prazoChecklist("2026-09", 10)).toEqual(new Date(2026, 9, 10, 23, 59, 59));
    expect(prazoChecklist("2026-12", 5)).toEqual(new Date(2027, 0, 5, 23, 59, 59));
  });

  it("conta enviados no prazo sobre contratos com prazo", () => {
    expect(faturadoNoPrazo("2026-09", ids, ck, hoje)).toEqual({ no_prazo: 2, total: 3, pct: 66.67 });
  });

  it("prazo vencido sem envio conta como fora; prazo futuro sem envio fica de fora", () => {
    expect(faturadoNoPrazo("2026-08", ["a"], ck, hoje)).toEqual({ no_prazo: 0, total: 1, pct: 0 });
    expect(faturadoNoPrazo("2026-10", ["a"], ck, new Date(2026, 10, 5))).toBeNull();
  });

  it("sem checklist (sem acesso) ou nada a medir: sem número", () => {
    expect(faturadoNoPrazo("2026-09", ids, null, hoje)).toBeNull();
    const d = painelPeloFaturamento({ ...rpc, competencia: "2026-09" }, { ...entrada, checklist: ck });
    const card = montarCards(d).find((c) => c.chave === "no_prazo")!;
    expect(card.valor).toBe("66,7%");
    expect(card.medida).toBe("parcial");
    const semCk = montarCards(painelPeloFaturamento(rpc, entrada)).find((c) => c.chave === "no_prazo")!;
    expect(semCk.valor).toBeNull();
    expect(semCk.medida).toBe("sem_fonte");
  });
});
