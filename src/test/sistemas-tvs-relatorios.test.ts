import { describe, it, expect } from "vitest";
import {
  PALCO, corDoRelatorioTv, duracaoRecomendada, escalaDoPalco, maiores, mesesTurnoverTv, misturarCor, numeroCurto, paginasDoRelatorio,
  rankingsParaTv, rotuloTv, semCodigo, semMesesVaziosNoInicio, serieDaDireita, statusEmGrupos, tempoDaPaginaMs, textoVariacao, type DadosRelTv,
} from "@/lib/tv/relatorioTv";
import { RELATORIOS_TV, paginasRelatorioTv } from "@/lib/tv/tv";
import { SISTEMAS } from "@/pages/relatorios/sistemas";

// Relatórios na TV (mig 20261008000004): todos os relatórios, palco fixo que
// não corta, páginas que se revezam.

describe("todos os relatórios do módulo estão na TV", () => {
  it("o Geral, os 10 sistemas e o Vagas — Dashboard", () => {
    const slugs = RELATORIOS_TV.map((r) => r.slug);
    expect(slugs).toContain("geral");
    expect(slugs).toContain("vagas");
    for (const s of SISTEMAS) expect(slugs).toContain(s.slug);
  });
  it("páginas e tempo recomendado", () => {
    expect(paginasRelatorioTv("vagas")).toBe(3);
    expect(paginasRelatorioTv("geral")).toBe(1);
    expect(duracaoRecomendada(1)).toBe(30);
    expect(duracaoRecomendada(3)).toBe(45);
  });
  it("cada relatório tem a sua cor", () => {
    expect(corDoRelatorioTv("demissoes")).toBe("#dc2626");
    expect(corDoRelatorioTv("vagas")).toBe("#4338ca");
    expect(corDoRelatorioTv("nao-existe")).toBe("#1e3a8a");
  });
});

describe("palco fixo: encolhe para caber, nunca corta", () => {
  it("Full HD, 4K, 1366×768 e tela que não é 16:9", () => {
    const util = 1 - 0.05;
    expect(escalaDoPalco(1920, 1080)).toBeCloseTo(util);
    expect(escalaDoPalco(3840, 2160)).toBeCloseTo(2 * util);
    for (const [w, h] of [[1366, 768], [1280, 1024], [1024, 600], [2560, 1080]]) {
      const e = escalaDoPalco(w, h);
      expect(PALCO.largura * e).toBeLessThanOrEqual(w);
      expect(PALCO.altura * e).toBeLessThanOrEqual(h);
    }
    expect(escalaDoPalco(0, 0)).toBe(1);
  });
});

describe("páginas", () => {
  it("o tempo do item se divide entre as páginas, no mínimo 8 s cada", () => {
    expect(tempoDaPaginaMs(45, 3)).toBe(15_000);
    expect(tempoDaPaginaMs(10, 3)).toBe(8_000);
    expect(tempoDaPaginaMs(30, 1)).toBe(30_000);
  });

  it("relatório padrão sem ranking nem recentes fica só com o Resumo", () => {
    const base = {
      tipo: "sistema" as const, slug: "ferias", contrato: null, titulo: "Férias", periodo: { de: "", ate: "" }, kpis: [],
      mensal: { series: [], dados: [] }, por_status: [], rotulo_item: "férias",
    };
    expect(paginasDoRelatorio({ ...base, rankings: [], recentes: { colunas: [], linhas: [] } }).map((p) => p.chave)).toEqual(["sistema-resumo"]);
    expect(paginasDoRelatorio({ ...base, rankings: [{ titulo: "x", itens: [{ nome: "a", n: 1 }] }], recentes: { colunas: [], linhas: [] } })).toHaveLength(2);
  });

  it("turn-over sem demissão nem efetivo não mostra páginas vazias", () => {
    const painel = { ano: 2026, mes: null, meses: [1], de: "", ate: "", fator_projecao: 1, efetivo_medio: 0, mensal: [], por_empresa: [], por_contrato: [], causas: [], contratos: [] };
    const d: DadosRelTv = { tipo: "turnover", painel, filial: null, contrato: null };
    expect(paginasDoRelatorio(d).map((p) => p.chave)).toEqual(["turnover-resumo"]);
  });
});

