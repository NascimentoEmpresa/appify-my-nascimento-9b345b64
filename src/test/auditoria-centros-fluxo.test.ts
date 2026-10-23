import { describe, expect, it } from "vitest";
import {
  ehTransferenciaEntreContas, linkConciliacao, linkReclassificarFluxo, totaisCentrosFluxo, type LinhaFluxoAud, type TipoCentro,
} from "@/pages/controladoria/auditoria/regras";

// SIS-2026-0720: item 3 da auditoria parte da saída total do Fluxo de Caixa.
const L = (p: Partial<LinhaFluxoAud> & { numero_parcela?: number | null }): LinhaFluxoAud & { numero_parcela?: number | null } => ({
  origem: "malote", tipo: "saida", valor: 100, empresa_id: "E1", contrato_id: null, classificacao_id: null, classificacao_nome: null,
  despesa_id: null, id_malote: null, descricao: "", data_pagamento: "2026-01-10", ...p,
});
const tipoDoContrato = (id: string): TipoCentro => (id === "adm" ? "administrativo" : id === "socio" ? "socio" : "contrato");
const tipoClass = new Map<string, string | null>([["cADM", "administrativo"], ["cCONTRATO", "contrato"]]);
const responsaveis = new Map<string, string[]>([["cCONTRATO", ["Ana", "Bruno"]]]);
const nenhum = { empresaId: null, contratoId: null };

describe("totaisCentrosFluxo — saída total, o que não é despesa e o que falta distribuir", () => {
  const fluxo = [
    L({ valor: 1000, contrato_id: "c1" }),
    L({ valor: 200, contrato_id: "adm" }),
    L({ valor: 50, contrato_id: "socio" }),
    L({ valor: 30, classificacao_id: "cADM" }),
    L({ valor: 400, origem: "aplicacao_financeira" }),
    L({ valor: 600, classificacao_nome: "TRANSFERÊNCIA ENTRE CONTAS" }),
    L({ valor: 120, despesa_id: "d1", id_malote: "DM-1", classificacao_id: "cCONTRATO", classificacao_nome: "UNIFORMES" }),
    L({ valor: 80, classificacao_nome: "SALDO ANTERIOR" }),
    L({ valor: 999, tipo: "entrada", contrato_id: "c1" }),
  ];
  const p = totaisCentrosFluxo(fluxo, tipoDoContrato, tipoClass, responsaveis, nenhum);

  it("saldo utilizável = saída total − aplicação − transferência; saldo anterior e entradas ficam de fora", () => {
    expect(p.saidaTotal).toBe(2400);
    expect(p.aplicacoes).toBe(400);
    expect(p.transferencias).toBe(600);
    expect(p.saldoUtilizavel).toBe(1400);
  });
  it("distribui em contratos, administrativo (contrato ou classificação) e sócios", () => {
    expect([p.contratos, p.administrativo, p.socios]).toEqual([1000, 230, 50]);
  });
  it("falta distribuir = saldo utilizável − centros, e é a soma da lista", () => {
    expect(p.faltaDistribuir).toBe(120);
    expect(p.lancamentos.reduce((s, l) => s + l.valor, 0)).toBe(p.faltaDistribuir);
    expect(p.lancamentos[0]).toMatchObject({ numero: "DM-1", motivo: "contrato_nao_informado", responsaveis: ["Ana", "Bruno"] });
  });
  it("rateio do mesmo lançamento entra uma vez, com as fatias somadas", () => {
    const r = totaisCentrosFluxo([L({ valor: 60, despesa_id: "d9", numero_parcela: 2 }), L({ valor: 40, despesa_id: "d9", numero_parcela: 2 })], tipoDoContrato, tipoClass, responsaveis, nenhum);
    expect(r.lancamentos).toHaveLength(1);
    expect(r.lancamentos[0]).toMatchObject({ valor: 100, numeroParcela: 2, motivo: "sem_classificacao", responsaveis: [] });
  });
  it("filtro de empresa vale para tudo", () => {
    const r = totaisCentrosFluxo([L({ valor: 10, contrato_id: "c1" }), L({ valor: 90, contrato_id: "c1", empresa_id: "E2" })], tipoDoContrato, tipoClass, responsaveis, { empresaId: "E2", contratoId: null });
    expect(r.saidaTotal).toBe(90);
  });
  it("reconhece a transferência entre contas sem acento e sem caixa", () => {
    expect(ehTransferenciaEntreContas({ classificacao_nome: "transferencia entre contas" })).toBe(true);
    expect(ehTransferenciaEntreContas({ classificacao_nome: "TRANSFERÊNCIA" })).toBe(false);
  });
});

describe("links da auditoria", () => {
  it("reclassificar abre o Fluxo no lançamento: busca pelo ID e editar=origem|despesa|parcela", () => {
    const url = linkReclassificarFluxo("2026-01", "E1", { origem: "malote", despesaId: "d1", numeroParcela: 3, numero: "DM-2026-0001" });
    expect(url).toContain("/fluxo-caixa?de=2026-01-01&ate=2026-01-31&empresa=E1");
    expect(url).toContain("busca=DM-2026-0001");
    expect(decodeURIComponent(url)).toContain("editar=malote|d1|3");
  });
  it("conciliação abre no Dashboard, na competência e empresa, com os valores da auditoria", () => {
    const url = linkConciliacao("2026-01", "E1", { fluxo: { entradas: 10, saidas: 20, movimentado: 30, saldo: -10 }, extrato: { entradas: 9, saidas: 21, movimentado: 30, saldo: -12 } });
    const q = new URLSearchParams(url.split("?")[1]);
    expect(url).toContain("/conciliacao-fluxo-caixa?");
    expect(Object.fromEntries(q)).toMatchObject({ aba: "dashboard", mes: "2026-01", empresa: "E1", fe: "10", fs: "20", ee: "9", es: "21" });
  });
});
