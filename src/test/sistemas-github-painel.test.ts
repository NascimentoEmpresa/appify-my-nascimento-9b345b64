import { describe, it, expect } from "vitest";
import { fmtHoras, fmtLinhas, noPeriodo, porDev, rotuloPeriodoGh, serie, totais, type PrGithub } from "@/lib/sistemas/githubPainel";

// Painel do Desenvolvedor › GitHub (mig 20261007000015).

const pr = (n: number, autor: string, criado: string, extra: Partial<PrGithub> = {}): PrGithub => ({
  numero: n, titulo: `PR ${n}`, estado: "MERGED", autor, branch: autor, criado_em: criado,
  mergeado_em: new Date(new Date(criado).getTime() + 2 * 3_600_000).toISOString(), fechado_em: null,
  adicoes: 100, remocoes: 10, arquivos: 3, commits: 2, ...extra,
});
const devs = [{ login: "Tasuyuk1", nome: "Pablo", ativo: true }, { login: "EduardoJeiel007", nome: "Eduardo", ativo: true }];

describe("GitHub — painel do desenvolvedor", () => {
  const prs = [
    pr(1, "Tasuyuk1", "2026-09-01T10:00:00Z"),
    pr(2, "Tasuyuk1", "2026-09-20T10:00:00Z", { adicoes: 300, remocoes: 50, estado: "OPEN", mergeado_em: null }),
    pr(3, "EduardoJeiel007", "2026-10-01T10:00:00Z", { commits: 5 }),
  ];

  it("ranking por dev com nome, contagens, linhas e mediana até o merge", () => {
    const r = porDev(prs, devs);
    expect(r[0]).toMatchObject({ login: "Tasuyuk1", nome: "Pablo", prs: 2, mergeadas: 1, abertas: 1, commits: 4, adicoes: 400, remocoes: 60, linhasPorPr: 230, horasAteMerge: 2 });
    expect(r[1]).toMatchObject({ nome: "Eduardo", prs: 1, commits: 5 });
  });

  it("login sem nome cadastrado aparece como o próprio login", () => {
    expect(porDev([pr(9, "fulano", "2026-10-01T00:00:00Z")], devs)[0].nome).toBe("fulano");
  });

  it("totais e recorte por período", () => {
    expect(totais(prs)).toMatchObject({ prs: 3, mergeadas: 2, abertas: 1, commits: 9, adicoes: 500, remocoes: 70 });
    expect(noPeriodo(prs, 10, new Date("2026-10-05T00:00:00Z")).map((p) => p.numero)).toEqual([3]);
    expect(noPeriodo(prs, 0).length).toBe(3);
  });

  it("série por mês preenche os meses vazios e soma por dev", () => {
    const s = serie([pr(1, "Tasuyuk1", "2026-07-10T00:00:00Z"), pr(2, "Tasuyuk1", "2026-09-10T00:00:00Z"), pr(3, "EduardoJeiel007", "2026-09-11T00:00:00Z")],
      ["Tasuyuk1", "EduardoJeiel007"], () => 1, "mes");
    expect(s.map((x) => x.periodo)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(s[1]).toMatchObject({ Tasuyuk1: 0, EduardoJeiel007: 0 });
    expect(s[2]).toMatchObject({ Tasuyuk1: 1, EduardoJeiel007: 1 });
  });

  it("série por semana começa na segunda-feira", () => {
    const s = serie([pr(1, "Tasuyuk1", "2026-10-07T12:00:00Z")], ["Tasuyuk1"], (p) => p.commits, "semana");
    expect(s[0]).toMatchObject({ periodo: "2026-10-05", Tasuyuk1: 2 });
  });

  it("formatos", () => {
    expect(rotuloPeriodoGh("2026-09")).toBe("set/26");
    expect(rotuloPeriodoGh("2026-09-28")).toBe("28/09");
    expect(fmtLinhas(3130)).toBe("3.130");
    expect(fmtLinhas(226604)).toBe("226,6 mil");
    expect(fmtLinhas(1_250_000)).toBe("1,3 mi");
    expect(fmtHoras(0.5)).toBe("30 min");
    expect(fmtHoras(6.5)).toBe("6,5 h");
    expect(fmtHoras(72)).toBe("3 dias");
    expect(fmtHoras(null)).toBe("—");
  });
});
