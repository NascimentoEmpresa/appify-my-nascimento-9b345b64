import {
  META_DIAS_CONTRATAR, chaveDoGrupo, desfechoVaga, diasTotais, media, mediana, nomeNoGrupo, vagaFechada, vagaAbertaAgora,
  type PainelVagas, type VagaPainel,
} from "@/lib/relatorios/vagasPainel";

// =====================================================================
// RELATÓRIOS › VAGAS — DASHBOARD - RECRUTADORES (21/10/2026, mig 20261021000150)
// Com teste em src/test/relatorios-vagas-recrutadores.test.ts.
//
// Pedido do Pablo: "um dashboard por recrutador, para ver quem está
// trabalhando mais, com todas as informações e histórico".
//
// Duas fontes, cada uma com a regra que já existia:
//   · VAGAS DO RECRUTADOR = responsável pela vaga (SISTEMA_RECRUTAMENTO_
//     RESPONSAVEL — automático pelo papel Recrutamento no histórico, manual,
//     assumido ou distribuído pela gestão). É a mesma coluna "Responsável pela
//     vaga" da tabela da Visão geral (DIMENSOES.responsavel), agrupada do mesmo
//     jeito (nomeNoGrupo/chaveDoGrupo) — por isso a soma das linhas do ranking
//     fecha com os KPIs da Visão geral. Vaga sem responsável (quase todo o
//     sistema antigo/Discord) vira a linha "Sem responsável", que NÃO some:
//     sem ela o total não fecharia.
//   · TRABALHO = movimentações do RECRUTAMENTO_HISTORICO com papel
//     Recrutamento, atribuídas a QUEM fez (dir_vagas_recrutadores_mov), pela
//     data do movimento. Só contam as das vagas do recorte (busca, desfecho,
//     contrato, sistema antigo… valem para as duas fontes). O log começou em
//     19/08/2026: antes disso não há movimento para atribuir.
// =====================================================================

export type TipoMov = "desistencia" | "admissao" | "reprovacao" | "selecao" | "movimento" | "candidato" | "vaga";
/** [vaga, quem fez, dia (AAAA-MM-DD, horário de Brasília), tipo, nº de eventos, ids dos candidatos]. */
export type LinhaMov = [number, string, string, TipoMov, number, number[]];
export interface MovRecrutadores { de: string; ate: string; linhas: LinhaMov[] }

export const TIPOS_MOV: { chave: TipoMov; titulo: string; cor: string }[] = [
  { chave: "selecao", titulo: "Candidatos colocados no processo", cor: "#2563eb" },
  { chave: "movimento", titulo: "Avanços de etapa", cor: "#7c3aed" },
  { chave: "admissao", titulo: "Enviados à admissão", cor: "#16a34a" },
  { chave: "reprovacao", titulo: "Reprovações", cor: "#dc2626" },
  { chave: "desistencia", titulo: "Desistências registradas", cor: "#f59e0b" },
  { chave: "candidato", titulo: "Outros registros do candidato", cor: "#94a3b8" },
  { chave: "vaga", titulo: "Andamentos da vaga", cor: "#0891b2" },
];

/** O nome que agrupa as vagas sem responsável (o mesmo de nomeNoGrupo). */
export const SEM_RESPONSAVEL = "(não informado)";
export const recrutadorDaVaga = (v: VagaPainel) => nomeNoGrupo(v, "responsavel");
export const chaveRecrutador = (nome: string) => chaveDoGrupo(nome.trim().replace(/\s+/g, " "));
export const rotuloRecrutador = (nome: string) => (nome === SEM_RESPONSAVEL ? "Sem responsável" : nome);

// ---- Filtros da aba ------------------------------------------------------------

/** recrutador = chaveRecrutador; contrato = nome como vem na vaga; vaga = nº. */
export interface FiltroRecrutadores { recrutador: string | null; contrato: string | null; vaga: number | null }
export const FILTRO_RECRUTADORES_PADRAO: FiltroRecrutadores = { recrutador: null, contrato: null, vaga: null };

