import { somarDias, somarDiasUteis } from "./projecaoDiaria";

// SIS-2026-0893 (etapa 3) — Vencimento da nota fiscal. Funções puras.
// Ordem de decisão (a mais confiável primeiro):
//   1. data_vencimento gravada na nota (ajuste manual do Financeiro)              → origem "manual"
//   2. prazo de pagamento do CONTRATO (texto livre) interpretado                  → origem "prazo_contrato"
//   3. emissão + 30 dias (o mesmo padrão da Cobrança)                              → origem "padrao" (estimado)
// Sem data de emissão e sem vencimento gravado não há como estimar: vencimento nulo (a nota fica "sem vencimento").

export const PRAZO_PADRAO_DIAS = 30;

export type OrigemVencimento = "manual" | "prazo_contrato" | "padrao";

export const ROTULO_ORIGEM_VENCIMENTO: Record<OrigemVencimento, string> = {
  manual: "Ajustado pelo Financeiro",
  prazo_contrato: "Pelo prazo do contrato",
  padrao: "Estimado (emissão + 30 dias)",
};

export type PrazoInterpretado =
  | { tipo: "dias_corridos"; dias: number }
  | { tipo: "dias_uteis"; dias: number }
  /** até o dia N do mês seguinte ao da COMPETÊNCIA (serviço prestado) */
  | { tipo: "dia_do_mes_seguinte"; dia: number };

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

/**
 * Entende os textos que o cadastro do contrato traz: "ATÉ 15 DIAS MÊS SUBSEQUENTE", "DIA 10 DO MÊS SEGUINTE", "30 DIAS", "30 DDL", "ATÉ 20 DIAS ÚTEIS".
 * Devolve `null` quando não entende (a tela cai no padrão estimado e o Financeiro ajusta a nota se quiser).
 */
export function interpretarPrazoContrato(texto: string | null | undefined): PrazoInterpretado | null {
  const t = semAcento(String(texto ?? "")).replace(/\s+/g, " ").trim();
  if (!t) return null;
  const numero = /(\d{1,3})/.exec(t);
  if (!numero) return null;
  const n = Number(numero[1]);
  if (!(n > 0)) return null;

  // "ATÉ 15 DIAS MÊS SUBSEQUENTE", "DIA 10 DO MÊS SEGUINTE", "ATÉ O DIA 5 DO PRÓXIMO MÊS"
  if (/(SUBSEQUENTE|SEGUINTE|PROXIMO MES|MES POSTERIOR)/.test(t)) return n <= 31 ? { tipo: "dia_do_mes_seguinte", dia: n } : null;
  if (/UTEIS?/.test(t)) return { tipo: "dias_uteis", dias: n };
  // "30 DIAS", "ATÉ 30 DIAS APÓS A EMISSÃO", "30 DDL", "30 DIAS CORRIDOS"
  if (/(DIAS?|DDL|DD)\b/.test(t)) return { tipo: "dias_corridos", dias: n };
  return null;
}

const ultimoDiaDoMes = (ano: number, mes1a12: number) => new Date(Date.UTC(ano, mes1a12, 0)).getUTCDate();

/** Data de vencimento a partir do prazo do contrato. `competencia` (YYYY-MM-DD) e `dataEmissao` (YYYY-MM-DD). */
export function aplicarPrazo(prazo: PrazoInterpretado, dataEmissao: string, competencia: string, feriados: ReadonlySet<string> = new Set()): string {
  if (prazo.tipo === "dias_corridos") return somarDias(dataEmissao, prazo.dias);
  if (prazo.tipo === "dias_uteis") return somarDiasUteis(dataEmissao, prazo.dias, feriados);
  const [a, m] = competencia.split("-").map(Number);
  const ano = m === 12 ? a + 1 : a;
  const mes = m === 12 ? 1 : m + 1;
  const dia = Math.min(prazo.dia, ultimoDiaDoMes(ano, mes));
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export interface VencimentoDaNota { data: string; origem: OrigemVencimento }

export function vencimentoDaNota(
  nota: { data_emissao: string | null; competencia: string; data_vencimento?: string | null },
  prazoContrato: string | null | undefined,
  feriados: ReadonlySet<string> = new Set(),
): VencimentoDaNota | null {
  if (nota.data_vencimento) return { data: nota.data_vencimento.slice(0, 10), origem: "manual" };
  if (!nota.data_emissao) return null;
  const emissao = nota.data_emissao.slice(0, 10);
  const prazo = interpretarPrazoContrato(prazoContrato);
  if (prazo) return { data: aplicarPrazo(prazo, emissao, nota.competencia.slice(0, 10), feriados), origem: "prazo_contrato" };
  return { data: somarDias(emissao, PRAZO_PADRAO_DIAS), origem: "padrao" };
}

// ── aging ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type FaixaAging = "a_vencer" | "vencido_1_30" | "vencido_31_60" | "vencido_61_90" | "vencido_90_mais" | "sem_vencimento";

export const ROTULO_FAIXA: Record<FaixaAging, string> = {
  a_vencer: "A vencer",
  vencido_1_30: "Vencido 1–30 dias",
  vencido_31_60: "Vencido 31–60 dias",
  vencido_61_90: "Vencido 61–90 dias",
  vencido_90_mais: "Vencido há mais de 90 dias",
  sem_vencimento: "Sem vencimento",
};

export const ORDEM_FAIXAS: FaixaAging[] = ["a_vencer", "vencido_1_30", "vencido_31_60", "vencido_61_90", "vencido_90_mais", "sem_vencimento"];

/** Dias de atraso na data de referência (positivo = vencido; ≤ 0 = ainda no prazo). O dia do vencimento ainda está no prazo. */
export function diasDeAtraso(vencimento: string, referencia: string): number {
  return Math.round((new Date(`${referencia}T00:00:00Z`).getTime() - new Date(`${vencimento}T00:00:00Z`).getTime()) / 86_400_000);
}

export function faixaDeAtraso(vencimento: string | null, referencia: string): FaixaAging {
  if (!vencimento) return "sem_vencimento";
  const d = diasDeAtraso(vencimento, referencia);
  if (d <= 0) return "a_vencer";
  if (d <= 30) return "vencido_1_30";
  if (d <= 60) return "vencido_31_60";
  if (d <= 90) return "vencido_61_90";
  return "vencido_90_mais";
}
