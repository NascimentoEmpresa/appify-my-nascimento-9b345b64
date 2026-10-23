import { describe, expect, it } from "vitest";
import { parseSaldoFinalOFX } from "@/lib/conciliacaoBancariaEngine";
import { registrosAtuais, saldosMensais, statusConfere, type ConciliacaoParaSaldo, type LinhaFluxoSaldo } from "@/lib/conciliacaoDashboard";

const linha = (p: Partial<LinhaFluxoSaldo>): LinhaFluxoSaldo => ({
  empresa_id: "HAGG", banco_id: "SICREDI", banco_nome: "Sicredi", data_pagamento: "2026-01-10", tipo: "entrada", valor: 100,
  descricao: "x", classificacao_nome: "RECEITA", ...p,
});
const conc = (p: Partial<ConciliacaoParaSaldo>): ConciliacaoParaSaldo => ({
  id: "c1", data_inicio: "2026-01-01", data_fim: "2026-01-31", banco_id: "SICREDI", todas_empresas: false, empresa_ids: ["HAGG"],
  conta_extrato: null, saldo_final_extrato: null, created_at: "2026-02-05T10:00:00Z", ...p,
});

describe("parseSaldoFinalOFX", () => {
  it("lê o LEDGERBAL com a data", () => {
    const ofx = "<STMTRS><LEDGERBAL><BALAMT>-1234.56<DTASOF>20260131120000</LEDGERBAL><AVAILBAL><BALAMT>9<DTASOF>20260131</AVAILBAL></STMTRS>";
    expect(parseSaldoFinalOFX(ofx)).toEqual({ valor: -1234.56, data: "2026-01-31" });
  });
  it("aceita formato BR e devolve null sem LEDGERBAL (nunca zero)", () => {
    expect(parseSaldoFinalOFX("<LEDGERBAL><BALAMT>1.234,50</BALAMT><DTASOF>20260228</DTASOF></LEDGERBAL>")?.valor).toBe(1234.5);
    expect(parseSaldoFinalOFX("<STMTTRN><TRNAMT>10</STMTTRN>")).toBeNull();
  });
});

describe("statusConfere", () => {
  it("zero = sim; diferença = sistema − extrato; ausente = pendente", () => {
    expect(statusConfere(100, 100)).toEqual({ confere: "sim", diferenca: 0 });
    expect(statusConfere(150, 100)).toEqual({ confere: "nao", diferenca: 50 });
    expect(statusConfere(null, 100)).toEqual({ confere: "pendente", diferenca: null });
    expect(statusConfere(100, null)).toEqual({ confere: "pendente", diferenca: null });
  });
});

describe("registrosAtuais", () => {
  it("salvar de novo o mesmo registro não duplica: vale o mais recente", () => {
    const r = registrosAtuais([conc({ id: "a" }), conc({ id: "b", created_at: "2026-02-09T10:00:00Z" }), conc({ id: "c", data_inicio: "2026-02-01", data_fim: "2026-02-28" })]);
    expect(r.map((x) => x.id).sort()).toEqual(["b", "c"]);
  });
});