const limpoUp = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");

/**
 * Recorte da aba (por cima dos filtros do topo): contrato e vaga. O
 * recrutador NÃO entra aqui — o ranking mostra todos os do recorte, e o
 * recrutador escolhido só abre o detalhe dele (vagasDoRecrutador).
 */
export function recorteRecrutadores(p: PainelVagas, f: FiltroRecrutadores): PainelVagas {
  if (!f.contrato && f.vaga == null) return p;
  const ct = f.contrato ? limpoUp(f.contrato) : null;
  return { ...p, vagas: p.vagas.filter((v) => (!ct || limpoUp(v.contrato) === ct) && (f.vaga == null || v.id === f.vaga)) };
}

/** O painel só com as vagas de um recrutador (para resumoVagas/mensalVagas darem os números dele). */
export function vagasDoRecrutador(p: PainelVagas, chave: string | null): PainelVagas {
  if (!chave) return p;
  return { ...p, vagas: p.vagas.filter((v) => chaveRecrutador(recrutadorDaVaga(v)) === chave) };
}

/** As movimentações das vagas do recorte (e, com `chave`, só as feitas por essa pessoa). */
export function movDoRecorte(mov: LinhaMov[], p: PainelVagas, chave: string | null = null): LinhaMov[] {
  const ids = new Set(p.vagas.map((v) => v.id));
  return mov.filter((m) => ids.has(m[0]) && (!chave || chaveRecrutador(m[1]) === chave));
}

// ---- Uma linha por recrutador ---------------------------------------------------

export interface ResumoMov {
  eventos: number;
  /** Candidatos distintos que a pessoa movimentou. */
  candidatos: number;
  porTipo: Record<TipoMov, number>;
  /** Vagas em que mexeu; e quantas delas têm outra pessoa como responsável. */
  vagasTocadas: number; emVagasDeOutros: number;
  diasAtivos: number; ultimo: string | null;
}

export interface LinhaRecrutador {
  chave: string; nome: string; semResponsavel: boolean;
  /** Vagas pedidas no período sob a responsabilidade dela (como "Vagas solicitadas" da Visão geral). */
  vagas: number; posicoes: number; contratadas: number; reprovadas: number; canceladas: number; andamento: number;
  /** Abertas agora (inclui as pedidas antes do período, como na Visão geral). */
  abertasAgora: number; mediaDiasAbertas: number | null; abertaMaisAntiga: VagaPainel | null;
  tempoMedioContratar: number | null; medianaContratar: number | null; noPrazo: number; noPrazoPct: number | null;
  /** Contratadas ÷ vagas que já fecharam. */
  aproveitamentoPct: number | null;
  candidatos: number; desistencias: number;
  mov: ResumoMov;
}

const tiposZerados = (): Record<TipoMov, number> => ({ desistencia: 0, admissao: 0, reprovacao: 0, selecao: 0, movimento: 0, candidato: 0, vaga: 0 });

export function resumoMov(mov: LinhaMov[], donoDaVaga?: Map<number, string>, chave?: string): ResumoMov {
  const cands = new Set<number>(), vagas = new Set<number>(), dias = new Set<string>(), outros = new Set<number>();
  const porTipo = tiposZerados();
  let eventos = 0, ultimo: string | null = null;
  for (const [vaga, , dia, tipo, n, cs] of mov) {
    eventos += n;
    porTipo[tipo] = (porTipo[tipo] ?? 0) + n;
    for (const c of cs) cands.add(c);
    vagas.add(vaga); dias.add(dia);
    if (!ultimo || dia > ultimo) ultimo = dia;
    if (donoDaVaga && chave && donoDaVaga.get(vaga) !== chave) outros.add(vaga);
  }
  return { eventos, candidatos: cands.size, porTipo, vagasTocadas: vagas.size, emVagasDeOutros: outros.size, diasAtivos: dias.size, ultimo };
}

