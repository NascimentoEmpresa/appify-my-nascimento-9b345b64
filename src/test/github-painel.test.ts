import { describe, expect, it } from "vitest";
import {
  calendario, contadores, diaLocal, ehBot, filtrarPainel, FILTRO_GITHUB_PADRAO, inicioSemana, mensal, mensalPorAutor, mensalPrs, mesesEntre, normalizarPainel,
  porAutor, porBranch, punchcard, semanal, sequencias, tamanhoPrs, tiposCommit, type PainelGithubBruto, type PrGithub,
} from "@/lib/sistemas/githubPainel";

const pr = (o: Partial<PrGithub>): PrGithub => ({
  numero: 1, titulo: "x", url: null, estado: "merged", rascunho: false, autor_login: "Tasuyuk1", autor_avatar: "a.png",
  branch_origem: "pablo", branch_destino: "main", chamado: null, criado_em: "2026-10-01T12:00:00Z", atualizado_em: "2026-10-01T12:00:00Z",
  fechado_em: null, mergeado_em: "2026-10-01T18:00:00Z", mergeado_por: null, commits: 2, adicoes: 100, remocoes: 10, arquivos: 5,
  migrations: 1, linhas_sql: 50, migrations_lista: ["x.sql"], ...o,
});

const bruto: PainelGithubBruto = {
  sync: null, pendentes: 0,
  prs: [
    pr({ numero: 3, chamado: "SIS-2026-0001" }),
    pr({ numero: 4, autor_login: "eduardo", branch_origem: "eduardo", estado: "open", mergeado_em: null, migrations: 3, linhas_sql: 300, criado_em: "2026-09-15T12:00:00Z" }),
    pr({ numero: 5, autor_login: "dependabot[bot]", branch_origem: "dep", estado: "closed", mergeado_em: null, migrations: 0 }),
  ],
  commits: [
    ["aaaaaaa", 3, "Tasuyuk1", "Pablo", "2026-10-06T15:00:00", "c1"],
    ["bbbbbbb", 3, "Tasuyuk1", "Pablo", "2026-10-05T15:00:00", "c2"],
    ["ccccccc", 4, null, "Eduardo", "2026-09-15T10:00:00", "c3"],
    ["ddddddd", 5, "dependabot[bot]", null, "2026-10-01T10:00:00", "bump"],
  ],
};
const p = normalizarPainel(bruto);
const HOJE = new Date(2026, 9, 7, 12);
const SEM_BOTS = { ...FILTRO_GITHUB_PADRAO, semBots: true };

