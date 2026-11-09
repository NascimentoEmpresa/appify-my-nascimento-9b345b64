import { describe, expect, it } from "vitest";
import { conciliacoesDuplicadas, explicarFluxoXExtrato } from "@/lib/conciliacaoDashboard";
import { conciliacoesUnicas } from "@/pages/controladoria/auditoria/regras";

// SIS-2026-0833: a diferença entre o Fluxo (tudo) e o extrato (só onde há conciliação) aberta em partes e por banco.
const F = { dataDe: "2026-01-01", dataAte: "2026-01-31", empresaId: null, bancoId: null, mesDe: "2026-01", mesAte: "2026-01" };
const linha = (extra: Record<string, unknown>) =>
  ({ despesa_id: "d" + Math.random(), numero_parcela: null, empresa_id: "E1", banco_id: "B1", data_pagamento: "2026-01-10", tipo: "entrada", valor: 100, descricao: "RECEBIMENTO", classificacao_nome: "RECEITA", banco_nome: "Banco A", ...extra }) as any;
const conc = (extra: Record<string, unknown>) =>
  ({ id: "c1", data_inicio: "2026-01-01", data_fim: "2026-01-31", banco_id: "B1", todas_empresas: false, empresa_ids: ["E1"], conta_extrato: null, created_at: "2026-02-01",
     extrato_entradas: 100, extrato_saidas: 0, fluxo_entradas: 100, fluxo_saidas: 0, conciliado_entradas: 100, conciliado_saidas: 0, ...extra }) as any;

describe("ponte Fluxo × extrato", () => {
  it("separa saldo anterior, conta vinculada ignorada e banco sem conciliação do que se compara ao extrato", () => {
    const linhas = [
      linha({}), // conciliado
      linha({ valor: 1000, classificacao_nome: "SALDO ANTERIOR" }),
      linha({ tipo: "saida", valor: 50, descricao: "RESGATE CONTA VINCULADA", banco_nome: "Banco do Brasil" }),
      linha({ banco_id: "B2", valor: 700, banco_nome: "Banco B" }), // sem conciliação
    ];
    const r = explicarFluxoXExtrato(linhas, [conc({})], F, "2026-12-31");
    expect(r.entradas).toMatchObject({ fluxoTotal: 1800, saldoAnterior: 1000, semConciliacao: 700, conciliado: 100, extrato: 100, diferenca: 0 });
    expect(r.saidas).toMatchObject({ fluxoTotal: 50, ignoradas: 50, conciliado: 0 });
    // fecha: total = anterior + ignoradas + sem conciliação + conciliado
    const e = r.entradas;
    expect(e.saldoAnterior + e.ignoradas + e.semConciliacao + e.conciliado).toBe(e.fluxoTotal);
  });

  it("aponta o banco que não bate e a diferença, e o mês sem conciliação aparece à parte", () => {
    const linhas = [linha({ valor: 90 }), linha({ banco_id: "B2", valor: 30, banco_nome: "Banco B" })];
    const r = explicarFluxoXExtrato(linhas, [conc({})], F, "2026-12-31");
    const comConc = r.linhas.find((x) => x.conciliacaoId === "c1")!;
    expect(comConc.difE).toBe(-10);
    const sem = r.linhas.find((x) => !x.conciliacaoId)!;
    expect(sem).toMatchObject({ bancoId: "B2", fluxoE: 30, extratoE: null, difE: null });
    expect(r.entradas.diferenca).toBe(-10);
  });

  it("conciliação sem nenhum lançamento no Fluxo também aparece (extrato sem Fluxo)", () => {
    const r = explicarFluxoXExtrato([], [conc({ extrato_entradas: 40 })], F, "2026-12-31");
    expect(r.linhas[0]).toMatchObject({ fluxoE: 0, extratoE: 40, difE: -40 });
  });

  it("lançamento futuro e cancelado ficam de fora", () => {
    const r = explicarFluxoXExtrato([linha({ data_pagamento: "2026-01-20" }), linha({ situacao_base: "cancelado" })], [conc({})], F, "2026-01-15");
    expect(r.entradas.fluxoTotal).toBe(0);
  });
});

describe("conciliações da mesma conta e dedup da Auditoria (SIS-2026-0833)", () => {
  it("Auditoria: duas contas do mesmo banco e empresa NÃO viram uma conciliação só; a mesma conta salva duas vezes vale a mais recente", () => {
    const base = { banco_id: "B1", empresa_ids: ["E1"], todas_empresas: false, data_inicio: "2026-01-01", data_fim: "2026-01-31" };
    const r = conciliacoesUnicas([
      { ...base, id: "a", conta_extrato: "748 / 119", created_at: "2026-11-04" },
      { ...base, id: "b", conta_extrato: "748 / 155", created_at: "2026-11-04" },
      { ...base, id: "c", conta_extrato: "748 / 155", created_at: "2026-11-05" },
    ] as any);
    expect(r.map((x) => x.id).sort()).toEqual(["a", "c"]);
  });
  it("detecta a mesma conta do extrato conciliada em dois bancos (duplicata), ignorando o '-' dos bancos sem conta", () => {
    const base = { data_inicio: "2026-01-01", data_fim: "2026-01-31", todas_empresas: false, empresa_ids: ["E1"], created_at: "2026-11-04" };
    const r = conciliacoesDuplicadas([
      { ...base, id: "1", banco_id: "SIC", conta_extrato: "748 / 1550000000320269" },
      { ...base, id: "2", banco_id: "SIC155", conta_extrato: "748 / 1550000000320269" },
      { ...base, id: "3", banco_id: "M1", conta_extrato: "-" },
      { ...base, id: "4", banco_id: "M2", conta_extrato: "-" },
    ] as any);
    expect(r).toHaveLength(1);
    expect(r[0].ids.sort()).toEqual(["1", "2"]);
  });
  it("expõe o Fluxo gravado na conciliação para detectar mudança posterior", () => {
    const r = explicarFluxoXExtrato([linha({ valor: 160 })], [conc({ fluxo_entradas: 100, conciliado_entradas: 100 })], F, "2026-12-31");
    const c = r.linhas.find((x) => x.conciliacaoId === "c1")!;
    expect(c.gravadoE).toBe(100);
    expect(c.fluxoE).toBe(160);
  });
});
