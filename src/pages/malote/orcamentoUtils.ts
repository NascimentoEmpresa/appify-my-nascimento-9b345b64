import type { PlanejamentoOrcamentarioRow } from "@/hooks/usePlanejamentoOrcamentario";

export type StatusVigencia = "na_vigencia" | "entrara_em_vigencia" | "historico";

export type OrcamentoComStatus = PlanejamentoOrcamentarioRow & { status: StatusVigencia };

// Comparação em string "YYYY-MM-DD" (formato nativo de <input type="date"> e
// da coluna `date` do Postgres) — evita problemas de fuso horário do Date.
export function getStatusVigencia(
  inicioVigencia: string,
  fimVigencia: string,
  hoje: Date = new Date()
): StatusVigencia {
  const hojeStr = hoje.toISOString().slice(0, 10);
  if (hojeStr < inicioVigencia) return "entrara_em_vigencia";
  if (hojeStr >= fimVigencia) return "historico";
  return "na_vigencia";
}

export const STATUS_LABEL: Record<StatusVigencia, string> = {
  na_vigencia: "Na Vigência",
  entrara_em_vigencia: "Vão entrar em vigência",
  historico: "Histórico",
};

export const STATUS_BADGE_CLASS: Record<StatusVigencia, string> = {
  na_vigencia: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  entrara_em_vigencia: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  historico: "bg-slate-100 text-slate-600 hover:bg-slate-100",
};

export function fmtMoney(n: number | string | null | undefined): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n) || 0);
}

export function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

// SIS-2026-0168: "competencia" do malote_despesa é uma coluna `date`
// (vem como "YYYY-MM-DD"), mas o Ano/Mês do filtro é "YYYY-MM" — comparar
// os dois direto nunca batia, deixando "Utilizado" sempre zerado no
// Orçamento Geral (achado no SIS-2026-0192, ao testar um lançamento real).
export function competenciaNoPeriodo(competencia: string | null | undefined, anoMes: string): boolean {
  return !!competencia && competencia.slice(0, 7) === anoMes;
}

// % Utilizado só faz sentido com Orçado > 0 (regra combinada com o
// usuário: Orçado = 0 mostra "—", não 0% nem Infinity%).
export function fmtPct(utilizado: number, orcado: number): string {
  if (!orcado) return "—";
  return `${((utilizado / orcado) * 100).toFixed(2)}%`;
}

// ── Alçada de aprovação x Orçado (SIS-2026-0132/0212/0223/0261) ─────────
//
// SIS-2026-0261 (Iury, dois achados reais na aprovação de N1):
// 1) despesa PARCELADA checava só a parcela 1 pra decidir se escala pra
//    N2 (premissa anterior de SIS-2026-0223: "as parcelas sempre teriam
//    orçamento", que não se confirmou — uma parcela mais à frente pode
//    estourar o orçado do mês dela mesmo com a 1ª dentro);
// 2) despesa com RATEIO em mais de 1 contrato checava só o
//    despesa.contrato_id "principal" — um Rateio em vários contratos, com
//    2 deles estourando o orçado deles, passava direto sem escalar.
//
// Extraído de DespesaVisualizar.tsx pra virar lógica pura testável: cada
// COMBINAÇÃO (linha de rateio × parcela, ou só a linha quando não é
// parcelada) precisa ser checada contra o orçado do SEU contrato no mês do
// SEU vencimento — se qualquer combinação estourar a alçada do nível
// atual, a despesa inteira escala (não dá pra escalar só 1 linha/parcela).
export interface ComboAlcada {
  mes: string;
  contratoId: string | null;
  valor: number;
}

export function montarCombosAlcada(params: {
  parcelado: boolean;
  parcelas: { data_vencimento: string; valor: number }[];
  linhas: { contrato_id: string | null | undefined; valor: number }[];
  valorTotalDespesa: number;
  anoMesDespesa: string;
  // "Valor aprovado" (editável pelo aprovador antes de aprovar) só existe
  // pra despesa não parcelada — escala cada linha por esse ajuste, mesma
  // ideia do fatorParcela1 já usado pra parcela. 1 = sem ajuste.
  fatorValorAprovado: number;
}): ComboAlcada[] {
  const { parcelado, parcelas, linhas, valorTotalDespesa, anoMesDespesa, fatorValorAprovado } = params;
  const linhasParaAlcada = linhas.length > 0 ? linhas : [{ contrato_id: null, valor: valorTotalDespesa }];

  if (parcelado && parcelas.length > 0) {
    return parcelas.flatMap((p) => {
      const fatorParcela = valorTotalDespesa ? p.valor / valorTotalDespesa : 0;
      const mes = p.data_vencimento.slice(0, 7);
      return linhasParaAlcada.map((l) => ({ mes, contratoId: l.contrato_id ?? null, valor: (Number(l.valor) || 0) * fatorParcela }));
    });
  }
  return linhasParaAlcada.map((l) => ({
    mes: anoMesDespesa,
    contratoId: l.contrato_id ?? null,
    valor: (Number(l.valor) || 0) * fatorValorAprovado,
  }));
}

// Acha a 1ª combinação (linha/parcela) que estoura a alçada do nível atual
// — orçado desconhecido (resolverOrcado devolve null) nunca bloqueia, é
// tratado como "sem trava" (mesmo comportamento de sempre, pra não
// quebrar classificação/contrato sem dado suficiente pra calcular).
export function encontrarComboQueEstouraAlcada(
  combos: ComboAlcada[],
  limitePct: number | null,
  resolverOrcado: (contratoId: string | null, mes: string) => number | null,
  utilizadoAntes: (contratoId: string | null, mes: string) => number
): ComboAlcada | undefined {
  if (limitePct == null) return undefined;
  return combos.find((combo) => {
    const orcado = resolverOrcado(combo.contratoId, combo.mes);
    if (orcado == null) return false;
    const percentual = ((utilizadoAntes(combo.contratoId, combo.mes) + combo.valor) / orcado) * 100;
    return percentual > limitePct;
  });
}
