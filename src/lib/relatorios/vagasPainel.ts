import { PASSOS_FLUXO, desfechoDoStatus, type Desfecho, type EventoHistorico } from "@/lib/recrutamento/fluxoStatus";

// =====================================================================
// RELATÓRIOS › VAGAS — DASHBOARD (mig 20261007000020, 07/10/2026)
//
// A RPC dir_vagas_painel manda UMA linha por vaga (as solicitadas no
// período + todas as que ainda estão abertas) com o log de status. Aqui
// viram: quanto tempo cada vaga ficou em cada etapa (os 8 passos de
// fluxoStatus.ts), tempo até contratar, funil, rankings, mês a mês e aging.
//
// Como o tempo por etapa é medido: a vaga nasce em created_at no status de
// antes da 1ª troca do log (ou no status atual, se nunca trocou); cada
// troca fecha um trecho. O trecho atual de uma vaga aberta fica "aberto"
// (conta até agora, mas não entra nas médias de etapa — só no "parado
// agora"). O log começou em 19/08/2026: vaga do sistema antigo (Discord)
// sem log vira um trecho único "Sistema antigo" e só entra no tempo total.
// =====================================================================

export type LogStatus = [string | null, string | null, string];

export interface CandidatosVaga {
  total: number; desistiu: number; etapas: Record<string, number>;
  primeiro_em: string | null; selecionado_em: string | null; enviado_em: string | null;
}

export interface VagaPainel {
  id: number; criada: string; status: string; status_em: string | null;
  cargo: string | null; cidade: string | null; uf: string | null; contrato: string | null; setor: string | null;
  motivo: string | null; urgencia: string | null; qtd: number;
  solicitante: string | null; analista: string | null; aprovado_por: string | null; contratado: string | null;
  inicio_previsto: string | null; substituido: string | null; motivo_reprovacao: string | null;
  legado: boolean; administrativa: boolean; reserva: boolean; encarregado: boolean;
  /** Solicitada dentro do período/meses escolhidos (as abertas de fora vêm só para o "parado agora"). */
  no_periodo: boolean; aberta: boolean;
  log: LogStatus[]; aprovada_em: string | null; cand: CandidatosVaga;
}

export interface PainelVagas { de: string; ate: string; agora: string; log_desde: string | null; vagas: VagaPainel[] }

export interface DetalheVaga {
  vaga: (Omit<VagaPainel, "log" | "cand" | "no_periodo" | "aberta" | "aprovada_em" | "administrativa" | "reserva" | "encarregado"> & {
    escala: string | null; horario: string | null; salario: string | null; local: string | null;
    contratado_inicio: string | null; req_obrigatorios: string | null; observacao: string | null;
  }) | null;
  log: LogStatus[];
  historico: EventoHistorico[];
  candidatos: {
    id: number; nome: string | null; criado: string; etapa: string; etapa_em: string | null; origem: string | null;
    selecionado_em: string | null; enviado_em: string | null; desistiu: boolean; desistencia_motivo: string | null; motivo_reprovacao: string | null;
  }[];
}

/** Referência para "contratada no prazo" (dias corridos da solicitação ao Contratado). */
export const META_DIAS_CONTRATAR = 15;

export const PASSO_LEGADO = { chave: "legado", titulo: "Sistema antigo" } as const;
export const PASSO_OUTROS = { chave: "outros", titulo: "Outros status" } as const;
/** As 8 etapas do fluxo + as duas sobras, na ordem de exibição. */
export const ETAPAS = [...PASSOS_FLUXO.map((p) => ({ chave: p.chave, titulo: p.titulo })), PASSO_OUTROS, PASSO_LEGADO];
export const tituloEtapa = (chave: string) => ETAPAS.find((e) => e.chave === chave)?.titulo ?? chave;

const DIA = 86_400_000;
const ms = (s: string | null | undefined) => (s ? new Date(s).getTime() : NaN);
export const diasEntreMs = (a: number, b: number) => (Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, (b - a) / DIA) : 0);

/** Etapa (chave de PASSOS_FLUXO) do status do banco. Concluído… = contratado. */
export function etapaDoStatus(status: string | null | undefined): string {
  const s = String(status ?? "").trim();
  if (s === "Contratado" || s.startsWith("Concluído")) return "contratado";
  return PASSOS_FLUXO.find((p) => p.status.includes(s))?.chave ?? PASSO_OUTROS.chave;
}
const indiceEtapa = (chave: string) => PASSOS_FLUXO.findIndex((p) => p.chave === chave);

