import { describe, it, expect } from "vitest";
import {
  ehPrevista, filtrarPorAbaFluxo, filtrarPorSituacaoFluxo, hojeISO, situacaoFluxo,
} from "@/pages/financeiro/fluxo-caixa/abasFluxo";

type L = { id: string; data_pagamento: string | null; situacao_base?: "aberto" | "cancelado" | null };
const HOJE = "2026-10-14";

const realizadoHoje: L = { id: "r-hoje", data_pagamento: "2026-10-14" };
const realizadoOntem: L = { id: "r-ontem", data_pagamento: "2026-10-13" };
const semData: L = { id: "sem-data", data_pagamento: null };
const cartaoFuturo: L = { id: "cartao-dez", data_pagamento: "2026-12-10" }; // já no Fluxo, data futura
const vencido: L = { id: "venc", data_pagamento: "2026-10-01", situacao_base: "aberto" };
const aVencerHoje: L = { id: "av-hoje", data_pagamento: "2026-10-14", situacao_base: "aberto" };
const aVencer7: L = { id: "av-7", data_pagamento: "2026-10-21", situacao_base: "aberto" };
const previsto8: L = { id: "prev-8", data_pagamento: "2026-10-22", situacao_base: "aberto" };
const previstoSemData: L = { id: "prev-sd", data_pagamento: null, situacao_base: "aberto" };
const cancelado: L = { id: "canc", data_pagamento: "2026-10-20", situacao_base: "cancelado" };

const todas = [realizadoHoje, realizadoOntem, semData, cartaoFuturo, vencido, aVencerHoje, aVencer7, previsto8, previstoSemData, cancelado];
const ids = (l: L[]) => l.map((x) => x.id);

describe("Fluxo de Caixa — abas Realizado / Projetado / Consolidado", () => {
  it("realizado: só o que já aconteceu (hoje conta; sem data conta)", () => {
    expect(ids(filtrarPorAbaFluxo(todas, "realizado", HOJE))).toEqual(["r-hoje", "r-ontem", "sem-data"]);
  });

  it("projetado: previstos de qualquer data (inclui vencidos) + já lançados com data futura", () => {
    expect(ids(filtrarPorAbaFluxo(todas, "projetado", HOJE))).toEqual(
      ["cartao-dez", "venc", "av-hoje", "av-7", "prev-8", "prev-sd", "canc"],
    );
  });

  it("realizado + projetado fecham o consolidado, sem repetir linha", () => {
    const r = filtrarPorAbaFluxo(todas, "realizado", HOJE);
    const p = filtrarPorAbaFluxo(todas, "projetado", HOJE);
    expect(r.length + p.length).toBe(todas.length);
    expect(ids(filtrarPorAbaFluxo(todas, "consolidado", HOJE))).toHaveLength(todas.length);
    expect(r.filter((x) => p.includes(x))).toEqual([]);
  });

  it("situação: vencido / a vencer (até 7 dias) / previsto / cancelado; realizada não tem", () => {
    expect(situacaoFluxo(realizadoHoje, HOJE)).toBeNull();
    expect(situacaoFluxo(vencido, HOJE)).toBe("vencido");
    expect(situacaoFluxo(aVencerHoje, HOJE)).toBe("a_vencer");
    expect(situacaoFluxo(aVencer7, HOJE)).toBe("a_vencer");
    expect(situacaoFluxo(previsto8, HOJE)).toBe("previsto");
    expect(situacaoFluxo(cartaoFuturo, HOJE)).toBe("previsto");
    expect(situacaoFluxo(previstoSemData, HOJE)).toBe("previsto");
    expect(situacaoFluxo(cancelado, HOJE)).toBe("cancelado");
  });

  it("cancelado só aparece quando pedido; sem filtro some do projetado", () => {
    const proj = filtrarPorAbaFluxo(todas, "projetado", HOJE);
    expect(ids(filtrarPorSituacaoFluxo(proj, "", HOJE))).not.toContain("canc");
    expect(ids(filtrarPorSituacaoFluxo(proj, "cancelado", HOJE))).toEqual(["canc"]);
    expect(ids(filtrarPorSituacaoFluxo(proj, "vencido", HOJE))).toEqual(["venc"]);
  });

  it("ehPrevista e hojeISO (data local)", () => {
    expect(ehPrevista(realizadoOntem, HOJE)).toBe(false);
    expect(ehPrevista(vencido, HOJE)).toBe(true);
    expect(hojeISO(new Date(2026, 9, 14, 23, 30))).toBe("2026-10-14");
  });
});
