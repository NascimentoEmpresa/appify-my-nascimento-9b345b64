// SIS-2026-0781: filtro de Competência do Fluxo de Caixa em intervalo de meses (o "Ver todos os lançamentos" do Fechamento da Empresa abre
// o Fluxo com vários meses). Só o primeiro mês preenchido = aquele mês; os dois = de … até; só o "até" = até aquele mês.
// O mês da linha é o da competência e, sem ela, o do pagamento: a mesma regra do Fechamento e da Lucratividade (SIS-2026-0708),
// para o que a tela soma aqui bater com o número de lá.
export function mesDaCompetenciaDaLinha(l: { competencia?: string | null; data_pagamento?: string | null }): string | null {
  const data = l.competencia || l.data_pagamento;
  return data ? data.slice(0, 7) : null;
}

export function competenciaNoIntervalo(l: { competencia?: string | null; data_pagamento?: string | null }, de: string, ate: string): boolean {
  if (!de && !ate) return true;
  const mes = mesDaCompetenciaDaLinha(l);
  if (!mes) return false;
  const inicio = de || "";
  const fim = ate || de;
  return mes >= inicio && (!fim || mes <= fim);
}