export const desfechoVaga = (v: Pick<VagaPainel, "status">): Desfecho => desfechoDoStatus(v.status);
export const vagaFechada = (v: Pick<VagaPainel, "status">) => desfechoVaga(v) !== "andamento";

export interface Trecho { status: string; etapa: string; inicio: string; fim: string | null; dias: number; aberto: boolean }

/** Os trechos da vaga, do pedido até agora (ou até fechar). */
export function trechosDaVaga(v: Pick<VagaPainel, "criada" | "status" | "status_em" | "log" | "legado">, agora: string): Trecho[] {
  const tAgora = ms(agora);
  const fechada = vagaFechada(v);
  const mk = (status: string, etapa: string, inicio: string, fim: string | null): Trecho => ({
    status, etapa, inicio, fim, aberto: fim == null, dias: diasEntreMs(ms(inicio), fim ? ms(fim) : tAgora),
  });
  if (!v.log.length) {
    if (v.legado && fechada) return [mk("Sistema antigo", PASSO_LEGADO.chave, v.criada, v.status_em ?? v.criada)];
    if (fechada) return [];   // fechou sem log nem legado (raro): sem trecho medível
    return [mk(v.status, etapaDoStatus(v.status), v.criada, null)];
  }
  const out: Trecho[] = [];
  let atual = v.log[0][0] ?? v.status;
  let t = v.criada;
  for (const [de, para, em] of v.log) {
    const st = de ?? atual;
    // Troca registrada antes da criação (relógio/ajuste manual): ignora o trecho negativo.
    if (ms(em) >= ms(t)) out.push(mk(st, etapaDoStatus(st), t, em));
    atual = para ?? atual;
    t = em;
  }
  if (!fechada) out.push(mk(atual, etapaDoStatus(atual), t, null));
  return out;
}

/** Dias somados em cada etapa (só trechos fechados, ou todos com incluirAberto). */
export function diasPorEtapa(trechos: Trecho[], incluirAberto = false): Record<string, number> {
  const r: Record<string, number> = {};
  for (const t of trechos) {
    if (t.aberto && !incluirAberto) continue;
    r[t.etapa] = (r[t.etapa] ?? 0) + t.dias;
  }
  return r;
}

/** Data em que a vaga fechou (contratada/reprovada/cancelada). */
export function fechadaEm(v: Pick<VagaPainel, "status" | "status_em" | "log">): string | null {
  if (!vagaFechada(v)) return null;
  const ult = v.log[v.log.length - 1];
  return v.status_em ?? ult?.[2] ?? null;
}

/** Dias corridos da solicitação até fechar (ou até agora, se aberta). */
export function diasTotais(v: Pick<VagaPainel, "criada" | "status" | "status_em" | "log">, agora: string): number {
  return diasEntreMs(ms(v.criada), ms(fechadaEm(v) ?? agora));
}

/** Dias no status atual (vaga aberta). */
export const diasNoStatus = (v: Pick<VagaPainel, "criada" | "status_em">, agora: string) => diasEntreMs(ms(v.status_em ?? v.criada), ms(agora));

/** Até onde a vaga chegou no fluxo (índice de PASSOS_FLUXO; -1 = nada além do pedido). */
export function etapaAlcancada(v: Pick<VagaPainel, "status" | "log" | "legado" | "aprovada_em" | "cand">): number {
  const d = desfechoVaga(v);
  if (d === "contratada") return PASSOS_FLUXO.length - 1;
  let max = -1;
  const ver = (s: string | null) => {
    if (!s || s === "Reprovada" || s === "Cancelada") return;
    const i = indiceEtapa(etapaDoStatus(s));
    if (i > max) max = i;
  };
  ver(v.status);
  for (const [de, para] of v.log) { ver(de); ver(para); }
  if (v.legado && !v.log.length && v.aprovada_em) max = Math.max(max, indiceEtapa("selecao"));
  if (v.cand.total > 0) max = Math.max(max, indiceEtapa("selecao"));
  if (v.cand.selecionado_em) max = Math.max(max, indiceEtapa("aprovado"));
  return max;
}

