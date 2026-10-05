// Regras puras do Controle de Faturamento (status da célula contrato × mês e
// "Não Emitido"). Extraídas da tela pra serem testáveis.
//
// Bug visto em jul/2026: o painel mostrava "49 contratos faturados — 100%" e,
// ao mesmo tempo, R$ 612 mil "não emitidos". "Faturado" só exigia ter ao menos
// UMA NF Código N no mês (qualquer valor), enquanto o "Não Emitido" era
// executável − bruto somado e ABATIDO no total (contrato com NF acima do
// executável escondia a falta dos outros). Agora:
//   - contrato com NF abaixo do executável = "Faturado parcial";
//   - "Não Emitido" = soma das faltas POR contrato, sem abater excessos.

export type StatusCelula = "NOTAS_LANCADAS" | "FATURADO_PARCIAL" | "NENHUM_LANCAMENTO" | "COMPETENCIA_SEM_DADOS" | "SEM_VIGENCIA";

// Diferença abaixo disso (centavos de arredondamento entre a planilha e a NF)
// não é falta nem excesso.
export const TOLERANCIA_FATURAMENTO = 1;

export function faltaDeFaturamento(executavel: number, contabil: number): number {
  const falta = executavel - contabil;
  return falta > TOLERANCIA_FATURAMENTO ? falta : 0;
}

export function excessoDeFaturamento(executavel: number, contabil: number): number {
  const excesso = contabil - executavel;
  return excesso > TOLERANCIA_FATURAMENTO ? excesso : 0;
}

export function statusCelula(valorExecutavel: number, temNotaN: boolean, competenciaTemDados: boolean, contabil: number): StatusCelula {
  if (valorExecutavel > 0 && temNotaN) {
    return faltaDeFaturamento(valorExecutavel, contabil) > 0 ? "FATURADO_PARCIAL" : "NOTAS_LANCADAS";
  }
  if (valorExecutavel > 0 && !competenciaTemDados) return "COMPETENCIA_SEM_DADOS";
  if (valorExecutavel > 0) return "NENHUM_LANCAMENTO";
  return "SEM_VIGENCIA";
}

export interface ParteFaturamento {
  executavel: number;
  contabil: number;
  naoEmitido: number;
  excesso: number;
  status: StatusCelula;
}

// Totais do mês. `naoEmitido` soma as faltas por contrato; `excesso` (NF acima
// do executável) fica à parte e NÃO abate o não emitido.
export function resumirFaturamento(linhas: ParteFaturamento[]) {
  let executavel = 0, contabil = 0, naoEmitido = 0, excesso = 0, lancadas = 0, parciais = 0, pendentes = 0, semDados = 0;
  for (const l of linhas) {
    executavel += l.executavel;
    contabil += l.contabil;
    naoEmitido += l.naoEmitido;
    excesso += l.excesso;
    if (l.status === "NOTAS_LANCADAS") lancadas++;
    else if (l.status === "FATURADO_PARCIAL") parciais++;
    else if (l.status === "NENHUM_LANCAMENTO") pendentes++;
    else if (l.status === "COMPETENCIA_SEM_DADOS") semDados++;
  }
  return { executavel, contabil, naoEmitido, excesso, lancadas, parciais, pendentes, semDados };
}
