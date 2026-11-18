import { describe, expect, it } from "vitest";
import {
  grupoSoDeSaldoInicial,
  saldoInicialValeNaConciliacao,
  saldosMensais,
  totaisDeSaldos,
  type ConciliacaoParaSaldo,
  type LinhaFluxoSaldo,
  type SaldoInicialConta,
} from "@/lib/conciliacaoDashboard";
import { empresaDaContaNoLancamento } from "@/lib/contaBanco";

// SIS-2026-0942: conta substituída sai da Conciliação Bancária pela condição do cadastro (ativo = false), nunca por saldo zero,
// e sem apagar o histórico.

const HAGG = "HAGG";
const SN = "SN";
const SICREDI = "SICREDI";
const RENDE_FACIL = "BB_RENDE_FACIL";
const C119 = "11111111-1111-1111-1111-111111111119";

const linha = (p: Partial<LinhaFluxoSaldo>): LinhaFluxoSaldo => ({
  empresa_id: HAGG, banco_id: SICREDI, banco_nome: "Sicredi", data_pagamento: "2026-01-10", tipo: "entrada", valor: 100,
  descricao: "x", classificacao_nome: "RECEITA", ...p,
});
const inicial = (p: Partial<SaldoInicialConta>): SaldoInicialConta => ({ empresa_id: HAGG, banco_id: SICREDI, conta: "", ano: 2026, valor: 0, ...p });
const conc = (p: Partial<ConciliacaoParaSaldo>): ConciliacaoParaSaldo => ({
  id: "c1", data_inicio: "2026-01-01", data_fim: "2026-01-31", banco_id: SICREDI, todas_empresas: false, empresa_ids: [HAGG],
  conta_extrato: null, saldo_final_extrato: null, created_at: "2026-02-05T10:00:00Z", ...p,
});
const grupos = (r: ReturnType<typeof saldosMensais>) => [...new Set(r.map((s) => `${s.empresaId}|${s.bancoId}|${s.contaBancoId ?? ""}`))].sort();

// As quatro contas do chamado: só existem por uma linha de saldo inicial (sem lançamento nem conciliação).
const doChamado = [
  inicial({ valor: 28269.68, ativo: false }), // HAGG · Sicredi (sem conta)
  inicial({ empresa_id: SN, conta: "748 / 1190000000173904", ativo: false }),
  inicial({ empresa_id: SN, conta: C119, ativo: false }), // SN apontando a conta da HAGG
  inicial({ banco_id: RENDE_FACIL, ativo: false }),
];
const substituta = inicial({ conta: C119, valor: 28269.68 }); // HAGG · Sicredi · 119 — HAGG 119, a que ficou

describe("saldoInicialValeNaConciliacao", () => {
  it("só o cadastro retirado (ativo = false) fica de fora; ausente/nulo vale (linhas de antes da migration)", () => {
    expect(saldoInicialValeNaConciliacao({ ativo: false })).toBe(false);
    expect(saldoInicialValeNaConciliacao({ ativo: true })).toBe(true);
    expect(saldoInicialValeNaConciliacao({})).toBe(true);
    expect(saldoInicialValeNaConciliacao({ ativo: null })).toBe(true);
  });
});

describe("saldosMensais com contas substituídas (critérios 1 a 6 e 9)", () => {
  it("as quatro contas retiradas não abrem cartão nem ficam pendentes; a substituta continua", () => {
    const r = saldosMensais([linha({ conta_banco_id: C119 })], [...doChamado, substituta], [], undefined, new Map([[C119, "119 — HAGG 119"]]));
    expect(grupos(r)).toEqual([`${HAGG}|${SICREDI}|${C119}`]);
    expect(r.every((s) => s.empresaId === HAGG && s.contaBancoId === C119)).toBe(true);
    expect(r[0].saldoSistema).toBe(28369.68); // 28.269,68 + 100 da substituta
  });

  it("antes da retirada as mesmas linhas abriam cartões pendentes (o problema do chamado)", () => {
    const ativas = doChamado.map((i) => ({ ...i, ativo: true }));
    const r = saldosMensais([], ativas, []);
    expect(grupos(r)).toHaveLength(4);
    expect(r.every((s) => s.confere === "pendente")).toBe(true);
    expect(r.find((s) => s.empresaId === HAGG && s.bancoId === SICREDI && !s.contaBancoId)?.saldoSistema).toBe(28269.68);
  });

  it("o saldo de R$ 28.269,68 retirado não entra no total do sistema nem conta como sem conferência", () => {
    const r = saldosMensais([], [...doChamado, substituta], [conc({ conta_banco_id: C119, saldo_final_extrato: 28269.68 })]);
    const t = totaisDeSaldos(r);
    expect(t.sistema).toBe(28269.68); // só a substituta, não 2 × 28.269,68
    expect(t.semConferencia).toBe(0);
  });

  it("retirar NÃO esconde movimento real: lançamento no grupo retirado volta a aparecer, sem o saldo antigo como base", () => {
    const r = saldosMensais([linha({ banco_id: RENDE_FACIL, valor: 50 })], doChamado, []);
    const rende = r.filter((s) => s.bancoId === RENDE_FACIL);
    expect(rende).toHaveLength(1);
    expect(rende[0].entradas).toBe(50);
    expect(rende[0].saldoSistema).toBeNull(); // base retirada não vira saldo atual
  });

  it("a retirada é pela condição do cadastro, não por saldo zero: saldo zero ativo continua aparecendo", () => {
    const r = saldosMensais([], [inicial({ banco_id: "BB_RENDE_FACIL_HAGG", valor: 0 })], []);
    expect(r).toHaveLength(1);
    expect(r[0].saldoSistema).toBe(0);
  });
});

