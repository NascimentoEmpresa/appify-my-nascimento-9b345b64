import { describe, expect, it } from "vitest";
import type { LinhaFluxoCusto } from "@/pages/controladoria/faturamento/regras";
import {
  colunaPorCodigo, COLUNAS_JUSTIFICAVEIS, lancamentosDaColuna, prazoVencido, resumoPorContrato, valorDaColuna,
  type Justificativa, type ValoresLinha,
} from "@/pages/controladoria/justificativas/regras";

// SIS-2026-0807: a Controladoria cobra de um responsável a justificativa de um valor da Lucratividade de Contratos.
const J = (o: Partial<Justificativa> = {}): Justificativa => ({
  id: "j1", numero: "JV-2026-0001", contrato_id: "c1", mes: "2026-10-01", coluna: "rubrica:outras", coluna_rotulo: "Outras Despesas", valor_referencia: 1000,
  base_leitura: "competencia", pergunta: "Por que subiu?", responsavel_id: "u1", prazo: null, status: "aberta", resposta: null, respondida_em: null, encerrada_em: null,
  created_by: "u2", created_at: "2026-10-20T10:00:00Z", ...o,
});
const L = (o: Partial<LinhaFluxoCusto> = {}): LinhaFluxoCusto => ({
  tipo: "saida", data_pagamento: "2026-10-10", mes_base: "2026-10", contrato_id: "c1", classificacao_id: "k1", classificacao_nome: "UNIFORMES", valor: 100, id_malote: "DM-1", descricao: "x", ...o,
});

describe("colunas e valores da linha", () => {
  const linha: ValoresLinha = { exec: 10, bruto: 20, liquido: 18, descontos: 2, custos: { salarios: 7, outras: 3 }, totalCusto: 10, lucro: 8, margem: 0.4444 };
  it("cada coluna devolve o valor que a tela mostra; a margem vem em %", () => {
    expect(valorDaColuna(linha, "valor_bruto")).toBe(20);
    expect(valorDaColuna(linha, "desc_contrato")).toBe(2);
    expect(valorDaColuna(linha, "rubrica:salarios")).toBe(7);
    expect(valorDaColuna(linha, "rubrica:vt")).toBe(0);
    expect(valorDaColuna(linha, "total_custos")).toBe(10);
    expect(valorDaColuna(linha, "margem")).toBe(44.44);
    expect(valorDaColuna({ ...linha, margem: null }, "margem")).toBeNull();
  });
  it("só as colunas de custo têm lançamentos por trás", () => {
    expect(colunaPorCodigo("rubrica:outras")?.comLancamentos).toBe(true);
    expect(colunaPorCodigo("total_custos")?.comLancamentos).toBe(true);
    expect(colunaPorCodigo("valor_liquido")?.comLancamentos).toBe(false);
    expect(COLUNAS_JUSTIFICAVEIS.length).toBe(4 + 8 + 3);
  });
});

describe("lançamentos que formam a coluna", () => {
  const fluxo = [
    L({ valor: 50, classificacao_nome: "UNIFORMES" }),                                 // outras
    L({ valor: 300, classificacao_nome: "SALARIO", id_malote: "DM-2" }),              // salários
    L({ valor: 80, classificacao_nome: "UNIFORMES", contrato_id: "c2" }),             // outro contrato
    L({ valor: 20, classificacao_nome: "UNIFORMES", mes_base: "2026-09" }),           // outro mês
    L({ valor: 10, tipo: "entrada" }),                                                 // entrada não é custo
    L({ valor: 70, classificacao_nome: "UNIFORMES", id_malote: "DM-3" }),
  ];
  it("filtra por contrato, mês e rubrica e ordena do maior para o menor", () => {
    const r = lancamentosDaColuna(fluxo, "c1", "2026-10", "rubrica:outras");
    expect(r.map((l) => l.valor)).toEqual([70, 50]);
  });
  it("Total de Custos junta todas as rubricas do contrato no mês", () => {
    expect(lancamentosDaColuna(fluxo, "c1", "2026-10", "total_custos").map((l) => l.valor)).toEqual([300, 70, 50]);
  });
  it("coluna sem lançamentos (NF, planilha, resultado) devolve vazio", () => {
    expect(lancamentosDaColuna(fluxo, "c1", "2026-10", "valor_bruto")).toEqual([]);
  });
});

describe("prazo e resumo por contrato", () => {
  const hoje = new Date(2026, 9, 25); // 25/10/2026
  it("só a cobrança aberta e com prazo passado está vencida", () => {
    expect(prazoVencido(J({ prazo: "2026-10-24" }), hoje)).toBe(true);
    expect(prazoVencido(J({ prazo: "2026-10-25" }), hoje)).toBe(false);
    expect(prazoVencido(J({ prazo: "2026-10-24", status: "respondida" }), hoje)).toBe(false);
    expect(prazoVencido(J({ prazo: null }), hoje)).toBe(false);
  });
  it("conta por contrato só o mês pedido e ignora as canceladas", () => {
    const todas = [
      J({ id: "a", status: "aberta", prazo: "2026-10-01" }),
      J({ id: "b", status: "respondida" }),
      J({ id: "c", status: "encerrada" }),
      J({ id: "d", status: "cancelada" }),
      J({ id: "e", mes: "2026-09-01" }),
      J({ id: "f", contrato_id: "c2" }),
    ];
    const r = resumoPorContrato(todas, "2026-10", hoje);
    expect(r.get("c1")).toEqual({ abertas: 1, respondidas: 1, encerradas: 1, vencidas: 1 });
    expect(r.get("c2")).toEqual({ abertas: 1, respondidas: 0, encerradas: 0, vencidas: 0 });
  });
});
