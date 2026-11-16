// =====================================================================
// SIS-2026-0914 — Treinamentos › Participação nos vídeos (17/11/2026).
//
// Pedido do Jurídico (resposta a uma notificação, prazo 25/11/2026): provar
// a capacitação dos colaboradores nos vídeos de treinamento, com a situação
// ATÉ uma data escolhida. Os números vêm das RPCs trn_participacao_resumo e
// trn_participacao_individual (mig 20261117091400). Este arquivo guarda a
// MESMA regra em TypeScript puro — para ter teste
// (src/test/treinamentos-participacao-videos.test.ts) e para a tela e as
// exportações descreverem a regra com as mesmas palavras do banco. Mudou a
// regra num lado, mude no outro.
//
// REGRAS
//   · Pessoa = Empresa + Cadastro da Senior. Acesso repetido, ou a mesma
//     pessoa em duas linhas da EMPREGADOS, continua sendo UMA pessoa.
//   · Deveria realizar na data D = admitido até D e não desligado até D
//     (desligado depois de D conta; admitido depois não), e no público do
//     curso em D — ou ter acessado o vídeo até D.
//   · Acessou = primeiro acesso até o fim do dia D (horário de Brasília).
//   · Concluiu = assistiu até o fim / concluiu a aula até o fim do dia D.
//     Conclusão depois de D não conta.
//   · Situação no treinamento: concluído (todos os vídeos que lhe cabiam),
//     em andamento (acessou algum), não iniciado (nenhum acesso até D).
// =====================================================================

export type SituacaoParticipacao = "nao_iniciado" | "em_andamento" | "concluido";

export const ROTULO_SITUACAO: Record<SituacaoParticipacao, string> = {
  nao_iniciado: "Não iniciado",
  em_andamento: "Em andamento",
  concluido: "Concluído",
};

/** Códigos de empresa da Senior do chamado (mesmo mapa de colaboradoresUtils.EMPRESA_MAP). */
export const EMPRESAS_PARTICIPACAO = [
  { codigo: 1, sigla: "HAGG" },
  { codigo: 2, sigla: "SN" },
  { codigo: 5, sigla: "NH" },
] as const;

// ── Formato que as RPCs devolvem ─────────────────────────────────────
export interface MetricasParticipacao {
  publico: number;
  acessaram: number;
  concluiram: number;
  acessaram_nao_concluiram: number;
  nao_acessaram: number;
}
export interface ParticipacaoVideo extends MetricasParticipacao {
  aula_id: string; aula: string; curso_id: string; curso: string;
}
export interface ParticipacaoTreinamento extends MetricasParticipacao {
  curso_id: string; curso: string; videos: number;
}
export interface ResumoParticipacao {
  data: string;
  totais: {
    pessoas: number; acessaram: number; concluiram_tudo: number; em_andamento: number;
    nao_acessaram: number; videos: number; treinamentos: number;
  };
  por_video: ParticipacaoVideo[];
  por_treinamento: ParticipacaoTreinamento[];
  opcoes: { contratos: string[]; cargos: string[]; videos: { id: string; nome: string; curso_id: string }[] };
}
export interface LinhaIndividual {
  pessoa: string; empresa: string; cadastro: number; nome: string;
  contrato: string | null; cargo: string | null;
  curso_id: string; curso: string;
  videos: number; acessados: number; concluidos: number;
  primeiro_acesso: string | null; conclusao: string | null;
  situacao: SituacaoParticipacao;
}
export interface PaginaIndividual { data: string; total: number; linhas: LinhaIndividual[] }

export interface FiltrosParticipacao {
  data: string;            // AAAA-MM-DD
  curso: string | null;
  aula: string | null;
  empresa: number | null;
  contrato: string | null;
  cargo: string | null;
}

// ── Regra pura (espelho da trn_participacao_base) ────────────────────
export interface ColaboradorRegra {
  empresa: number;
  cadastro: number;
  admissao: string | null;      // AAAA-MM-DD
  desligamento: string | null;  // AAAA-MM-DD, só quando Demitido
  demitido: boolean;
}
export interface EventoVideo {
  empresa: number;
  cadastro: number;
  aula: string;
  /** Instantes (ISO) de cada abertura do vídeo — várias por pessoa é normal. */
  acessos: string[];
  /** Instante (ISO) em que assistiu até o fim / concluiu, se houver. */
  conclusao: string | null;
}

export const chavePessoa = (empresa: number, cadastro: number) => `${empresa}-${cadastro}`;

/** Dia (AAAA-MM-DD) de um instante no horário de Brasília. */
export function diaBrasilia(iso: string): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
}

/** Aconteceu até o fim do dia D (Brasília)? */
export const ateData = (iso: string | null | undefined, data: string) => !!iso && diaBrasilia(iso) <= data;

