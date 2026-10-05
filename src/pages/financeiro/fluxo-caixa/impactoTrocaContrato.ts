// SIS-2026-0552 — aviso de estouro ao trocar o contrato de um lançamento do
// Malote no Fluxo de Caixa. A troca move o valor do contrato antigo para o
// novo no Orçamento; se o novo ficar acima do Orçado, avisa (e a pessoa
// confirma) — não bloqueia, é correção de classificação.

export interface LinhaUtilizado {
  despesa_id: string;
  contrato_id: string | null;
  classificacao_id: string | null; // já canônica (useUtilizadoOrcamento remapeia)
  competencia: string | null;
  valor: number;
}

export interface ImpactoTroca {
  classificacaoId: string;
  mes: string;
  utilizadoNovoContrato: number; // já lançado no contrato novo, sem esta despesa
  valorQueEntra: number; // o que esta despesa traz para o mês
  aposTroca: number;
  orcado: number | null; // null = não dá pra resolver
  excesso: number; // quanto passa do orçado (0 se dentro ou orçado desconhecido)
}

const mesDe = (competencia: string | null) => (competencia ?? "").slice(0, 7);

export function calcularImpactoTroca(
  utilizado: LinhaUtilizado[],
  despesaId: string,
  contratoNovoId: string,
  mes: string,
  resolverOrcado: (classificacaoId: string, contratoId: string, anoMes: string) => number | null
): ImpactoTroca | null {
  const daDespesa = utilizado.filter((l) => l.despesa_id === despesaId);
  // A classificação "que conta" é a da própria despesa na fonte do Orçamento.
  const classificacaoId = daDespesa.find((l) => l.classificacao_id)?.classificacao_id ?? null;
  if (!classificacaoId) return null; // despesa fora do Utilizado (ex.: não paga/aguardando) — nada a checar

  const valorQueEntra = daDespesa
    .filter((l) => mesDe(l.competencia) === mes)
    .reduce((s, l) => s + (Number(l.valor) || 0), 0);

  const utilizadoNovoContrato = utilizado
    .filter((l) => l.despesa_id !== despesaId && l.contrato_id === contratoNovoId && l.classificacao_id === classificacaoId && mesDe(l.competencia) === mes)
    .reduce((s, l) => s + (Number(l.valor) || 0), 0);

  const aposTroca = utilizadoNovoContrato + valorQueEntra;
  const orcado = resolverOrcado(classificacaoId, contratoNovoId, mes);
  const excesso = orcado == null ? 0 : Math.max(0, Math.round((aposTroca - orcado) * 100) / 100);
  return { classificacaoId, mes, utilizadoNovoContrato, valorQueEntra, aposTroca, orcado, excesso };
}
