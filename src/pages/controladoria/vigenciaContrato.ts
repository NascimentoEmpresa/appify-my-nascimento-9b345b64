// SIS-2026-0605 (Iury): a Visão Anual do Controle de Faturamento decidia a
// vigência só pela Planilha de Custo — e a planilha de um contrato encerrado
// continua com valor nos meses depois do fim (ex. CAXIAS DO SUL 2025/162,
// encerrado em 28/02/2026, aparecia "sem lançamento" de março a setembro).
//
// Esta regra complementa (não substitui) a vigência por planilha: depois da
// data fim do CONTRATO, a competência sem nota lançada não é "pendente".

export interface FimDoContrato {
  data_fim_vigencia?: string | null;
  vigencia_final?: string | null;
}

// Há dois campos de fim no cadastro (data_fim_vigencia e vigencia_final); se
// divergirem (aditivo/prorrogação digitada em só um deles) vale o mais tardio,
// pra nunca esconder uma competência ainda vigente.
export function fimDoContrato(c: FimDoContrato): string | null {
  const datas = [c.data_fim_vigencia, c.vigencia_final].filter((d): d is string => !!d);
  if (datas.length === 0) return null;
  return datas.sort()[datas.length - 1].slice(0, 10);
}

// `competencia` é "YYYY-MM-01". O mês do fim ainda é vigente (fim 28/02 →
// fev/2026 conta; mar/2026 não).
export function contratoEncerradoNaCompetencia(c: FimDoContrato, competencia: string): boolean {
  const fim = fimDoContrato(c);
  return !!fim && competencia.slice(0, 10) > fim;
}