describe("grupoSoDeSaldoInicial (quando oferecer 'Retirar da conciliação')", () => {
  it("só o cartão sem nenhum lançamento nem conciliação em nenhum mês", () => {
    expect(grupoSoDeSaldoInicial([{ entradas: 0, saidas: 0, conciliacaoId: null }])).toBe(true);
    expect(grupoSoDeSaldoInicial([{ entradas: 0, saidas: 0, conciliacaoId: null }, { entradas: 0, saidas: 10, conciliacaoId: null }])).toBe(false);
    expect(grupoSoDeSaldoInicial([{ entradas: 0, saidas: 0, conciliacaoId: "c1" }])).toBe(false);
    expect(grupoSoDeSaldoInicial([])).toBe(false);
  });

  it("os quatro cartões do chamado se qualificam; a substituta com movimento não", () => {
    const r = saldosMensais([linha({ conta_banco_id: C119 })], [...doChamado.map((i) => ({ ...i, ativo: true })), substituta], []);
    const porGrupo = new Map<string, typeof r>();
    for (const s of r) {
      const k = `${s.empresaId}|${s.bancoId}|${s.contaBancoId ?? ""}`;
      porGrupo.set(k, [...(porGrupo.get(k) ?? []), s]);
    }
    const retiraveis = [...porGrupo.entries()].filter(([, m]) => grupoSoDeSaldoInicial(m)).map(([k]) => k).sort();
    expect(retiraveis).toHaveLength(4);
    expect(retiraveis).not.toContain(`${HAGG}|${SICREDI}|${C119}`);
  });
});

describe("empresaDaContaNoLancamento (cartão SN · Sicredi · 119 — HAGG 119)", () => {
  const contas = [{ id: C119, empresa_id: HAGG }];
  const fatura = (p: Partial<LinhaFluxoSaldo>) => linha({ data_pagamento: "2026-10-15", tipo: "saida", conta_banco_id: C119, descricao: "Fatura SICREDI 119 10/2026", ...p });

  it("a fatia da SN numa fatura paga pela HAGG 119 conta no cartão da HAGG 119, e o cartão SN · 119 não abre", () => {
    const linhas = [fatura({ valor: 1000 }), fatura({ empresa_id: SN, valor: 623.84 })];
    const r = saldosMensais(empresaDaContaNoLancamento(linhas, contas), [], []);
    expect(grupos(r)).toEqual([`${HAGG}|${SICREDI}|${C119}`]);
    expect(r[0].saidas).toBe(1623.84); // o débito inteiro da fatura saiu da HAGG 119
  });

  it("não mexe em linha sem conta, de conta desconhecida ou da própria dona; sem troca devolve o mesmo array", () => {
    const semConta = [linha({ empresa_id: SN, conta_banco_id: null }), linha({ empresa_id: SN, conta_banco_id: "outra" }), linha({ conta_banco_id: C119 })];
    expect(empresaDaContaNoLancamento(semConta, contas)).toBe(semConta);
    expect(empresaDaContaNoLancamento(semConta, [])).toBe(semConta);
  });

  it("a SN · Sicredi sem conta (a 748 / 1190000000173904, que fica) continua com seus próprios lançamentos", () => {
    const linhas = [linha({ empresa_id: SN, conta_banco_id: null, valor: 50 }), fatura({ empresa_id: SN, valor: 623.84 })];
    const r = saldosMensais(empresaDaContaNoLancamento(linhas, contas), [], []);
    const sn = r.filter((s) => s.empresaId === SN);
    expect(sn.every((s) => !s.contaBancoId)).toBe(true);
    expect(sn.reduce((t, s) => t + s.entradas, 0)).toBe(50);
  });
});
