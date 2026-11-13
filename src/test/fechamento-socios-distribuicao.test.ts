import { describe, expect, it } from "vitest";
import {
  calcularMes, distribuirPorPercentual, donoDaLinha, fotoDoFechamento, linhaDoHistorico, pendenciasParaFechar, resultadoDoFechamento, resumoPorSocio, somarMeses,
  type EntradaMes, type LancamentoRetirada, type LinhaIntegrante, type SocioConfig,
} from "@/pages/controladoria/fechamento-socios/regras";

const socio = (id: string, nome: string, pct: number, empregadoIds: number[] = [], ativo = true): SocioConfig => ({ id, nome, empregadoIds, percentualPadrao: pct, ativo });
const SOCIOS = [socio("a", "Antonio", 25, [10]), socio("c", "Carlos Eduardo", 15, [20]), socio("g", "Guiomar", 25, [30]), socio("h", "Helena", 20, [40]), socio("s", "Senilton", 15, [50])];
const entrada = (p: Partial<EntradaMes> = {}): EntradaMes => ({ mes: "2026-01", resultadoAposOutrasReceitas: 1000, tributos: 0, colunaSocios: {}, ...p });
const lin = (integranteId: number | null, valor: number, tipo: "investimentos" | "obras" = "investimentos", mes = "2026-01"): LinhaIntegrante => ({ mes, tipo, integranteId, valor });