describe("contas de apoio", () => {
  it("turn-over: os meses do ano corrente dentro do período (a conta do tv_relatorio)", () => {
    expect(mesesTurnoverTv("2025-11-01", "2026-10-08")).toEqual({ ano: 2026, meses: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    expect(mesesTurnoverTv("2026-10-01", "2026-10-08")).toEqual({ ano: 2026, meses: [10] });
    expect(mesesTurnoverTv("2026-08-01", "2026-10-08")).toEqual({ ano: 2026, meses: [8, 9, 10] });
    // 3 meses em janeiro: só janeiro é do ano corrente
    expect(mesesTurnoverTv("2025-11-01", "2026-01-10")).toEqual({ ano: 2026, meses: [1] });
  });

  it("série que esmagaria as outras vai para a linha da direita", () => {
    const series = [{ chave: "ativos", rotulo: "Ativos" }, { chave: "admitidos", rotulo: "Admitidos" }, { chave: "desligados", rotulo: "Desligados" }];
    expect(serieDaDireita(series, [{ ativos: 2400, admitidos: 150, desligados: 90 }])).toBe("ativos");
    expect(serieDaDireita(series, [{ ativos: 300, admitidos: 150, desligados: 90 }])).toBeNull();
    expect(serieDaDireita([{ chave: "a", rotulo: "A" }, { chave: "taxa", rotulo: "%", eixo: "direita" }], [])).toBe("taxa");
  });

  it("status em três grupos, maiores e o resto", () => {
    expect(statusEmGrupos([{ nome: "A", n: 3, grupo: "aberto" }, { nome: "B", n: 5, grupo: "concluido" }, { nome: "C", n: 2, grupo: "concluido" }]))
      .toEqual({ aberto: 3, concluido: 7, recusado: 0, total: 10 });
    expect(maiores([{ n: 1 }, { n: 9 }, { n: 4 }, { n: 2 }], 2)).toEqual({ itens: [{ n: 9 }, { n: 4 }], resto: 3 });
  });

  it("privacidade: ranking por pessoa não vai para a TV (ela fica em área comum)", () => {
    const rs = [
      { titulo: "Orientações por categoria", itens: [{ nome: "Trabalhista", n: 6 }] },
      { titulo: "Quem perguntou", itens: [{ nome: "FULANO DE TAL", n: 3 }] },
      { titulo: "Solicitante", itens: [{ nome: "CICLANO", n: 1 }] },
      { titulo: "Motivo da demissão", itens: [] },
      { titulo: "Cargo", itens: [{ nome: "PORTEIRO", n: 2 }] },
    ];
    expect(rankingsParaTv(rs).map((r) => r.titulo)).toEqual(["Orientações por categoria", "Cargo"]);
  });

  it("meses vazios do começo saem; vazio no meio fica; mínimo de 3", () => {
    const ds = [{ mes: "a", t: 0 }, { mes: "b", t: 0 }, { mes: "c", t: 4 }, { mes: "d", t: 0 }, { mes: "e", t: 2 }];
    expect(semMesesVaziosNoInicio(ds, ["t"]).map((d) => d.mes)).toEqual(["c", "d", "e"]);
    expect(semMesesVaziosNoInicio([{ mes: "a", t: 0 }, { mes: "b", t: 0 }, { mes: "c", t: 0 }, { mes: "d", t: 0 }], ["t"])).toHaveLength(3);
  });

  it("rótulos crus das RPCs", () => {
    expect(rotuloTv("em_andamento")).toBe("Em andamento");
    expect(rotuloTv("uniforme")).toBe("Uniforme");
    expect(rotuloTv(null)).toBe("—");
  });

  it("textos e cores", () => {
    expect(textoVariacao(12.34)).toEqual({ texto: "+12,3%", sobe: true });
    expect(textoVariacao(-8)).toEqual({ texto: "−8%", sobe: false });
    expect(textoVariacao(0)).toBeNull();
    expect(misturarCor("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(misturarCor("azul", "#ffffff", 0.5)).toBe("azul");
    expect(semCodigo("1050 - UFRGS - LIMPEZA GERAL - 047/2022")).toBe("UFRGS - LIMPEZA GERAL - 047/2022");
    expect(numeroCurto(12345)).toBe("12,3 mil");
    expect(numeroCurto(950)).toBe("950");
  });
});
