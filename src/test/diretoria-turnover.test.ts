import { describe, it, expect } from "vitest";
import {
  META_MENSAL, analistas, dozeMeses, limiteQuantidade, nomeContrato, totalAnalistas, turnoverDoAno, turnoverPorContrato,
  type ContratoTurnover,
} from "@/lib/diretoria/turnover";

// =====================================================================
// Diretoria › Turn-over no formato do Power BI (mig 20261006000003).
// Números de jan–jul/2026 conferidos com o painel do Power BI em 06/10.
// =====================================================================

const mensal = [
  { mes: "2026-01", efetivo: 2164, demissoes: 91, taxa: 4.21 },
  { mes: "2026-02", efetivo: 2140, demissoes: 103, taxa: 4.81 },
  { mes: "2026-03", efetivo: 2195, demissoes: 97, taxa: 4.42 },
  { mes: "2026-04", efetivo: 2234, demissoes: 103, taxa: 4.61 },
  { mes: "2026-05", efetivo: 2256, demissoes: 105, taxa: 4.65 },
  { mes: "2026-06", efetivo: 2394, demissoes: 109, taxa: 4.55 },
  { mes: "2026-07", efetivo: 2416, demissoes: 131, taxa: 5.42 },
];

const contrato = (p: Partial<ContratoTurnover>): ContratoTurnover => ({
  contrato: "1 - X", empresa: "HAGG", efetivo_medio: 10, efetivo_atual: 10, demissoes: 0, demissoes_todas: 0,
  aviso_trabalhado: 0, aviso_indenizado: 0, ...p,
});

describe("turnover do ano", () => {
  it("é a soma das taxas mensais (≈ 32,7% do Power BI em jan–jul)", () => {
    const t = turnoverDoAno({ mensal, fator_projecao: 365 / 212 });
    expect(t.taxa).toBe(32.67);
    expect(t.demissoes).toBe(739);
    expect(t.projecao).toBeCloseTo(56.25, 1);
    expect(t.acimaDaMeta).toBe(false);
  });
  it("meta mensal = 41% ÷ 12", () => expect(META_MENSAL).toBe(3.42));
  it("completa os 12 meses, os futuros sem taxa", () => {
    const m = dozeMeses({ ano: 2026, mensal });
    expect(m).toHaveLength(12);
    expect(m[6].taxa).toBe(5.42);
    expect(m[11]).toMatchObject({ mes: "2026-12", taxa: null });
  });
});

describe("por contrato", () => {
  it("tira o código da filial do nome", () => {
    expect(nomeContrato("1050 - UFRGS - LIMPEZA GERAL - 047/2022")).toBe("UFRGS - LIMPEZA GERAL - 047/2022");
    expect(nomeContrato("LIMPEZA FURG")).toBe("LIMPEZA FURG");
  });
  it("em relação ao grupo e ao próprio contrato", () => {
    const [c] = turnoverPorContrato({ efetivo_medio: 2257, por_contrato: [contrato({ contrato: "1050 - UFRGS", demissoes: 106, efetivo_medio: 372.3 })] });
    expect(c.grupo).toBe(4.7);
    expect(c.proprio).toBe(28.47);
  });
  it("contrato sem demissão fica de fora", () => {
    expect(turnoverPorContrato({ efetivo_medio: 100, por_contrato: [contrato({ demissoes: 0 })] })).toHaveLength(0);
  });
});

describe("analistas", () => {
  it("limite em quantidade arredonda para cima", () => {
    expect(limiteQuantidade(40, "trabalhado")).toBe(10); // 9,2 → 10 (ADM E ESTAGIÁRIOS - NH no Power BI)
    expect(limiteQuantidade(40, "indenizado")).toBe(2);
    expect(limiteQuantidade(40, "demissao")).toBe(40);
  });
  it("% atual, projeção e estouro do limite", () => {
    const [l] = analistas({ fator_projecao: 12 / 7, por_contrato: [contrato({ efetivo_atual: 40, aviso_trabalhado: 3 })] }, "trabalhado");
    expect(l).toMatchObject({ qtd: 3, limite: 10, pct: 7.5, projecao: 12.86, estourou: false, vaiEstourar: false });
    const [i] = analistas({ fator_projecao: 12 / 7, por_contrato: [contrato({ efetivo_atual: 40, aviso_indenizado: 2 })] }, "indenizado");
    expect(i).toMatchObject({ pct: 5, estourou: false, vaiEstourar: true });
  });
  it("total do grupo soma efetivos e quantidades", () => {
    const t = totalAnalistas({ fator_projecao: 1, por_contrato: [contrato({ efetivo_atual: 30, demissoes_todas: 3 }), contrato({ efetivo_atual: 70, demissoes_todas: 2 })] }, "demissao");
    expect(t).toMatchObject({ efetivo: 100, qtd: 5, pct: 5, limite: 100 });
  });
});