/**
 * Deveria realizar na data: admitido até D e não desligado até D.
 * Demitido sem data de desligamento fica fora — não dá para provar que estava ativo.
 */
export function ativoNaData(c: ColaboradorRegra, data: string): boolean {
  if (!c.admissao || c.admissao > data) return false;
  if (c.demitido && (!c.desligamento || c.desligamento <= data)) return false;
  return true;
}

export function situacaoAte(acessos: (string | null)[], conclusao: string | null, data: string): SituacaoParticipacao {
  if (ateData(conclusao, data)) return "concluido";
  if (acessos.some((a) => ateData(a, data))) return "em_andamento";
  return "nao_iniciado";
}

/**
 * Números de UM vídeo na data, contando pessoas distintas.
 * `colaboradores` = o cadastro (pode repetir a mesma Empresa + Cadastro);
 * `noPublico` diz se as regras do curso alcançam a pessoa em D. Quem acessou
 * até a data também entra no público (a regra pode ter mudado depois) —
 * desde que estivesse ativo em D.
 */
export function metricasVideo(
  aula: string,
  colaboradores: ColaboradorRegra[],
  noPublico: (c: ColaboradorRegra) => boolean,
  eventos: EventoVideo[],
  data: string,
): MetricasParticipacao {
  const ativos = new Map<string, ColaboradorRegra>();
  for (const c of colaboradores) {
    if (ativoNaData(c, data)) ativos.set(chavePessoa(c.empresa, c.cadastro), c);
  }
  const publico = new Set([...ativos].filter(([, c]) => noPublico(c)).map(([k]) => k));
  const acessou = new Set<string>();
  const concluiu = new Set<string>();
  for (const e of eventos) {
    if (e.aula !== aula) continue;
    const k = chavePessoa(e.empresa, e.cadastro);
    if (!ativos.has(k)) continue; // sem vínculo ativo em D (ou sem Empresa + Cadastro)
    const acessouAte = e.acessos.some((a) => ateData(a, data)) || ateData(e.conclusao, data);
    if (!acessouAte) continue;
    publico.add(k);
    acessou.add(k);
    if (ateData(e.conclusao, data)) concluiu.add(k);
  }
  const p = publico.size;
  return {
    publico: p,
    acessaram: acessou.size,
    concluiram: concluiu.size,
    acessaram_nao_concluiram: acessou.size - concluiu.size,
    nao_acessaram: p - acessou.size,
  };
}

// ── Apresentação ─────────────────────────────────────────────────────
export const pctConclusao = (m: Pick<MetricasParticipacao, "publico" | "concluiram">) =>
  m.publico > 0 ? Math.round((m.concluiram / m.publico) * 1000) / 10 : 0;

export const pctTexto = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/** AAAA-MM-DD → dd/mm/aaaa. */
export function dataBr(dia: string | null | undefined): string {
  if (!dia) return "";
  const [a, m, d] = dia.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : dia;
}

/** Instante → dd/mm/aaaa hh:mm no horário de Brasília. */
export function dataHoraBr(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** Linhas de texto dos filtros aplicados — vão no cabeçalho do PDF e do Excel. */
export function descreverFiltros(
  f: FiltrosParticipacao,
  nomes: { curso?: string | null; aula?: string | null },
  extra?: { situacao?: SituacaoParticipacao | null; busca?: string | null },
): string[] {
  const empresa = f.empresa != null ? (EMPRESAS_PARTICIPACAO.find((e) => e.codigo === f.empresa)?.sigla ?? `Empresa ${f.empresa}`) : null;
  const linhas = [
    `Situação até ${dataBr(f.data)} (fim do dia, horário de Brasília)`,
    `Treinamento: ${nomes.curso ?? "todos"}`,
    `Vídeo: ${nomes.aula ?? "todos"}`,
    `Empresa: ${empresa ?? "todas (HAGG, SN, NH e demais)"}`,
    `Contrato: ${f.contrato ?? "todos"}`,
    `Cargo: ${f.cargo ?? "todos"}`,
  ];
  if (extra?.situacao) linhas.push(`Situação: ${ROTULO_SITUACAO[extra.situacao]}`);
  if (extra?.busca?.trim()) linhas.push(`Busca por nome/cadastro: ${extra.busca.trim()}`);
  return linhas;
}

/** Texto da regra que vai em todo relatório exportado. */
export const NOTA_REGRA = [
  "Contagem por pessoa (Empresa + Cadastro da Senior): acessos repetidos contam uma vez.",
  "Deveriam realizar = colaboradores admitidos até a data e não desligados até a data, no público do treinamento (ou que acessaram o vídeo).",
  "Acessou = primeiro acesso até a data. Concluiu = assistiu até o fim / concluiu até a data; conclusões posteriores não contam.",
  "Contrato e cargo são os do cadastro atual. Antes de 05/10/2026 a data do primeiro acesso é a do primeiro registro de progresso (nunca anterior ao acesso real).",
];
