// SIS-2026-0658: conciliação da origem dos dados (regras puras).
import { describe, expect, it } from "vitest";
import { conciliar, conferirPlanilha, origemDaNf, origemDoFluxo, type Leitura } from "@/pages/financeiro/conciliacao-origem/regras";

interface L { o: "sistema" | "excel"; v: number; d: string | null; conta?: boolean }
const leitura: Leitura<L> = { origem: (l) => l.o, valor: (l) => l.v, data: (l) => l.d, contabiliza: (l) => l.conta !== false };

describe("conciliar", () => {
  const linhas: L[] = [
    { o: "sistema", v: 100, d: "2026-09-10" },
    { o: "sistema", v: -30.1, d: "2026-09-30" },
    { o: "excel", v: 50.25, d: "2026-01-02" },
    { o: "excel", v: -20, d: "2026-03-01" },
  ];

  it("total = sistema + excel, sem diferença", () => {
    const c = conciliar(linhas, leitura);
    expect(c.sistema.valor).toBe(69.9);
    expect(c.excel.valor).toBe(30.25);
    expect(c.total.valor).toBe(100.15);
    expect(c.diferenca).toBe(0);
    expect(c.total.qtd).toBe(4);
  });

  it("separa entradas e saídas e acha o período de cada origem", () => {
    const c = conciliar(linhas, leitura);
    expect(c.excel).toMatchObject({ qtd: 2, entradas: 50.25, saidas: 20, de: "2026-01-02", ate: "2026-03-01" });
    expect(c.sistema).toMatchObject({ qtd: 2, entradas: 100, saidas: 30.1, de: "2026-09-10", ate: "2026-09-30" });
  });

  it("linha que não contabiliza conta na quantidade mas não no valor", () => {
    const c = conciliar([...linhas, { o: "excel", v: 999, d: "2026-05-05", conta: false }], leitura);
    expect(c.excel.qtd).toBe(3);
    expect(c.excel.valor).toBe(30.25);
    expect(c.diferenca).toBe(0);
  });

  it("lista vazia", () => {
    const c = conciliar([], leitura);
    expect(c.total).toMatchObject({ qtd: 0, valor: 0, de: null, ate: null });
  });
});

describe("origem", () => {
  it("Fluxo: importacao_historica é Excel, o resto é Sistema", () => {
    expect(origemDoFluxo("importacao_historica")).toBe("excel");
    expect(["malote", "debito_automatico", "cartao_fatura", "aplicacao_financeira"].every((o) => origemDoFluxo(o) === "sistema")).toBe(true);
  });
  it("NF: coluna origem manda; sem ela, created_by nulo = planilha", () => {
    expect(origemDaNf({ origem: "excel_antigo", created_by: "x" })).toBe("excel");
    expect(origemDaNf({ origem: "sistema", created_by: null })).toBe("sistema");
    expect(origemDaNf({ created_by: null })).toBe("excel");
    expect(origemDaNf({ created_by: "u1" })).toBe("sistema");
  });
});

describe("conferir a planilha carregada", () => {
  const resumo = [
    { situacao: "excluida_por_usuario", qtd: 2, entradas: 0, saidas: 40 },
    { situacao: "em_uso", qtd: 10, entradas: 500, saidas: 200 },
    { situacao: "ja_existe_no_erp", qtd: 3, entradas: 0, saidas: 90 },
  ];

  it("soma tudo o que subiu e ordena as situações", () => {
    const c = conferirPlanilha(resumo, 300);
    expect(c.carregada).toEqual({ qtd: 15, valor: 170 });
    expect(c.emUso).toEqual({ qtd: 10, valor: 300 });
    expect(c.linhas.map((l) => l.situacao)).toEqual(["em_uso", "ja_existe_no_erp", "excluida_por_usuario"]);
    expect(c.diferencaComTela).toBe(0);
  });

  it("diferença com a tela aparece quando há valor ajustado no Fluxo", () => {
    expect(conferirPlanilha(resumo, 250).diferencaComTela).toBe(50);
  });
});
