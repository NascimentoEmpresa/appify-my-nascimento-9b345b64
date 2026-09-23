/** Repositório cuja atividade entra no relatório de Hora Extra. */
export const REPOSITORIO_HORA_EXTRA_GITHUB = "NascimentoEmpresa/appify-my-nascimento-9b345b64";

export interface MetricasPrHoraExtra {
  numero: number;
  url: string;
  titulo: string;
  linhas_adicionadas: number;
  commits: number;
  arquivos_adicionados: number;
}

export interface LinhaRelatorioPrHoraExtra {
  pr_linhas_adicionadas?: number | null;
  pr_commits?: number | null;
  pr_arquivos_adicionados?: number | null;
}

/**
 * Aceita tanto o formato que as pessoas usam no GitHub (#624) quanto apenas
 * os algarismos. Não remove texto no meio: "PR 624" precisa ser corrigido
 * pelo usuário para evitar associar a PR errada por engano.
 */
export function normalizarNumeroPr(valor: string): number | null {
  const semCerquilha = valor.trim().replace(/^#/, "").trim();
  if (!/^\d+$/.test(semCerquilha)) return null;
  const numero = Number(semCerquilha);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

export function urlPrHoraExtra(numero: number): string {
  return `https://github.com/${REPOSITORIO_HORA_EXTRA_GITHUB}/pull/${numero}`;
}

export function totalizarMetricasPr(linhas: Array<Partial<MetricasPrHoraExtra>>) {
  return linhas.reduce(
    (total, linha) => ({
      linhas_adicionadas: total.linhas_adicionadas + Number(linha.linhas_adicionadas || 0),
      commits: total.commits + Number(linha.commits || 0),
      arquivos_adicionados: total.arquivos_adicionados + Number(linha.arquivos_adicionados || 0),
    }),
    { linhas_adicionadas: 0, commits: 0, arquivos_adicionados: 0 },
  );
}

export function totalizarLinhasRelatorioPr(linhas: LinhaRelatorioPrHoraExtra[]) {
  return totalizarMetricasPr(
    linhas.map(({ pr_linhas_adicionadas, pr_commits, pr_arquivos_adicionados }) => ({
      linhas_adicionadas: pr_linhas_adicionadas ?? 0,
      commits: pr_commits ?? 0,
      arquivos_adicionados: pr_arquivos_adicionados ?? 0,
    })),
  );
}

export const ERRO_RELATORIO_SEM_CHAMADO =
  "A hora extra precisa de pelo menos um chamado no relatório.";

/**
 * Remove uma linha do relatório de conclusão — inclusive um chamado que veio
 * da própria solicitação. O que foi planejado nem sempre é o que deu para
 * fazer: o chamado que não saiu na HE precisa sair da tabela, senão trava o
 * envio pela regra de "uma PR para cada linha".
 *
 * A única linha que não sai é a última: hora extra sem nenhum chamado não tem
 * o que o gestor validar.
 */
export function removerLinhaRelatorioPr<T extends { chave: string }>(
  originais: T[],
  adicionais: T[],
  chave: string,
): { originais: T[]; adicionais: T[]; erro?: string } {
  const existe = [...originais, ...adicionais].some((linha) => linha.chave === chave);
  if (!existe) return { originais, adicionais };
  if (originais.length + adicionais.length <= 1) {
    return { originais, adicionais, erro: ERRO_RELATORIO_SEM_CHAMADO };
  }
  return {
    originais: originais.filter((linha) => linha.chave !== chave),
    adicionais: adicionais.filter((linha) => linha.chave !== chave),
  };
}
