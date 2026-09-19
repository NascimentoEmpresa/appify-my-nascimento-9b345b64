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