// ---- Estatística -------------------------------------------------------------

export const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export function mediana(xs: number[]): number | null {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}
export const fmtDias = (d: number | null | undefined, casas = 1) =>
  d == null ? "—" : d < 1 && d > 0 ? `${Math.round(d * 24)} h` : `${d.toLocaleString("pt-BR", { maximumFractionDigits: casas })} d`;

// ---- Resumo ------------------------------------------------------------------

export interface ResumoVagas {
  solicitadas: number; posicoes: number; contratadas: number; reprovadas: number; canceladas: number; andamento: number;
  abertasAgora: number; posicoesAbertasAgora: number;
  tempoMedioContratar: number | null; medianaContratar: number | null; noPrazoPct: number | null;
  tempoMedioAprovacao: number | null; aproveitamentoPct: number | null;
  candidatosPorVaga: number | null; desistencias: number; abertaMaisAntiga: VagaPainel | null; legado: number;
}

export function resumoVagas(p: PainelVagas): ResumoVagas {
  const per = p.vagas.filter((v) => v.no_periodo);
  const abertas = p.vagas.filter((v) => !vagaFechada(v));
  const contr = per.filter((v) => desfechoVaga(v) === "contratada");
  const tempos = contr.map((v) => diasTotais(v, p.agora));
  const aprov = per.map((v) => tempoAprovacao(v)).filter((x): x is number => x != null);
  const decididas = per.filter((v) => vagaFechada(v)).length;
  const comCand = per.filter((v) => !v.legado);
  const maisAntiga = abertas.reduce<VagaPainel | null>((a, v) => (!a || ms(v.criada) < ms(a.criada) ? v : a), null);
  return {
    solicitadas: per.length,
    posicoes: per.reduce((s, v) => s + (v.qtd || 1), 0),
    contratadas: contr.length,
    reprovadas: per.filter((v) => desfechoVaga(v) === "reprovada").length,
    canceladas: per.filter((v) => desfechoVaga(v) === "cancelada").length,
    andamento: per.filter((v) => !vagaFechada(v)).length,
    abertasAgora: abertas.length,
    posicoesAbertasAgora: abertas.reduce((s, v) => s + (v.qtd || 1), 0),
    tempoMedioContratar: media(tempos),
    medianaContratar: mediana(tempos),
    noPrazoPct: tempos.length ? (tempos.filter((t) => t <= META_DIAS_CONTRATAR).length / tempos.length) * 100 : null,
    tempoMedioAprovacao: media(aprov),
    aproveitamentoPct: decididas ? (contr.length / decididas) * 100 : null,
    candidatosPorVaga: comCand.length ? media(comCand.map((v) => v.cand.total)) : null,
    desistencias: per.reduce((s, v) => s + v.cand.desistiu, 0),
    abertaMaisAntiga: maisAntiga,
    legado: per.filter((v) => v.legado).length,
  };
}

/**
 * Dias do pedido até sair da aprovação (Operacional/Analista/Diretoria →
 * Recrutamento). Legado: até "Operação aprovou". null = ainda não aprovada
 * ou sem registro.
 */
export function tempoAprovacao(v: Pick<VagaPainel, "criada" | "log" | "legado" | "aprovada_em">): number | null {
  const sai = v.log.find(([de, para]) => etapaDoStatus(de) === "aprovacao" && para != null && etapaDoStatus(para) !== "aprovacao" && para !== "Reprovada" && para !== "Cancelada");
  if (sai) return diasEntreMs(ms(v.criada), ms(sai[2]));
  if (v.legado && !v.log.length && v.aprovada_em) return diasEntreMs(ms(v.criada), ms(v.aprovada_em));
  return null;
}

// ---- Tempo por etapa ------------------------------------------------------------

export interface LinhaEtapa {
  chave: string; titulo: string;
  /** Vagas que passaram (trecho fechado) pela etapa. */
  vagas: number; media: number | null; mediana: number | null; maximo: number | null;
  /** Vagas paradas nela agora, e há quanto tempo (média / maior). */
  paradasAgora: number; mediaParadas: number | null; maiorParada: number | null;
}

