// SIS-2026-0903 (Fase 2): tratativas das divergências da Conciliação Financeira e dados do dashboard. Funções puras (testáveis).
import type { ResultadoConciliacao, TipoDivergencia } from "./regras";
import { ROTULO_TIPO_DIVERGENCIA } from "./regras";

export type StatusTratativa = "aberta" | "em_analise" | "justificada" | "regularizada";
export const STATUS_TRATATIVA: StatusTratativa[] = ["aberta", "em_analise", "justificada", "regularizada"];
export const ROTULO_STATUS_TRATATIVA: Record<StatusTratativa, string> = { aberta: "Aberta", em_analise: "Em análise", justificada: "Justificada", regularizada: "Regularizada" };

export interface Tratativa {
  id: string;
  alvoChave: string;
  alvoTipo: "nota" | "indicador";
  nfEmissaoId: string | null;
  contratoId: string | null;
  empresaId: string | null;
  /** "YYYY-MM" */
  competencia: string | null;
  indicador: string | null;
  titulo: string;
  tipoDivergencia: TipoDivergencia | null;
  valorDiferenca: number;
  status: StatusTratativa;
  responsavelId: string | null;
  responsavelNome: string | null;
  justificativa: string | null;
  /** "YYYY-MM-DD" */
  identificadaEm: string;
  prazoResolucao: string | null;
  regularizadaEm: string | null;
}

export interface HistoricoTratativa { id: string; campo: string; valorAnterior: string | null; valorNovo: string | null; autorNome: string | null; criadoEm: string }

export const chaveNota = (nfId: string) => `nota:${nfId}`;
export const chaveIndicador = (indicador: string, contratoId: string | null, mes: string | null) => `indicador:${indicador}|contrato:${contratoId ?? "-"}|mes:${mes ?? "-"}`;

/** Aberta ou em análise: ainda é valor sob investigação. Justificada e regularizada encerram a análise. */
export const emAberto = (t: Pick<Tratativa, "status">) => t.status === "aberta" || t.status === "em_analise";
export const vencida = (t: Pick<Tratativa, "status" | "prazoResolucao">, hojeIso: string) => emAberto(t) && !!t.prazoResolucao && t.prazoResolucao < hojeIso;

export function indexarPorAlvo(ts: Tratativa[]): Map<string, Tratativa> { return new Map(ts.map((t) => [t.alvoChave, t])); }

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface ResumoTratativas { total: number; porStatus: Record<StatusTratativa, number>; vencidas: number; valorSobInvestigacao: number }

export function resumoTratativas(ts: Tratativa[], hojeIso: string): ResumoTratativas {
  const porStatus: Record<StatusTratativa, number> = { aberta: 0, em_analise: 0, justificada: 0, regularizada: 0 };
  let vencidas = 0, valor = 0;
  for (const t of ts) {
    porStatus[t.status] += 1;
    if (vencida(t, hojeIso)) vencidas += 1;
    if (emAberto(t)) valor += t.valorDiferenca;
  }
  return { total: ts.length, porStatus, vencidas, valorSobInvestigacao: r2(valor) };
}

/** Texto de um evento do histórico (o que o trigger do banco gravou). */
export function textoHistorico(h: Pick<HistoricoTratativa, "campo" | "valorAnterior" | "valorNovo">): string {
  if (h.campo === "criacao") return `Tratativa aberta: ${h.valorNovo ?? ""}`;
  const rotulo = (v: string | null) => (h.campo === "situação" && v ? ROTULO_STATUS_TRATATIVA[v as StatusTratativa] ?? v : v);
  const de = rotulo(h.valorAnterior), para = rotulo(h.valorNovo);
  return `${h.campo[0].toUpperCase()}${h.campo.slice(1)}: ${de ? `“${de}”` : "vazio"} → ${para ? `“${para}”` : "vazio"}`;
}

// ── Dashboard (4.8) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DadosDashboard {
  evolucao: { mes: string; diferenca: number; divergentes: number }[];
  topContratos: { contratoId: string; contrato: string; divergentes: number; diferenca: number }[];
  porTipo: { tipo: TipoDivergencia; rotulo: string; notas: number }[];
  notasDivergentes: number;
  notasAvaliadas: number;
  /** % de notas conciliadas; null sem notas */
  pctConciliacao: number | null;
  /** NFs divergentes que ainda não têm tratativa */
  semTratativa: number;
  tratativas: ResumoTratativas;
}

export function dadosDashboard(
  r: Pick<ResultadoConciliacao, "resumo" | "porCompetencia" | "porContrato" | "notas">, tratativas: Tratativa[], hojeIso: string,
): DadosDashboard {
  const porAlvo = indexarPorAlvo(tratativas);
  const tipos = new Map<TipoDivergencia, number>();
  let semTratativa = 0;
  for (const n of r.notas) {
    if (!n.divergente) continue;
    if (!porAlvo.has(chaveNota(n.id))) semTratativa += 1;
    for (const t of new Set(n.tipos)) tipos.set(t, (tipos.get(t) ?? 0) + 1);
  }
  const { notasAvaliadas, notasDivergentes, notasConciliadas } = r.resumo;
  return {
    evolucao: r.porCompetencia.map((g) => ({ mes: g.chave, diferenca: g.difTotal, divergentes: g.divergentes })),
    topContratos: r.porContrato.filter((g) => g.difTotal > 0).slice(0, 5).map((g) => ({ contratoId: g.chave, contrato: g.rotulo, divergentes: g.divergentes, diferenca: g.difTotal })),
    porTipo: [...tipos.entries()].map(([tipo, notas]) => ({ tipo, rotulo: ROTULO_TIPO_DIVERGENCIA[tipo], notas })).sort((a, b) => b.notas - a.notas),
    notasDivergentes, notasAvaliadas,
    pctConciliacao: notasAvaliadas ? Math.round((notasConciliadas / notasAvaliadas) * 10000) / 100 : null,
    semTratativa,
    tratativas: resumoTratativas(tratativas, hojeIso),
  };
}
