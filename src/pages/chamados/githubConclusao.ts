import type { Evento } from "./types";

export interface MetricaGithubConclusao {
  numeroPr: number;
  urlPr: string | null;
  commits: number | null;
  linhasAdicionadas: number | null;
  arquivosAlterados: number | null;
  concluidaEm: string;
}

const inteiroNaoNegativo = (valor: unknown) =>
  typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0 ? valor : null;

/** Dados gravados pelo GitHub quando a PR é mergeada e o chamado é concluído. */
export function metricasGithubDaConclusao(eventos: Pick<Evento, "meta" | "created_at">[]): MetricaGithubConclusao[] {
  const porPr = new Map<number, MetricaGithubConclusao>();

  [...eventos]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .forEach((evento) => {
      const meta = evento.meta ?? {};
      if (meta.canal !== "github" || meta.origem !== "merge") return;

      const numeroPr = inteiroNaoNegativo(meta.pr_numero);
      // PR #0 não existe; eventos antigos podem não ter esse dado.
      if (!numeroPr) return;

      const atual = porPr.get(numeroPr);
      const proxima = {
        numeroPr,
        urlPr: typeof meta.pr_url === "string" && meta.pr_url.trim() ? meta.pr_url : null,
        commits: inteiroNaoNegativo(meta.pr_commits),
        linhasAdicionadas: inteiroNaoNegativo(meta.pr_linhas_adicionadas),
        arquivosAlterados: inteiroNaoNegativo(meta.pr_arquivos_alterados),
        concluidaEm: evento.created_at,
      };

      // Reexecuções do workflow não devem apagar uma métrica válida se um
      // payload posterior vier incompleto. O evento mais recente continua
      // prevalecendo sempre que ele trouxer o campo.
      porPr.set(numeroPr, atual ? {
        numeroPr,
        urlPr: atual.urlPr ?? proxima.urlPr,
        commits: atual.commits ?? proxima.commits,
        linhasAdicionadas: atual.linhasAdicionadas ?? proxima.linhasAdicionadas,
        arquivosAlterados: atual.arquivosAlterados ?? proxima.arquivosAlterados,
        concluidaEm: atual.concluidaEm,
      } : proxima);
    });

  return [...porPr.values()].sort((a, b) => a.numeroPr - b.numeroPr);
}

export function somarMetricasGithub(linhas: MetricaGithubConclusao[]) {
  const somar = (campo: "commits" | "linhasAdicionadas" | "arquivosAlterados") => {
    const valores = linhas.map((linha) => linha[campo]).filter((valor): valor is number => valor !== null);
    return valores.length === linhas.length ? valores.reduce((total, valor) => total + valor, 0) : null;
  };

  return {
    commits: somar("commits"),
    linhasAdicionadas: somar("linhasAdicionadas"),
    arquivosAlterados: somar("arquivosAlterados"),
  };
}
