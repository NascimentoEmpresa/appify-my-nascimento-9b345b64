import { describe, expect, it } from "vitest";
import {
  ativoNaData, ateData, descreverFiltros, diaBrasilia, metricasVideo, pctConclusao, situacaoAte,
  type ColaboradorRegra, type EventoVideo,
} from "@/lib/treinamentos/participacaoVideos";

// SIS-2026-0914 — regra de contagem da Participação nos vídeos. É o espelho
// da trn_participacao_base (mig 20261117091400); o mesmo cenário foi rodado
// contra a migration num Postgres descartável (PGlite) com os mesmos números.

const D = "2026-10-30";
const col = (empresa: number, cadastro: number, extra: Partial<ColaboradorRegra> = {}): ColaboradorRegra => ({
  empresa, cadastro, admissao: "2025-01-10", desligamento: null, demitido: false, ...extra,
});

describe("data de corte (fim do dia em Brasília)", () => {
  it("23:30 do dia conta; 00:10 do dia seguinte não", () => {
    expect(ateData("2026-10-30T23:30:00-03:00", D)).toBe(true);
    expect(ateData("2026-10-31T00:10:00-03:00", D)).toBe(false);
    // 02:30 UTC do dia 31 ainda é 30/10 em Brasília.
    expect(diaBrasilia("2026-10-31T02:30:00Z")).toBe("2026-10-30");
  });
  it("sem data não conta", () => {
    expect(ateData(null, D)).toBe(false);
  });
});

describe("deveria realizar na data", () => {
  it("admitido depois da data fica fora", () => {
    expect(ativoNaData(col(5, 300, { admissao: "2026-11-01" }), D)).toBe(false);
  });
  it("desligado depois da data conta; desligado até a data não", () => {
    expect(ativoNaData(col(1, 400, { demitido: true, desligamento: "2026-11-10" }), D)).toBe(true);
    expect(ativoNaData(col(1, 500, { demitido: true, desligamento: "2026-10-20" }), D)).toBe(false);
    expect(ativoNaData(col(1, 501, { demitido: true, desligamento: D }), D)).toBe(false);
  });
  it("demitido sem data de desligamento e sem admissão ficam fora", () => {
    expect(ativoNaData(col(1, 600, { demitido: true }), D)).toBe(false);
    expect(ativoNaData(col(1, 601, { admissao: null }), D)).toBe(false);
  });
});

describe("situação até a data", () => {
  it("conclusão posterior à data vira 'em andamento'", () => {
    expect(situacaoAte(["2026-10-15T09:00:00-03:00"], "2026-11-02T10:00:00-03:00", D)).toBe("em_andamento");
    expect(situacaoAte(["2026-10-15T09:00:00-03:00"], "2026-10-20T10:00:00-03:00", D)).toBe("concluido");
  });
  it("acesso só depois da data é 'não iniciado'", () => {
    expect(situacaoAte(["2026-11-01T09:00:00-03:00"], null, D)).toBe("nao_iniciado");
    expect(situacaoAte([], null, D)).toBe("nao_iniciado");
  });
});

describe("métricas por vídeo — pessoas distintas", () => {
  // Mesmo cenário do teste da migration no PGlite.
  const colaboradores = [
    col(1, 100), col(1, 100),                                     // ANA repetida na EMPREGADOS
    col(2, 200),                                                  // BRUNO
    col(5, 300, { admissao: "2026-11-01" }),                      // CARLA, admitida depois
    col(1, 400, { demitido: true, desligamento: "2026-11-10" }),  // DIEGO, saiu depois
    col(1, 500, { demitido: true, desligamento: "2026-10-20" }),  // EVA, saiu antes
    col(2, 600),                                                  // FABIO, outro contrato
  ];
  const noPublico = (c: ColaboradorRegra) => c.cadastro !== 600;  // curso não liberado ao contrato do FABIO
  const eventos: EventoVideo[] = [
    { empresa: 1, cadastro: 100, aula: "v1", acessos: ["2026-10-10T09:00:00-03:00", "2026-10-11T09:00:00-03:00", "2026-10-12T09:00:00-03:00"], conclusao: "2026-10-20T10:00:00-03:00" },
    { empresa: 1, cadastro: 100, aula: "v1", acessos: ["2026-10-12T09:00:00-03:00"], conclusao: null }, // 2º aluno da ANA
    { empresa: 2, cadastro: 200, aula: "v1", acessos: ["2026-10-15T09:00:00-03:00"], conclusao: "2026-11-02T10:00:00-03:00" },
    { empresa: 1, cadastro: 400, aula: "v1", acessos: [], conclusao: "2026-09-25T08:00:00-03:00" },
    { empresa: 1, cadastro: 500, aula: "v1", acessos: ["2026-10-05T09:00:00-03:00"], conclusao: null },
  ];

  it("conta cada pessoa uma vez e respeita a data", () => {
    const m = metricasVideo("v1", colaboradores, noPublico, eventos, D);
    expect(m).toEqual({ publico: 3, acessaram: 3, concluiram: 2, acessaram_nao_concluiram: 1, nao_acessaram: 0 });
    // ANA abriu 4 vezes em 2 cadastros repetidos: 1 pessoa.
  });

  it("quem acessou fica no público mesmo fora da regra do curso", () => {
    const m = metricasVideo("v1", colaboradores, noPublico,
      [...eventos, { empresa: 2, cadastro: 600, aula: "v1", acessos: ["2026-10-30T23:30:00-03:00"], conclusao: null }], D);
    expect(m.publico).toBe(4);
    expect(m.acessaram).toBe(4);
  });

  it("numa data anterior, nada do que veio depois entra", () => {
    const m = metricasVideo("v1", colaboradores, noPublico, eventos, "2026-10-11");
    // Ativos: ANA, BRUNO, DIEGO, EVA (ainda não tinha saído). Acessaram: DIEGO (09/25), EVA (10/05), ANA (10/10).
    expect(m).toEqual({ publico: 4, acessaram: 3, concluiram: 1, acessaram_nao_concluiram: 2, nao_acessaram: 1 });
  });

  it("% de conclusão com uma casa", () => {
    expect(pctConclusao({ publico: 3, concluiram: 2 })).toBe(66.7);
    expect(pctConclusao({ publico: 0, concluiram: 0 })).toBe(0);
  });
});

describe("cabeçalho da exportação", () => {
  it("diz a data e os filtros aplicados", () => {
    const linhas = descreverFiltros(
      { data: D, curso: "c1", aula: null, empresa: 2, contrato: "HOSPITAL X", cargo: null },
      { curso: "NR-35", aula: null },
      { situacao: "concluido", busca: "  ana " },
    );
    expect(linhas[0]).toContain("Situação até 30/10/2026");
    expect(linhas).toContain("Treinamento: NR-35");
    expect(linhas).toContain("Empresa: SN");
    expect(linhas).toContain("Contrato: HOSPITAL X");
    expect(linhas).toContain("Situação: Concluído");
    expect(linhas).toContain("Busca por nome/cadastro: ana");
  });
});
