import { ExternalLink, GitPullRequest } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Evento } from "./types";
import { metricasGithubDaConclusao, somarMetricasGithub } from "./githubConclusao";

const numero = (valor: number | null) => valor?.toLocaleString("pt-BR") ?? "—";

/** Dados objetivos da PR que encerrou o chamado, exibidos ao time e ao solicitante. */
export function InformacoesGithubChamado({ eventos }: { eventos: Evento[] }) {
  const linhas = metricasGithubDaConclusao(eventos);
  if (!linhas.length) return null;

  const total = somarMetricasGithub(linhas);
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-3">
        <GitPullRequest className="h-4 w-4 text-primary" />
        <div>
          <p className="text-sm font-bold">Informações do GitHub na conclusão</p>
          <p className="text-xs text-muted-foreground">Métricas preenchidas automaticamente quando a PR é mergeada.</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-primary text-primary-foreground">
            <tr className="text-left text-[11px] uppercase">
              <th className="px-4 py-2 font-semibold">Número PR</th>
              <th className="px-4 py-2 text-right font-semibold">Linhas de código adicionadas</th>
              <th className="px-4 py-2 text-right font-semibold">Commits criados</th>
              <th className="px-4 py-2 text-right font-semibold">Arquivos alterados</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => (
              <tr key={linha.numeroPr} className="border-b last:border-0">
                <td className="px-4 py-3 font-medium">
                  {linha.urlPr ? (
                    <a className="inline-flex items-center gap-1 text-primary hover:underline" href={linha.urlPr} target="_blank" rel="noreferrer">
                      #{linha.numeroPr} <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : `#${linha.numeroPr}`}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{numero(linha.linhasAdicionadas)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{numero(linha.commits)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{numero(linha.arquivosAlterados)}</td>
              </tr>
            ))}
          </tbody>
          {linhas.length > 1 && (
            <tfoot className="bg-muted/50 text-xs font-bold uppercase">
              <tr>
                <td className="px-4 py-2">Total · {linhas.length} PRs</td>
                <td className="px-4 py-2 text-right tabular-nums">{numero(total.linhasAdicionadas)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{numero(total.commits)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{numero(total.arquivosAlterados)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}
