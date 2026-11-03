import { describe, it, expect } from "vitest";
import {
  classificarEvento, filtrarCalculos, montarCalculos, resumir, somarPorEvento, tipoDaFolha,
  type LinhaFicha,
} from "@/lib/fichaFinanceira";

// A ficha financeira vem da Senior evento a evento. O que estes testes travam:
// a soma de proventos, descontos e líquido por folha, o tipo de cada folha
// (o filtro da tela) e os totais do período / ano / média — que é o número
// que o Financeiro vai conferir contra o holerite.

/** Linha da RPC ff_ficha: pagamento, cálculo, código, descrição, valor, competência, tipcal, tipeve. */
const l = (pag: string, calc: number, cod: number, desc: string, valor: number | null,
  extra: { comp?: string; tipcal?: number; tipeve?: number; ref?: number; emp?: number; mat?: number } = {}): LinhaFicha =>
  [pag, extra.emp ?? 1, extra.mat ?? 7, calc, extra.comp ?? null, extra.tipcal ?? null, cod, desc, valor, extra.ref ?? null, extra.tipeve ?? null];

describe("classificarEvento", () => {
  it("o tipo da Senior manda quando existe", () => {
    expect(classificarEvento("Qualquer coisa", 3, 100)).toEqual({ classe: "desconto", estimada: false });
    expect(classificarEvento("INSS", 1, 100)).toEqual({ classe: "provento", estimada: false });
    expect(classificarEvento("Horas", 5, 100)).toEqual({ classe: "informativo", estimada: false });
  });

  it("sem o tipo, a descrição decide (e fica marcada como estimada)", () => {
    expect(classificarEvento("Horas Normais", null, 3000).classe).toBe("provento");
    expect(classificarEvento("Adicional de Lider", null, 200).classe).toBe("provento");
    expect(classificarEvento("INSS", null, 270).classe).toBe("desconto");
    expect(classificarEvento("I.R.R.F.", null, 50).classe).toBe("desconto");
    expect(classificarEvento("Desconto Vale Transporte", null, 90).classe).toBe("desconto");
    expect(classificarEvento("Faltas", null, 120).classe).toBe("desconto");
    expect(classificarEvento("Pensão Alimentícia", null, 400).classe).toBe("desconto");
    expect(classificarEvento("Base INSS", null, 3000).classe).toBe("informativo");
    expect(classificarEvento("FGTS do Mês", null, 240).classe).toBe("informativo");
    expect(classificarEvento("Horas Normais", null, 3000).estimada).toBe(true);
  });

  it("valor negativo é desconto", () => {
    expect(classificarEvento("Ajuste", null, -15).classe).toBe("desconto");
  });
});

describe("tipoDaFolha", () => {
  const ev = (descricao: string, classe: "provento" | "desconto" | "informativo" = "provento") => ({ descricao, classe });
  it("rescisão ganha de tudo", () => {
    expect(tipoDaFolha([ev("Saldo de Salário"), ev("Férias Vencidas Rescisão"), ev("INSS", "desconto")], 11)).toBe("rescisao");
    expect(tipoDaFolha([ev("Aviso Prévio Indenizado")], null)).toBe("rescisao");
  });
  it("pelos proventos: 13º, adiantamento, férias, mensal", () => {
    expect(tipoDaFolha([ev("13o Salário Adiantado")], null)).toBe("decimo");
    expect(tipoDaFolha([ev("13º Salário Integral"), ev("INSS 13º", "desconto")], null)).toBe("decimo");
    expect(tipoDaFolha([ev("Adiantamento Salarial")], null)).toBe("adiantamento");
    expect(tipoDaFolha([ev("Férias"), ev("1/3 Férias"), ev("INSS", "desconto")], null)).toBe("ferias");
    expect(tipoDaFolha([ev("Horas Normais"), ev("Férias")], null)).toBe("mensal");
  });
  it("tipcal 31/32 da Senior é 13º", () => {
    expect(tipoDaFolha([ev("Horas Normais")], 32)).toBe("decimo");
  });
});