/** Do recorte (já com contrato/vaga): uma linha por pessoa — dona de vaga ou autora de movimento. */
export function linhasRecrutadores(p: PainelVagas, mov: LinhaMov[]): LinhaRecrutador[] {
  const grupos = new Map<string, { nome: string; vs: VagaPainel[]; ms: LinhaMov[] }>();
  const grupo = (nome: string) => {
    const k = chaveRecrutador(nome);
    if (!grupos.has(k)) grupos.set(k, { nome, vs: [], ms: [] });
    return grupos.get(k)!;
  };
  const dono = new Map<number, string>();
  for (const v of p.vagas) {
    const nome = recrutadorDaVaga(v);
    dono.set(v.id, chaveRecrutador(nome));
    // Mesmo universo de agruparVagas: do período, ou aberta agora.
    if (!v.no_periodo && vagaFechada(v)) continue;
    grupo(nome).vs.push(v);
  }
  for (const m of movDoRecorte(mov, p)) grupo(m[1]).ms.push(m);

  return [...grupos.entries()].map(([chave, { nome, vs, ms }]) => {
    const per = vs.filter((v) => v.no_periodo);
    const ab = vs.filter(vagaAbertaAgora);
    const contr = per.filter((v) => desfechoVaga(v) === "contratada");
    const tempos = contr.map((v) => diasTotais(v, p.agora));
    const decididas = per.filter((v) => vagaFechada(v)).length;
    const noPrazo = tempos.filter((t) => t <= META_DIAS_CONTRATAR).length;
    return {
      chave, nome, semResponsavel: nome === SEM_RESPONSAVEL,
      vagas: per.length, posicoes: per.reduce((s, v) => s + (v.qtd || 1), 0),
      contratadas: contr.length,
      reprovadas: per.filter((v) => desfechoVaga(v) === "reprovada").length,
      canceladas: per.filter((v) => desfechoVaga(v) === "cancelada").length,
      andamento: per.filter((v) => !vagaFechada(v)).length,
      abertasAgora: ab.length,
      mediaDiasAbertas: media(ab.map((v) => diasTotais(v, p.agora))),
      abertaMaisAntiga: ab.reduce<VagaPainel | null>((a, v) => (!a || +new Date(v.criada) < +new Date(a.criada) ? v : a), null),
      tempoMedioContratar: media(tempos), medianaContratar: mediana(tempos),
      noPrazo, noPrazoPct: tempos.length ? (noPrazo / tempos.length) * 100 : null,
      aproveitamentoPct: decididas ? (contr.length / decididas) * 100 : null,
      candidatos: per.reduce((s, v) => s + (v.cand.total || 0), 0),
      desistencias: per.reduce((s, v) => s + v.cand.desistiu, 0),
      mov: resumoMov(ms, dono, chave),
    };
  });
}

/** Por onde ordenar o ranking ("quem está trabalhando mais"). */
export const METRICAS_RANKING = {
  movimentos: { titulo: "Movimentações", f: (l: LinhaRecrutador) => l.mov.eventos },
  candidatos: { titulo: "Candidatos movimentados", f: (l: LinhaRecrutador) => l.mov.candidatos },
  contratadas: { titulo: "Contratadas", f: (l: LinhaRecrutador) => l.contratadas },
  abertas: { titulo: "Abertas agora (carga)", f: (l: LinhaRecrutador) => l.abertasAgora },
  vagas: { titulo: "Vagas solicitadas", f: (l: LinhaRecrutador) => l.vagas },
  diasAtivos: { titulo: "Dias com movimentação", f: (l: LinhaRecrutador) => l.mov.diasAtivos },
} as const;
export type MetricaRanking = keyof typeof METRICAS_RANKING;

/** Ordena pela métrica (maior primeiro); "Sem responsável" sempre por último — não é uma pessoa. */
export function ordenarRanking(ls: LinhaRecrutador[], m: MetricaRanking): LinhaRecrutador[] {
  const f = METRICAS_RANKING[m].f;
  return [...ls].sort((a, b) => Number(a.semResponsavel) - Number(b.semResponsavel) || f(b) - f(a) || b.vagas - a.vagas || a.nome.localeCompare(b.nome, "pt-BR"));
}