describe("painel GitHub", () => {
  it("autor do commit cai para o nome do git sem login, e reconhece bots", () => {
    expect(p.commits.map((c) => c.autor)).toEqual(["Tasuyuk1", "Tasuyuk1", "Eduardo", "dependabot[bot]"]);
    expect(ehBot("dependabot[bot]")).toBe(true);
    expect(ehBot("Tasuyuk1")).toBe(false);
  });

  it("filtro tira bots e respeita autor/período", () => {
    const f = filtrarPainel(p, SEM_BOTS, HOJE);
    expect(f.commits).toHaveLength(3);
    expect(f.prs.map((x) => x.numero)).toEqual([3, 4]);
    expect(filtrarPainel(p, { ...SEM_BOTS, dias: 10 }, HOJE).commits).toHaveLength(2);
    expect(filtrarPainel(p, { ...SEM_BOTS, autor: "eduardo" }, HOJE).prs).toHaveLength(1);
  });

  it("contadores", () => {
    const c = contadores(filtrarPainel(p, SEM_BOTS, HOJE));
    expect(c).toMatchObject({ commits: 3, prs: 2, mergeadas: 1, abertas: 1, migrations: 4, linhasSql: 350, comChamado: 1, semChamado: 1 });
    expect(c.medianaHorasAteMerge).toBe(6);
  });

  it("história da main: merges e bots entram no total por padrão (igual ao GitHub)", () => {
    expect(FILTRO_GITHUB_PADRAO.semBots).toBe(false);
    const comMain = normalizarPainel({ ...bruto, commits: [...bruto.commits, ["eeeeeee", null, "haggltda", null, "2026-10-06T16:00:00", "Merge pull request #3", true]] });
    expect(comMain.commits.find((x) => x.sha === "eeeeeee")?.merge).toBe(true);
    expect(comMain.commits.find((x) => x.sha === "aaaaaaa")?.merge).toBe(false);   // array antigo, sem o 7º item
    const c = contadores(filtrarPainel(comMain, FILTRO_GITHUB_PADRAO, HOJE));
    expect(c).toMatchObject({ commits: 5, commitsMerge: 1, commitsBot: 1 });
  });

  it("calendário de 53 semanas com níveis", () => {
    const cal = calendario(p.commits, HOJE);
    expect(cal).toHaveLength(53);
    expect(cal.every((s) => s.length === 7)).toBe(true);
    const cel = cal.flat().find((x) => x.dia === diaLocal("2026-10-06T15:00:00"))!;
    expect(cel.n).toBe(1);
    expect(cel.nivel).toBeGreaterThan(0);
    expect(cal.flat().filter((x) => x.futuro).length).toBeLessThan(7);
  });

  it("sequências de dias com commit", () => {
    expect(sequencias(p.commits.filter((c) => c.autor === "Tasuyuk1"), HOJE)).toEqual({ atual: 2, maior: 2 });
  });

  it("ranking por autor junta commits e PRs", () => {
    const r = porAutor(filtrarPainel(p, SEM_BOTS, HOJE));
    const pablo = r.find((x) => x.autor === "Tasuyuk1")!;
    expect(pablo).toMatchObject({ commits: 2, prs: 1, mergeadas: 1, migrations: 1, diasAtivos: 2, sequenciaMaior: 2, avatar: "a.png" });
    expect(r.find((x) => x.autor === "eduardo")!.migrations).toBe(3);
  });

  it("semana a semana, punchcard, branches e mês a mês", () => {
    expect(inicioSemana("2026-10-07T12:00:00")).toBe("2026-10-05");
    const s = semanal(p.commits, 4, 5, HOJE);
    expect(s.dados).toHaveLength(4);
    expect(s.dados[3]).toMatchObject({ semana: "2026-10-05", Tasuyuk1: 2 });
    const pc = punchcard(p.commits);
    expect(pc.flat().reduce((a, b) => a + b, 0)).toBe(4);
    expect(porBranch(p.prs)[0]).toMatchObject({ branch: "pablo", prs: 1 });
    expect(mensalPrs(p.prs).map((m) => m.mes)).toEqual(["2026-09", "2026-10"]);
  });

  it("mês a mês: preenche meses vazios, acumula e separa merges/bots", () => {
    expect(mesesEntre("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    const comMerge = normalizarPainel({ ...bruto, commits: [...bruto.commits,
      ["fffffff", null, "haggltda", null, "2026-07-10T12:00:00", "Merge pull request #1", true]] });
    const m = mensal(comMerge);
    expect(m.map((x) => x.mes)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(m[1]).toMatchObject({ commits: 0, prs: 0, rotulo: "ago/26" });       // agosto vazio aparece zerado
    expect(m[0]).toMatchObject({ commits: 1, commitsMerge: 1, commitsPessoas: 0 });
    expect(m[3]).toMatchObject({ commits: 3, commitsBot: 1, commitsPessoas: 2, commitsAcumulados: 5, prs: 2, mergeadas: 1, comChamado: 1, diasAtivos: 3 });
    expect(m[3].medianaHorasAteMerge).toBe(6);
    const pp = mensalPorAutor(comMerge.commits);
    expect(pp.autores).toEqual(["dependabot[bot]", "Eduardo", "haggltda", "Tasuyuk1"]);
    expect(pp.dados.find((d) => d.mes === "2026-10")).toMatchObject({ Tasuyuk1: 2, "dependabot[bot]": 1, Eduardo: 0 });
  });

  it("tamanho das PRs e tipos de commit", () => {
    const t = tamanhoPrs([...p.prs, pr({ numero: 9, adicoes: 3000, remocoes: 0 }), pr({ numero: 10, adicoes: null, remocoes: null })]);
    expect(t.map((x) => x.prs)).toEqual([0, 0, 3, 0, 1]);   // 110 linhas cai em Média (101–500); sem detalhe fica fora
    const tipos = tiposCommit(normalizarPainel({ ...bruto, commits: [
      ["1", null, "a", null, "2026-10-01T10:00:00", "SIS-2026-0001: x"], ["2", null, "a", null, "2026-10-01T10:00:00", "[SEM-CHAMADO] y"],
      ["3", null, "a", null, "2026-10-01T10:00:00", "Merge branch main", true], ["4", null, "gpt-engineer-app[bot]", null, "2026-10-01T10:00:00", "Changes"],
      ["5", null, "a", null, "2026-10-01T10:00:00", "ajuste"]] }).commits);
    expect(Object.fromEntries(tipos.map((x) => [x.tipo, x.n]))).toEqual({ "Com chamado (SIS-…)": 1, "Sem chamado": 1, "Merge": 1, "Bots (Lovable etc.)": 1, "Outros": 1 });
  });
});