export function tempoPorEtapa(p: PainelVagas): LinhaEtapa[] {
  const passaram: Record<string, number[]> = {};
  const paradas: Record<string, number[]> = {};
  for (const v of p.vagas) {
    const tr = trechosDaVaga(v, p.agora);
    if (v.no_periodo) {
      for (const [k, d] of Object.entries(diasPorEtapa(tr))) (passaram[k] ??= []).push(d);
    }
    const ab = tr.find((t) => t.aberto);
    if (ab) (paradas[ab.etapa] ??= []).push(ab.dias);
  }
  return ETAPAS.filter((e) => e.chave !== "contratado").map((e) => {
    const xs = passaram[e.chave] ?? [], ps = paradas[e.chave] ?? [];
    return {
      chave: e.chave, titulo: e.titulo, vagas: xs.length, media: media(xs), mediana: mediana(xs), maximo: xs.length ? Math.max(...xs) : null,
      paradasAgora: ps.length, mediaParadas: media(ps), maiorParada: ps.length ? Math.max(...ps) : null,
    };
  }).filter((l) => l.vagas > 0 || l.paradasAgora > 0);
}

// ---- Funil ------------------------------------------------------------------

export interface DegrauFunil { chave: string; titulo: string; n: number; pct: number }

export function funilVagas(p: PainelVagas): DegrauFunil[] {
  const per = p.vagas.filter((v) => v.no_periodo);
  const total = per.length;
  const alc = per.map((v) => ({ v, i: etapaAlcancada(v) }));
  const ate = (chave: string) => alc.filter((x) => x.i >= indiceEtapa(chave)).length;
  const degraus = [
    { chave: "solicitadas", titulo: "Solicitadas", n: total },
    { chave: "aprovadas", titulo: "Aprovadas", n: ate("recrutamento") },
    { chave: "abertas", titulo: "Abertas p/ seleção", n: ate("selecao") },
    { chave: "entrevistas", titulo: "Em entrevistas", n: ate("entrevistas") },
    { chave: "aprovado", titulo: "Candidato aprovado", n: ate("aprovado") },
    { chave: "contratadas", titulo: "Contratadas", n: per.filter((v) => desfechoVaga(v) === "contratada").length },
  ];
  return degraus.map((d) => ({ ...d, pct: total ? (d.n / total) * 100 : 0 }));
}

// ---- Mês a mês --------------------------------------------------------------

export interface LinhaMes { mes: string; solicitadas: number; contratadas: number; reprovadas: number; andamento: number; tempoMedio: number | null }

/** Por mês da SOLICITAÇÃO (coorte): das pedidas no mês, quantas já viraram o quê. */
export function mensalVagas(p: PainelVagas): LinhaMes[] {
  const m = new Map<string, VagaPainel[]>();
  const ini = new Date(`${p.de}T12:00:00`), fim = new Date(`${p.ate}T12:00:00`);
  for (let d = new Date(ini.getFullYear(), ini.getMonth(), 1); d <= fim; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    m.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, []);
  }
  for (const v of p.vagas) {
    if (!v.no_periodo) continue;
    const k = v.criada.slice(0, 7);
    if (m.has(k)) m.get(k)!.push(v);
  }
  return [...m.entries()].map(([mes, vs]) => {
    const c = vs.filter((v) => desfechoVaga(v) === "contratada");
    return {
      mes, solicitadas: vs.length, contratadas: c.length,
      reprovadas: vs.filter((v) => ["reprovada", "cancelada"].includes(desfechoVaga(v))).length,
      andamento: vs.filter((v) => !vagaFechada(v)).length,
      tempoMedio: media(c.map((v) => diasTotais(v, p.agora))),
    };
  });
}

// ---- Agrupamentos -----------------------------------------------------------

export interface LinhaGrupo {
  nome: string; vagas: number; posicoes: number; abertas: number; contratadas: number; reprovadas: number;
  tempoMedioContratar: number | null; mediaDiasAbertas: number | null;
}

export const DIMENSOES = {
  contrato: { titulo: "Contrato", f: (v: VagaPainel) => v.contrato },
  cargo: { titulo: "Cargo", f: (v: VagaPainel) => v.cargo },
  cidade: { titulo: "Cidade", f: (v: VagaPainel) => (v.cidade ? `${v.cidade}${v.uf ? `/${v.uf}` : ""}` : null) },
  solicitante: { titulo: "Solicitante", f: (v: VagaPainel) => v.solicitante },
  analista: { titulo: "Analista", f: (v: VagaPainel) => v.analista },
  motivo: { titulo: "Motivo", f: (v: VagaPainel) => v.motivo },
  urgencia: { titulo: "Urgência", f: (v: VagaPainel) => v.urgencia },
} as const;
export type Dimensao = keyof typeof DIMENSOES;