describe("divisão por percentual em centavos", () => {
  it("a soma das partes é sempre o total (sem perder nem inventar centavo)", () => {
    const m = distribuirPorPercentual(3_093_984.89, SOCIOS.map((s) => ({ id: s.id, percentual: s.percentualPadrao })));
    expect([...m.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(3_093_984.89, 2);
    // dois sócios de 25% ficam com valores que diferem no máximo 1 centavo
    expect(Math.abs((m.get("a") ?? 0) - (m.get("g") ?? 0))).toBeLessThanOrEqual(0.01);
  });
  it("percentuais que não fecham 100 dividem proporcionalmente; zero e lista vazia não quebram", () => {
    const m = distribuirPorPercentual(100, [{ id: "x", percentual: 30 }, { id: "y", percentual: 30 }]);
    expect(m.get("x")).toBe(50);
    expect(m.get("y")).toBe(50);
    expect(distribuirPorPercentual(100, [{ id: "x", percentual: 0 }]).get("x")).toBe(0);
    expect(distribuirPorPercentual(100, []).size).toBe(0);
  });
  it("lucro negativo também divide (o prejuízo é abatido)", () => {
    const m = distribuirPorPercentual(-100, [{ id: "x", percentual: 50 }, { id: "y", percentual: 50 }]);
    expect(m.get("x")).toBe(-50);
    expect(m.get("y")).toBe(-50);
  });
});

describe("dono da linha de Investimentos / Obras Adm", () => {
  it("integrante sócio, Empresa (−1) ou sem integrante / colaborador que não é sócio", () => {
    expect(donoDaLinha(10, SOCIOS)).toEqual({ tipo: "socio", socioId: "a" });
    expect(donoDaLinha(-1, SOCIOS)).toEqual({ tipo: "empresa" });
    expect(donoDaLinha(null, SOCIOS)).toEqual({ tipo: "sem_integrante" });
    expect(donoDaLinha(999, SOCIOS)).toEqual({ tipo: "sem_integrante" });
  });
});

describe("cálculo do mês", () => {
  it("lucro = resultado − tributos; empresa consome antes da divisão; retiradas saem da parte de cada sócio", () => {
    const r = calcularMes(
      entrada({ resultadoAposOutrasReceitas: 1100, tributos: 100, colunaSocios: { Antonio: 50, Helena: 20 } }),
      SOCIOS, new Map(),
      [lin(-1, 200), lin(-1, 100, "obras"), lin(10, 30, "investimentos"), lin(10, 10, "obras"), lin(40, 5)],
    );
    expect(r.resultadoAntesRetiradas).toBe(1000);
    expect(r.consumoEmpresa).toMatchObject({ investimentos: 200, obras: 100, semIntegrante: 0, total: 300 });
    expect(r.lucroDistribuir).toBe(700);
    const a = r.socios.find((s) => s.socioId === "a")!;
    expect(a.valorLucro).toBe(175); // 25% de 700
    expect(a.retiradas).toBe(90); // coluna 50 + investimentos 30 + obras 10
    expect(a.saldo).toBe(85);
    const h = r.socios.find((s) => s.socioId === "h")!;
    expect(h.retiradas).toBe(25); // coluna 20 + investimentos 5
    expect(r.totalRetiradas).toBe(115);
    expect(r.totalSaldo).toBe(700 - 115);
    expect(r.percentualOk).toBe(true);
  });
  it("sem integrante consome o lucro (como hoje no Fechamento) e aparece à parte", () => {
    const r = calcularMes(entrada(), SOCIOS, new Map(), [lin(null, 40), lin(999, 10, "obras")]);
    expect(r.consumoEmpresa).toMatchObject({ investimentos: 0, obras: 0, semIntegrante: 50, total: 50 });
    expect(r.lucroDistribuir).toBe(950);
  });
  it("ignora linhas de outro mês e sócio inativo", () => {
    const inativo = [...SOCIOS.slice(0, 4), socio("s", "Senilton", 15, [50], false)];
    const r = calcularMes(entrada(), inativo, new Map(), [lin(-1, 100, "investimentos", "2026-02")]);
    expect(r.lucroDistribuir).toBe(1000);
    expect(r.socios).toHaveLength(4);
    expect(r.somaPercentual).toBe(85);
    expect(r.percentualOk).toBe(false);
  });
  it("percentual do mês vale mais que o padrão", () => {
    const r = calcularMes(entrada(), SOCIOS, new Map([["a", 50], ["c", 10], ["g", 20], ["h", 10], ["s", 10]]), []);
    expect(r.socios.find((s) => s.socioId === "a")!.valorLucro).toBe(500);
    expect(r.percentualOk).toBe(true);
  });
  it("mês de prejuízo: lucro negativo, saldo negativo (abatido)", () => {
    const r = calcularMes(entrada({ resultadoAposOutrasReceitas: -400 }), SOCIOS, new Map(), []);
    expect(r.lucroDistribuir).toBe(-400);
    expect(r.socios.find((s) => s.socioId === "a")!.valorLucro).toBe(-100);
  });
});

describe("totais do período", () => {
  it("soma os meses (um compensa o outro) e dá o percentual efetivo de cada sócio", () => {
    const m1 = calcularMes(entrada({ mes: "2026-01", resultadoAposOutrasReceitas: 1000 }), SOCIOS, new Map(), []);
    const m2 = calcularMes(entrada({ mes: "2026-02", resultadoAposOutrasReceitas: -200 }), SOCIOS, new Map(), []);
    const t = somarMeses([m1, m2]);
    expect(t.lucroDistribuir).toBe(800);
    expect(t.socios.find((s) => s.socioId === "a")!.valorLucro).toBe(200);
    expect(t.socios.find((s) => s.socioId === "a")!.percentualEfetivo).toBeCloseTo(25);
    expect(t.totalSaldo).toBe(800);
  });
});

describe("histórico e fechamento", () => {
  const calc = calcularMes(entrada({ colunaSocios: { Antonio: 100 } }), SOCIOS, new Map(), []);
  it("mês aberto mostra o cálculo de hoje", () => {
    const h = linhaDoHistorico(calc, undefined);
    expect(h).toMatchObject({ status: "aberto", lucroDistribuir: 1000, retiradas: 100, complementoPago: 0, saldoRemanescente: 900, dataFechamento: null });
  });
  it("mês fechado vale a foto gravada; saldo remanescente = saldo a retirar − complemento pago", () => {
    const foto = fotoDoFechamento(calc, new Map([["a", 100], ["c", 50]]));
    const h = linhaDoHistorico(calc, { status: "fechado", dataFechamento: "2026-02-05", socios: foto, resultadoAntesRetiradas: 1000, lucroDistribuir: 1000 });
    expect(h.status).toBe("fechado");
    expect(h.complementoPago).toBe(150);
    expect(h.saldoRemanescente).toBe(750);
    expect(h.dataFechamento).toBe("2026-02-05");
  });
  it("só fecha com os percentuais somando 100%", () => {
    expect(pendenciasParaFechar(calc)).toEqual([]);
    expect(pendenciasParaFechar(calcularMes(entrada(), SOCIOS.slice(0, 2), new Map(), []))).toHaveLength(1);
    expect(pendenciasParaFechar(calcularMes(entrada(), [], new Map(), []))).toHaveLength(1);
  });
});

describe("retiradas detalhadas", () => {
  it("resumo por sócio com a fatia de cada um", () => {
    const l = (socioId: string, nome: string, valor: number): LancamentoRetirada => ({ data: "2026-01-05", mes: "2026-01", socioId, socioNome: nome, tipo: "coluna_socio", descricao: "", origem: "", classificacao: "", valor });
    const r = resumoPorSocio([l("a", "Antonio", 300), l("c", "Carlos", 100), l("a", "Antonio", 100)]);
    expect(r[0]).toMatchObject({ socioId: "a", valor: 400 });
    expect(r[0].pct).toBeCloseTo(80);
  });
});

describe("mês fechado vira resultado", () => {
  it("o resultado do mês fechado é a foto gravada, e entra nos totais como qualquer mês", () => {
    const calc = calcularMes(entrada({ colunaSocios: { Antonio: 100 } }), SOCIOS, new Map(), []);
    const foto = fotoDoFechamento(calc);
    const r = resultadoDoFechamento("2026-01", { resultadoAntesRetiradas: 1000, consumoEmpresa: 0, lucroDistribuir: 1000, socios: foto });
    expect(r.totalRetiradas).toBe(100);
    expect(r.totalSaldo).toBe(900);
    expect(r.percentualOk).toBe(true);
    expect(somarMeses([r]).lucroDistribuir).toBe(1000);
  });
});