describe("montarCalculos", () => {
  const linhas: LinhaFicha[] = [
    // folha de outubro, paga em 05/11
    l("2025-11-05", 101, 1, "Horas Normais", 3000.55, { comp: "2025-10", tipcal: 11 }),
    l("2025-11-05", 101, 300, "Horas Extras 50%", 199.45, { comp: "2025-10", tipcal: 11 }),
    l("2025-11-05", 101, 900, "INSS", 270.1, { comp: "2025-10", tipcal: 11, tipeve: 3 }),
    l("2025-11-05", 101, 920, "Adiantamento Salarial", 1000, { comp: "2025-10", tipcal: 11 }),
    l("2025-11-05", 101, 950, "Base FGTS", 3200, { comp: "2025-10", tipcal: 11 }),
    // o adiantamento em si, pago em 20/10
    l("2025-10-20", 100, 920, "Adiantamento Salarial", 1000),
    // 13º adiantado sem valor (a Senior não mandou)
    l("2025-11-28", 102, 750, "13o Salário Adiantado", null),
  ];
  const cs = montarCalculos(linhas);

  it("agrupa por cálculo e ordena do mais recente", () => {
    expect(cs.map((c) => c.calculo)).toEqual([102, 101, 100]);
  });

  it("proventos, descontos e líquido da folha mensal (adiantamento entra como desconto, base fica de fora)", () => {
    const m = cs.find((c) => c.calculo === 101)!;
    expect(m.tipo).toBe("mensal");
    expect(m.proventos).toBe(3200);
    expect(m.descontos).toBe(1270.1);
    expect(m.liquido).toBe(1929.9);
    expect(m.competencia).toBe("2025-10");
    expect(m.competenciaEstimada).toBe(false);
    expect(m.eventos.find((e) => e.codigo === 920)!.classe).toBe("desconto");
    expect(m.eventos.find((e) => e.codigo === 950)!.classe).toBe("informativo");
    // proventos primeiro, depois descontos, depois informativos
    expect(m.eventos.map((e) => e.classe)).toEqual(["provento", "provento", "desconto", "desconto", "informativo"]);
  });

  it("a folha que só tem adiantamento: ele é provento, e a folha é de adiantamento", () => {
    const a = cs.find((c) => c.calculo === 100)!;
    expect(a.tipo).toBe("adiantamento");
    expect(a.liquido).toBe(1000);
    expect(a.competencia).toBe("2025-10");
    expect(a.competenciaEstimada).toBe(true);
  });

  it("evento sem valor é contado, não somado", () => {
    const d = cs.find((c) => c.calculo === 102)!;
    expect(d.tipo).toBe("decimo");
    expect(d.liquido).toBe(0);
    expect(d.semValor).toBe(1);
  });

  it("mesmo número de cálculo em empresas diferentes não se mistura", () => {
    const x = montarCalculos([
      l("2012-05-05", 9, 1, "Horas Normais", 1000, { emp: 2, mat: 50 }),
      l("2012-05-05", 9, 1, "Horas Normais", 500, { emp: 1, mat: 7 }),
    ]);
    expect(x).toHaveLength(2);
  });
});

describe("filtros e totais", () => {
  const cs = montarCalculos([
    l("2025-01-05", 1, 1, "Horas Normais", 2000),
    l("2025-01-05", 1, 900, "INSS", 200),
    l("2025-01-20", 2, 920, "Adiantamento Salarial", 800),
    l("2025-02-05", 3, 1, "Horas Normais", 2000),
    l("2025-02-05", 3, 920, "Adiantamento Salarial", 800),
    l("2025-07-10", 4, 1, "Férias", 2000),
    l("2025-07-10", 4, 2, "1/3 Férias", 666.67),
    l("2026-01-05", 5, 1, "Horas Normais", 2100),
  ]);

  it("período pelo mês de pagamento, inclusive nas pontas", () => {
    expect(filtrarCalculos(cs, { de: "2025-01", ate: "2025-02" }).map((c) => c.calculo).sort()).toEqual([1, 2, 3]);
    expect(filtrarCalculos(cs, { de: "2025-03" }).map((c) => c.calculo).sort()).toEqual([4, 5]);
  });

  it("tipo de folha", () => {
    expect(filtrarCalculos(cs, { tipos: ["ferias"] }).map((c) => c.calculo)).toEqual([4]);
    expect(filtrarCalculos(cs, { tipos: ["adiantamento", "ferias"] }).map((c) => c.calculo).sort()).toEqual([2, 4]);
    expect(filtrarCalculos(cs, { tipos: [] })).toHaveLength(5);
  });

  it("total do período, do ano e média por mês com pagamento", () => {
    const p = filtrarCalculos(cs, { de: "2025-01", ate: "2025-12" });
    const r = resumir(p, cs);
    // jan: (2000 - 200) + 800 ; fev: 2000 - 800 ; jul: 2666,67
    expect(r.liquido).toBe(6466.67);
    expect(r.proventos).toBe(7466.67);
    expect(r.descontos).toBe(1000); // INSS 200 + adiantamento descontado 800
    expect(r.ano).toBe(2025);
    expect(r.liquidoAno).toBe(6466.67);
    expect(r.meses.map((m) => m.mes)).toEqual(["2025-07", "2025-02", "2025-01"]);
    expect(r.meses[2]).toMatchObject({ liquido: 2600, calculos: 2 });
    expect(r.mediaMensal).toBe(2155.56);
  });

  it("o ano vem do último pagamento do período e respeita o filtro de tipo", () => {
    const r = resumir(filtrarCalculos(cs, { tipos: ["mensal"] }), cs, ["mensal"]);
    expect(r.ano).toBe(2026);
    expect(r.liquidoAno).toBe(2100);
    expect(r.liquido).toBe(1800 + 1200 + 2100);
  });

  it("sem nada no período, tudo zero", () => {
    const r = resumir([], cs, [], 2024);
    expect(r).toMatchObject({ liquido: 0, liquidoAno: 0, mediaMensal: 0, calculos: 0 });
  });

  it("soma por evento", () => {
    const s = somarPorEvento(filtrarCalculos(cs, { de: "2025-01", ate: "2025-12" }));
    const horas = s.find((e) => e.codigo === 1 && e.classe === "provento")!;
    expect(horas).toMatchObject({ vezes: 3, total: 6000 });
    expect(s[0].classe).toBe("provento");
  });
});