const limpo = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");

export function agruparVagas(p: PainelVagas, dim: Dimensao): LinhaGrupo[] {
  const f = DIMENSOES[dim].f;
  const g = new Map<string, { nome: string; vs: VagaPainel[] }>();
  for (const v of p.vagas) {
    if (!v.no_periodo && vagaFechada(v)) continue;
    const nome = limpo(f(v)) || "(não informado)";
    const k = nome.toLocaleUpperCase("pt-BR");
    if (!g.has(k)) g.set(k, { nome, vs: [] });
    g.get(k)!.vs.push(v);
  }
  return [...g.values()].map(({ nome, vs }) => {
    const per = vs.filter((v) => v.no_periodo);
    const ab = vs.filter((v) => !vagaFechada(v));
    const c = per.filter((v) => desfechoVaga(v) === "contratada");
    return {
      nome, vagas: per.length, posicoes: per.reduce((s, v) => s + (v.qtd || 1), 0), abertas: ab.length,
      contratadas: c.length, reprovadas: per.filter((v) => ["reprovada", "cancelada"].includes(desfechoVaga(v))).length,
      tempoMedioContratar: media(c.map((v) => diasTotais(v, p.agora))),
      mediaDiasAbertas: media(ab.map((v) => diasTotais(v, p.agora))),
    };
  }).sort((a, b) => b.vagas - a.vagas || b.abertas - a.abertas || a.nome.localeCompare(b.nome));
}

// ---- Aging das abertas --------------------------------------------------------

export const FAIXAS_AGING = [
  { rotulo: "até 7 d", ate: 7, cor: "#16a34a" }, { rotulo: "8–15 d", ate: 15, cor: "#84cc16" },
  { rotulo: "16–30 d", ate: 30, cor: "#f59e0b" }, { rotulo: "31–60 d", ate: 60, cor: "#ea580c" },
  { rotulo: "+60 d", ate: Infinity, cor: "#dc2626" },
];

export function agingAbertas(p: PainelVagas) {
  const ab = p.vagas.filter((v) => !vagaFechada(v));
  return FAIXAS_AGING.map((f, i) => {
    const de = i === 0 ? -1 : FAIXAS_AGING[i - 1].ate;
    const vs = ab.filter((v) => { const d = diasTotais(v, p.agora); return d > de && d <= f.ate; });
    return { ...f, vagas: vs.length, posicoes: vs.reduce((s, v) => s + (v.qtd || 1), 0) };
  });
}

/** Cor do semáforo de dias em aberto. */
export const corDias = (d: number) => FAIXAS_AGING.find((f) => d <= f.ate)?.cor ?? "#dc2626";

// ---- Filtro local (na tela) ------------------------------------------------------

export interface FiltroLocal { busca: string; fase: "todas" | Desfecho; motivo: string | null; urgencia: string | null; legado: boolean }
export const FILTRO_LOCAL_PADRAO: FiltroLocal = { busca: "", fase: "todas", motivo: null, urgencia: null, legado: true };

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function aplicarFiltroLocal(p: PainelVagas, f: FiltroLocal): PainelVagas {
  const termo = norm(f.busca.trim());
  const vagas = p.vagas.filter((v) => {
    if (!f.legado && v.legado) return false;
    if (f.fase !== "todas" && desfechoVaga(v) !== f.fase) return false;
    if (f.motivo && limpo(v.motivo) !== f.motivo) return false;
    if (f.urgencia && limpo(v.urgencia) !== f.urgencia) return false;
    if (termo) {
      const alvo = norm([`#${v.id}`, v.cargo, v.contrato, v.cidade, v.solicitante, v.contratado, v.analista, v.setor].join(" "));
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });
  return { ...p, vagas };
}

export const opcoesDe = (p: PainelVagas | undefined, f: (v: VagaPainel) => string | null) =>
  [...new Set((p?.vagas ?? []).map((v) => limpo(f(v))).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
