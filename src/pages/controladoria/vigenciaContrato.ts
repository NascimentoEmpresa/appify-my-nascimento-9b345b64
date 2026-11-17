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

// =====================================================================
// SIS-2026-0915 — CUSTO FORA DA VIGÊNCIA DO CONTRATO (Lucratividade).
// "Bento Gonçalves – AUX ADM – 002/2021": Salários e Férias em nov/2025 num
// contrato que só começa em 01/01/2026 — o lançamento é de outro contrato e
// caiu no centro de custo errado do Fluxo de Caixa. A Lucratividade passa a
// comparar o mês de cada custo com a vigência do CONTRATO (cadastro de
// Licitações/Contratos, sem cadastro novo) e sinaliza "Irregularidade". Só
// sinaliza: o lançamento não muda.
//
// Vale a vigência do CONTRATO, não a da Planilha de Custos (que é só o
// período em que aqueles valores se aplicam e muda a cada repactuação). Com
// prorrogação, `vigencia_inicial` pode ser só o início do período atual: o
// início é o MAIS ANTIGO entre data_inicio e vigencia_inicial, e o fim o mais
// tardio (fimDoContrato) — nunca acusar um mês em que o contrato valia.
// =====================================================================

export interface VigenciaDoContrato extends FimDoContrato {
  data_inicio?: string | null;
  vigencia_inicial?: string | null;
}

export function inicioDoContrato(c: VigenciaDoContrato): string | null {
  const datas = [c.data_inicio, c.vigencia_inicial].filter((d): d is string => !!d).map((d) => d.slice(0, 10));
  if (datas.length === 0) return null;
  return datas.sort()[0];
}

export type ForaDaVigencia = "antes" | "depois";

/** Mês ("YYYY-MM") fora da vigência do contrato? O mês do início e o do fim contam como vigentes. Sem a data, não acusa. */
export function foraDaVigencia(c: VigenciaDoContrato, anoMes: string): ForaDaVigencia | null {
  const mes = anoMes.slice(0, 7);
  const inicio = inicioDoContrato(c);
  if (inicio && mes < inicio.slice(0, 7)) return "antes";
  const fim = fimDoContrato(c);
  if (fim && mes > fim.slice(0, 7)) return "depois";
  return null;
}

export interface IrregularidadeVigencia {
  /** meses do período com custo fora da vigência */
  meses: { mes: string; posicao: ForaDaVigencia }[];
  /** rubrica → valor lançado fora da vigência (só as que têm valor) */
  rubricas: Map<string, number>;
}

/**
 * Custos do contrato, mês a mês, fora da vigência. `custoDoMes` devolve o custo por rubrica daquele mês (undefined = nada).
 * null = nenhum custo fora da vigência no período.
 */
export function irregularidadesDeVigencia(
  c: VigenciaDoContrato, meses: string[], custoDoMes: (mes: string) => Record<string, number> | undefined,
): IrregularidadeVigencia | null {
  const out: IrregularidadeVigencia = { meses: [], rubricas: new Map() };
  for (const mes of meses) {
    const posicao = foraDaVigencia(c, mes);
    if (!posicao) continue;
    const custos = custoDoMes(mes);
    if (!custos) continue;
    let teve = false;
    for (const [rubrica, valor] of Object.entries(custos)) {
      if (!valor) continue;
      teve = true;
      out.rubricas.set(rubrica, (out.rubricas.get(rubrica) ?? 0) + valor);
    }
    if (teve) out.meses.push({ mes, posicao });
  }
  return out.meses.length ? out : null;
}

/** Vigência da Planilha de Custos (informativa): a data mais recente entre as linhas vigentes no mês. null = sem planilha vigente. */
export function inicioDaPlanilhaVigente(linhasVigentes: { data_vigencia: string | null }[]): string | null {
  const datas = linhasVigentes.map((l) => l.data_vigencia).filter((d): d is string => !!d).map((d) => d.slice(0, 10)).sort();
  return datas.length ? datas[datas.length - 1] : null;
}