// ---- Mês a mês -------------------------------------------------------------------

export function mesesDoPeriodo(de: string, ate: string): string[] {
  const out: string[] = [];
  const ini = new Date(`${de}T12:00:00`), fim = new Date(`${ate}T12:00:00`);
  for (let d = new Date(ini.getFullYear(), ini.getMonth(), 1); d <= fim; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export interface MovMes { mes: string; eventos: number; candidatos: number; porTipo: Record<TipoMov, number> }

/** Movimentações por mês do MOVIMENTO (candidatos distintos dentro de cada mês). */
export function movPorMes(mov: LinhaMov[], de: string, ate: string): MovMes[] {
  const m = new Map(mesesDoPeriodo(de, ate).map((k) => [k, [] as LinhaMov[]]));
  for (const x of mov) m.get(x[2].slice(0, 7))?.push(x);
  return [...m.entries()].map(([mes, xs]) => {
    const r = resumoMov(xs);
    return { mes, eventos: r.eventos, candidatos: r.candidatos, porTipo: r.porTipo };
  });
}

/** Uma série por pessoa (as `chaves` escolhidas): movimentações em cada mês. */
export function movMensalPorRecrutador(mov: LinhaMov[], chaves: string[], de: string, ate: string): ({ mes: string } & Record<string, number | string>)[] {
  const alvo = new Set(chaves);
  const m = new Map(mesesDoPeriodo(de, ate).map((k) => [k, Object.fromEntries(chaves.map((c) => [c, 0])) as Record<string, number>]));
  for (const [, quem, dia, , n] of mov) {
    const k = chaveRecrutador(quem);
    if (!alvo.has(k)) continue;
    const linha = m.get(dia.slice(0, 7));
    if (linha) linha[k] += n;
  }
  return [...m.entries()].map(([mes, r]) => ({ mes, ...r }));
}

/** Por vaga: quantas movimentações (e candidatos distintos) a pessoa fez nela. */
export function movPorVaga(mov: LinhaMov[]): Map<number, { eventos: number; candidatos: number }> {
  const out = new Map<number, { eventos: number; cs: Set<number> }>();
  for (const [vaga, , , , n, cs] of mov) {
    const e = out.get(vaga) ?? { eventos: 0, cs: new Set<number>() };
    e.eventos += n;
    for (const c of cs) e.cs.add(c);
    out.set(vaga, e);
  }
  return new Map([...out.entries()].map(([k, e]) => [k, { eventos: e.eventos, candidatos: e.cs.size }]));
}

// ---- As vagas por trás de um número do ranking ------------------------------------

export type ColunaRecrutador = "vagas" | "contratadas" | "reprovadas" | "abertas" | "no_prazo" | "desistencias" | "tocadas";

/** Os ids das vagas por trás de uma célula do ranking — o mesmo critério da conta de linhasRecrutadores. */
export function idsDaCelula(p: PainelVagas, mov: LinhaMov[], chave: string, col: ColunaRecrutador): number[] {
  if (col === "tocadas") return [...new Set(movDoRecorte(mov, p, chave).map((m) => m[0]))];
  const vs = vagasDoRecrutador(p, chave).vagas.filter((v) => v.no_periodo || !vagaFechada(v));
  const per = vs.filter((v) => v.no_periodo);
  const lista =
    col === "vagas" ? per
      : col === "abertas" ? vs.filter(vagaAbertaAgora)
      : col === "contratadas" ? per.filter((v) => desfechoVaga(v) === "contratada")
      : col === "reprovadas" ? per.filter((v) => ["reprovada", "cancelada"].includes(desfechoVaga(v)))
      : col === "no_prazo" ? per.filter((v) => desfechoVaga(v) === "contratada" && diasTotais(v, p.agora) <= META_DIAS_CONTRATAR)
      : per.filter((v) => v.cand.desistiu > 0);
  return lista.map((v) => v.id);
}
