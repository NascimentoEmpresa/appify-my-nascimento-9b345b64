// =====================================================================
// TV › RH — SALÁRIOS E BENEFÍCIOS × ORÇAMENTO (11/11/2026, mig 20261111220000)
//
// Por contrato, o realizado (folha Senior + rateio de VT, BSF e seguro)
// contra o orçado na Planilha de Custo executada, só nas linhas medidas dos
// dois lados. Aqui: o tom de cada desvio e quais contratos vão para o gráfico.
// Regra das TVs (Pablo): "ruim" só quando é verdadeiro — dentro da folga não acusa.
// =====================================================================

export interface ContratoSalarios {
  contrato: string; pessoas: number | null;
  orc_sal: number; real_sal: number; orc_ben: number; real_ben: number;
  /** % acima (+) ou abaixo (−) do orçado. */
  desvio: number;
}

export interface DadosRhSalariosTv {
  competencias: Partial<Record<"vale_transporte" | "bsf" | "seguro", string>>;
  orcado: number | null;
  realizado: number | null;
  contratos: ContratoSalarios[];
  gerado_em?: string;
}

/** Até 5% acima do orçado é folga (a meta do card gerencial); acima de 10%, crítico. */
export const FOLGA_ORCAMENTO = 5;
export const CRITICO_ORCAMENTO = 10;
export const MAX_CONTRATOS_GRAFICO = 10;

export type TomDesvio = "bom" | "atencao" | "critico";
export const tomDesvio = (d: number): TomDesvio => (d <= FOLGA_ORCAMENTO ? "bom" : d <= CRITICO_ORCAMENTO ? "atencao" : "critico");

export const desvioTotal = (d: DadosRhSalariosTv): number | null =>
  d.orcado && d.orcado > 0 && d.realizado != null ? Math.round(((d.realizado - d.orcado) / d.orcado) * 1000) / 10 : null;

/** O gráfico: os que mais passaram do orçado; se ninguém passou, os mais próximos do limite. */
export function contratosDoGrafico(d: DadosRhSalariosTv, n = MAX_CONTRATOS_GRAFICO): ContratoSalarios[] {
  return [...d.contratos].sort((a, b) => b.desvio - a.desvio).slice(0, n);
}

export const acimaDoOrcamento = (d: DadosRhSalariosTv) => d.contratos.filter((c) => c.desvio > FOLGA_ORCAMENTO).length;

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "VT set/26 · BSF out/26 · Seguro out/26" — de qual rateio veio cada benefício. */
export function rotuloCompetencias(c: DadosRhSalariosTv["competencias"]): string {
  const r = (m?: string) => (m ? `${MES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}` : null);
  return [["VT", c.vale_transporte], ["BSF", c.bsf], ["Seguro", c.seguro]]
    .filter(([, m]) => m).map(([k, m]) => `${k} ${r(m as string)}`).join(" · ");
}
