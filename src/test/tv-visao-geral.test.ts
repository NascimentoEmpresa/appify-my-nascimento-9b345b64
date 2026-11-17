import { describe, it, expect } from "vitest";
import { comparativoGeralTv, paginasDoRelatorio, resumoGeralTv, serieDoQuadro, type SistemaGeral } from "@/lib/tv/relatorioTv";
import type { Kpi } from "@/pages/relatorios/sistemas";

// Visão geral — todos os setores (Relatório Geral na TV, 18/11/2026).

const kpis = (...v: (number | null)[]): Kpi[] => v.map((valor, i) => ({ rotulo: `k${i}`, valor, formato: i === 4 ? "dias" : "n", tom: "primary" }));
const sistema = (slug: string, k: Kpi[], mensal: SistemaGeral["mensal"] = { series: [{ chave: "total", rotulo: "Abertas" }], dados: [] }): SistemaGeral =>
  ({ slug, titulo: slug, kpis: k, rotulo_item: "solicitações", mensal });

describe("TV — Visão geral de todos os setores", () => {
  const recrutamento = sistema("recrutamento", kpis(100, 20, 70, 10, 10));
  const demissoes = sistema("demissoes", kpis(50, 5, 30, 15, 4));
  const orientacoes = sistema("orientacoes", kpis(10, 0, 0, 0, null));
  const turnover = sistema("turnover", kpis(5.2, 1726, 1044, 682, 90), {
    series: [{ chave: "admitidos", rotulo: "Admitidos" }, { chave: "desligados", rotulo: "Desligados" }, { chave: "taxa", rotulo: "Turn-over (%)", eixo: "direita" }],
    dados: [{ mes: "2026-10", admitidos: 100, desligados: 90, taxa: 4.5 }, { mes: "2026-11", admitidos: 80, desligados: 70, taxa: 5.1 }],
  });
  const colaboradores = sistema("colaboradores", kpis(4000, 3800, 200, 120));

  it("soma só os sistemas de solicitação — Turn-over (e o antigo Colaboradores) ficam à parte", () => {
    const r = resumoGeralTv([recrutamento, demissoes, orientacoes, turnover, colaboradores]);
    expect([r.total, r.andamento, r.concluidas, r.recusadas]).toEqual([160, 25, 100, 25]);
    expect(r.solicitacoes.map((s) => s.slug)).toEqual(["recrutamento", "demissoes", "orientacoes"]);
    expect(r.turnover?.slug).toBe("turnover");
  });

  it("taxa de conclusão = concluídas ÷ total; tempo médio pesado pelas concluídas", () => {
    const r = resumoGeralTv([recrutamento, demissoes, orientacoes]);
    expect(r.taxaConclusao).toBe(62.5);
    // (10 × 70 + 4 × 30) ÷ 100 = 8,2 — Orientações sem tempo não entra
    expect(r.tempoMedio).toBe(8.2);
  });

  it("sem solicitação nenhuma: taxa e tempo vazios (não 0%)", () => {
    const r = resumoGeralTv([sistema("ferias", kpis(0, 0, 0, 0, null))]);
    expect(r.taxaConclusao).toBeNull();
    expect(r.tempoMedio).toBeNull();
  });

  it("comparativo: maior volume primeiro, com a % concluída", () => {
    const c = comparativoGeralTv([demissoes, orientacoes, recrutamento]);
    expect(c.map((l) => l.slug)).toEqual(["recrutamento", "demissoes", "orientacoes"]);
    expect(c.map((l) => l.pctConcluidas)).toEqual([70, 60, 0]);
  });

  it("o mini-gráfico do Turn-over mostra a taxa; os outros, a 1ª série", () => {
    expect(serieDoQuadro(turnover)).toEqual([{ mes: "2026-10", v: 4.5 }, { mes: "2026-11", v: 5.1 }]);
    const s = sistema("ferias", kpis(1), { series: [{ chave: "total", rotulo: "Abertas" }], dados: [{ mes: "2026-11", total: 7 }] });
    expect(serieDoQuadro(s)).toEqual([{ mes: "2026-11", v: 7 }]);
  });

  it("duas páginas (Todos os setores + Comparativo); sem sistema de solicitação, só a primeira", () => {
    const base = { tipo: "geral" as const, periodo: { de: "2025-12-01", ate: "2026-11-17" }, contrato: null };
    expect(paginasDoRelatorio({ ...base, sistemas: [recrutamento, turnover] }).map((p) => p.chave)).toEqual(["geral", "geral-comparativo"]);
    expect(paginasDoRelatorio({ ...base, sistemas: [turnover] }).map((p) => p.chave)).toEqual(["geral"]);
  });
});