describe("saldosMensais", () => {
  const inicial = [{ empresa_id: "HAGG", banco_id: "SICREDI", conta: "1", ano: 2026, valor: 1000 }];

  it("parte da base manual, encadeia os meses e não conta o SALDO ANTERIOR do Fluxo", () => {
    const linhas = [
      linha({ classificacao_nome: "SALDO ANTERIOR", valor: 999, data_pagamento: "2026-01-01" }),
      linha({ valor: 500 }),
      linha({ tipo: "saida", valor: 200, data_pagamento: "2026-01-20" }),
      linha({ valor: 50, data_pagamento: "2026-02-03" }),
    ];
    const r = saldosMensais(linhas, inicial, [conc({ saldo_final_extrato: 1300 })]);
    const jan = r.find((x) => x.mes === "2026-01")!;
    const fev = r.find((x) => x.mes === "2026-02")!;
    expect([jan.entradas, jan.saidas, jan.saldoSistema]).toEqual([500, 200, 1300]);
    expect(jan.confere).toBe("sim");
    expect(fev.saldoSistema).toBe(1350); // o fechamento de janeiro é a base de fevereiro; a base não é somada de novo
    expect(fev.confere).toBe("pendente"); // fevereiro sem conciliação
  });

  it("saldo divergente mostra a diferença e não compensa entre bancos/empresas", () => {
    const linhas = [linha({ valor: 100 }), linha({ empresa_id: "NH", banco_id: "BANRISUL", valor: 100 })];
    const r = saldosMensais(linhas, inicial, [conc({ saldo_final_extrato: 1000 })]);
    const hagg = r.find((x) => x.empresaId === "HAGG" && x.mes === "2026-01")!;
    expect(hagg.saldoSistema).toBe(1100);
    expect(hagg.diferenca).toBe(100);
    expect(hagg.confere).toBe("nao");
    const nh = r.find((x) => x.empresaId === "NH")!;
    expect(nh.saldoSistema).toBeNull(); // sem base manual: não informado, nunca zero
    expect(nh.confere).toBe("pendente");
  });

  it("sem saldo do extrato a conferência fica pendente, não zerada", () => {
    const r = saldosMensais([linha({ valor: 10 })], inicial, [conc({ saldo_final_extrato: null })]);
    expect(r[0].saldoExtrato).toBeNull();
    expect(r[0].confere).toBe("pendente");
  });
});

import { saldoFinalNoDia } from "@/lib/conciliacaoBancariaEngine";
describe("saldoFinalNoDia", () => {
  const trns = [
    { dia: "2026-01-30", valor: 10, tipo: "SAÍDA" as const },
    { dia: "2026-02-02", valor: 100, tipo: "ENTRADA" as const },
    { dia: "2026-02-03", valor: 30, tipo: "SAÍDA" as const },
  ];
  it("arquivo que passa do fim do período: desconta o movimento posterior", () => {
    // saldo em 03/02 = 1000 → em 31/01 = 1000 − (100 − 30) = 930
    expect(saldoFinalNoDia({ valor: 1000, data: "2026-02-03" }, trns, "2026-01-31")).toBe(930);
  });
  it("arquivo que termina no período (ou sem data): vale como veio", () => {
    expect(saldoFinalNoDia({ valor: 1000, data: "2026-01-31" }, trns, "2026-01-31")).toBe(1000);
    expect(saldoFinalNoDia({ valor: 1000, data: null }, [], "2026-01-31")).toBe(1000);
  });
  it("DTASOF zerado (00000000) vira sem data: usa o último movimento do arquivo como referência", () => {
    expect(parseSaldoFinalOFX("<LEDGERBAL><BALAMT>1000.00</BALAMT><DTASOF>00000000</DTASOF></LEDGERBAL>")).toEqual({ valor: 1000, data: null });
    expect(saldoFinalNoDia({ valor: 1000, data: null }, trns, "2026-01-31")).toBe(930);
  });
});

import { valoresDaConciliacao } from "@/lib/conciliacaoDashboard";
describe("valoresDaConciliacao", () => {
  const base = { fluxo_entradas: 1000, fluxo_saidas: 500, extrato_entradas: 940.5, extrato_saidas: 559.5, conciliado_entradas: 900, conciliado_saidas: 450 };
  it("diferença = Fluxo − extrato, por entradas e saídas", () => {
    expect(valoresDaConciliacao(base)).toMatchObject({ difEntradas: 59.5, difSaidas: -59.5 });
  });
  it("saldo anterior que entrou como linha no Fluxo (e no conciliado) sai da conta; o extrato não o tinha", () => {
    const v = valoresDaConciliacao({ ...base, fluxo_entradas: 1270.22, conciliado_entradas: 1170.22, saldo_anterior_fluxo: 270.22, saldo_anterior_extrato: 270.22 });
    expect(v).toMatchObject({ fe: 1000, ce: 900, difEntradas: 59.5 });
  });
  it("conciliação sem os valores gravados devolve null (fica de fora, nunca zero)", () => {
    expect(valoresDaConciliacao({ ...base, extrato_entradas: null })).toBeNull();
  });
});
