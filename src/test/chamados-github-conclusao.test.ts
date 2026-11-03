import { describe, expect, it } from "vitest";
import { metricasGithubDaConclusao, somarMetricasGithub } from "@/pages/chamados/githubConclusao";

describe("métricas do GitHub na conclusão do chamado", () => {
  it("lê cada PR mergeada uma única vez e não perde métricas em uma reexecução incompleta", () => {
    const linhas = metricasGithubDaConclusao([
      { created_at: "2026-10-28T12:00:00Z", meta: { canal: "github", origem: "merge", pr_numero: 1016, pr_commits: 2, pr_linhas_adicionadas: 859, pr_arquivos_alterados: 7, pr_url: "https://github.com/exemplo/pr/1016" } },
      { created_at: "2026-10-28T13:00:00Z", meta: { canal: "github", origem: "merge", pr_numero: 1016, pr_commits: 99 } },
      { created_at: "2026-10-28T14:00:00Z", meta: { canal: "github", origem: "merge", pr_numero: 1017, pr_commits: 1, pr_linhas_adicionadas: 10, pr_arquivos_alterados: 1 } },
      { created_at: "2026-10-28T15:00:00Z", meta: { canal: "whatsapp", origem: "merge", pr_numero: 999 } },
    ]);

    expect(linhas).toEqual([
      expect.objectContaining({ numeroPr: 1016, commits: 99, linhasAdicionadas: 859, arquivosAlterados: 7 }),
      expect.objectContaining({ numeroPr: 1017, commits: 1, linhasAdicionadas: 10, arquivosAlterados: 1 }),
    ]);
    expect(somarMetricasGithub(linhas)).toEqual({ commits: 100, linhasAdicionadas: 869, arquivosAlterados: 8 });
  });

  it("ignora eventos antigos sem número da PR", () => {
    expect(metricasGithubDaConclusao([
      { created_at: "2026-10-28T12:00:00Z", meta: { canal: "github", origem: "merge", pr_linhas_adicionadas: 20 } },
    ])).toEqual([]);
  });
});
