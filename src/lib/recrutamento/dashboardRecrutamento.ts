// =====================================================================
// DASHBOARD RECRUTAMENTO — os cálculos (02/10/2026, mig 20260930000288)
//
// Tudo o que a tela src/pages/rh/DashboardRecrutamento.tsx mostra sai daqui,
// com teste em src/test/dashboard-recrutamento.test.ts. A tela só desenha.
//
// Dois recortes, de propósito separados (é o que confundia no painel antigo
// do Power BI, que misturava "total" com "em andamento"):
//   • SITUAÇÃO AGORA — as vagas em aberto hoje (nem contratadas, nem
//     reprovadas/canceladas), com o prazo de cada uma. Não olha período.
//   • DESEMPENHO NO PERÍODO — o que foi solicitado, contratado e reprovado
//     dentro das datas escolhidas, e quanto tempo levou.
// Os filtros de dimensão (contrato, cidade, cargo, urgência, motivo) valem
// para os dois.
//
// PRAZO = a "Data de início prevista" da solicitação (texto livre no banco:
// ISO na maioria, "IMEDIATO"/"imediata"/"mais rápido possível" no legado do
// Discord, às vezes "20/03"). Imediato vence no dia em que a vaga foi
// pedida. Atrasada = prazo antes de hoje; em atenção = vence em até
// JANELA_ATENCAO dias; no prazo = depois disso; sem data = não deu para ler.
// =====================================================================

import { PASSOS_FLUXO } from "@/lib/recrutamento/fluxoStatus";

// ── Dados (como a RPC recrut_dashboard_dados devolve, já desempacotados) ──

export interface VagaDash {
  id: number;
  criada: string;               // "YYYY-MM-DDTHH:MI", horário de São Paulo
  status: string;
  mudou: string | null;         // última mudança de status
  cargo: string | null;
  contrato: string | null;
  cidade: string | null;
  qtd: number;
  motivo: string | null;
  urgencia: string | null;
  prevista: string | null;      // texto livre (ver PRAZO no topo)
  escala: string | null;
  horario: string | null;
  local: string | null;
  solicitante: string | null;
  administrativa: boolean;
  contratado: string | null;
  contratado_inicio: string | null;
  substituido: string | null;
  legado: boolean;
  aprovada_em: string | null;
  aberta_em: string | null;
}

export interface CandidatoDash {
  id: number;
  vaga_id: number | null;
  criado: string;
  etapa: string | null;
  etapa_em: string | null;
  nome: string | null;
  tipo: string | null;
  desistiu: boolean;
  admitido_em: string | null;
}

export interface TempoEtapa { etapa: string; n: number; media: number; mediana: number }

export interface DadosDashboard {
  geradoEm: string;
  vagas: VagaDash[];
  candidatos: CandidatoDash[];
  tempos: TempoEtapa[];
}

interface RespostaRpc {
  gerado_em?: string;
  vagas_colunas?: string[];
  vagas?: unknown[][];
  candidatos_colunas?: string[];
  candidatos?: unknown[][];
  tempos?: { etapa: string; n: number; media: number | string; mediana: number | string }[];
}

/** A RPC manda colunar (cabeçalho + listas); aqui vira objeto por linha. */
function linhas<T>(colunas: string[] | undefined, dados: unknown[][] | undefined): T[] {
  if (!colunas || !dados) return [];
  return dados.map((l) => Object.fromEntries(colunas.map((c, i) => [c, l[i] ?? null])) as T);
}

export function desempacotar(raw: unknown): DadosDashboard {
  const r = (raw ?? {}) as RespostaRpc;
  return {
    geradoEm: r.gerado_em ?? "",
    vagas: linhas<VagaDash>(r.vagas_colunas, r.vagas).map((v) => ({ ...v, qtd: Number(v.qtd) > 0 ? Number(v.qtd) : 1 })),
    candidatos: linhas<CandidatoDash>(r.candidatos_colunas, r.candidatos),
    tempos: (r.tempos ?? []).map((t) => ({ etapa: t.etapa, n: Number(t.n), media: Number(t.media), mediana: Number(t.mediana) })),
  };
}

// ── Datas ────────────────────────────────────────────────────────────────

/** Hoje em São Paulo, "YYYY-MM-DD". */
export const hojeSP = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

const dia = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);

/** Dias inteiros de a até b (datas "YYYY-MM-DD"); b − a. */
export function diasEntre(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/** Dias (com fração) entre dois "YYYY-MM-DDTHH:MI". */
export function diasCorridos(de: string | null, ate: string | null): number | null {
  if (!de || !ate) return null;
  const ms = new Date(ate).getTime() - new Date(de).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms / 86_400_000 : null;
}

export const somarDias = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const rotuloMes = (ym: string) => `${MESES_CURTOS[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;
export const dataBr = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

// ── Status da vaga ───────────────────────────────────────────────────────

export type Desfecho = "aberta" | "contratada" | "reprovada" | "cancelada";

/** "Concluída" (botão Concluir) também é contratada — fluxoStatus não pega. */
export function desfecho(status: string | null | undefined): Desfecho {
  const s = String(status ?? "").trim();
  if (s === "Reprovada") return "reprovada";
  if (s === "Cancelada") return "cancelada";
  if (s === "Contratado" || s === "Concluída" || s.startsWith("Concluído")) return "contratada";
  return "aberta";
}

/** As fases da vaga em aberto, na ordem do fluxo (sem o "Contratado"). */
export const FASES_ABERTAS = PASSOS_FLUXO.filter((p) => p.chave !== "contratado");

/** Índice em FASES_ABERTAS; status desconhecido cai na seleção (o grosso do processo). */
export function faseDaVaga(status: string): number {
  const i = FASES_ABERTAS.findIndex((p) => p.status.includes(status));
  return i >= 0 ? i : FASES_ABERTAS.findIndex((p) => p.chave === "selecao");
}

/** Os três grandes blocos do andamento — é o que vira tile e etiqueta. */
export type Andamento = "Aguardando aprovação" | "Conferência do Recrutamento" | "Em seleção";
export function andamento(status: string): Andamento {
  const chave = FASES_ABERTAS[faseDaVaga(status)]?.chave;
  if (chave === "aprovacao") return "Aguardando aprovação";
  if (chave === "recrutamento") return "Conferência do Recrutamento";
  return "Em seleção";
}

// ── Urgência ─────────────────────────────────────────────────────────────

export type Urgencia = "Alta" | "Média" | "Baixa" | "Não informada";
export const URGENCIAS: Urgencia[] = ["Alta", "Média", "Baixa", "Não informada"];

/** "Alta – posto não pode ficar descoberto" e "Alta — Urgente" são a mesma Alta. */
export function urgencia(u: string | null | undefined): Urgencia {
  const s = String(u ?? "").trim().toLowerCase();
  if (s.startsWith("alta")) return "Alta";
  if (s.startsWith("méd") || s.startsWith("med")) return "Média";
  if (s.startsWith("baixa")) return "Baixa";
  return "Não informada";
}

// ── Prazo ────────────────────────────────────────────────────────────────

export const JANELA_ATENCAO = 7;

export interface Prazo { data: string | null; imediato: boolean }

/** Lê a data de início prevista (texto livre) — ver PRAZO no topo do arquivo. */
export function prazoDaVaga(v: Pick<VagaDash, "prevista" | "criada">): Prazo {
  const t = String(v.prevista ?? "").trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { data: `${iso[1]}-${iso[2]}-${iso[3]}`, imediato: false };
  const norm = t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/imediat|mais rapido|urgente|o quanto antes|asap/.test(norm)) return { data: dia(v.criada), imediato: true };
  const br = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (br) {
    const ano = br[3] ? (br[3].length === 2 ? `20${br[3]}` : br[3]) : String(v.criada ?? "").slice(0, 4);
    const d = Number(br[1]); const m = Number(br[2]);
    if (/^\d{4}$/.test(ano) && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return { data: `${ano}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, imediato: false };
    }
  }
  return { data: null, imediato: false };
}

export type SituacaoPrazo = "atrasada" | "atencao" | "no_prazo" | "sem_data";
export const SITUACOES_PRAZO: SituacaoPrazo[] = ["atrasada", "atencao", "no_prazo", "sem_data"];
export const ROTULO_PRAZO: Record<SituacaoPrazo, string> = {
  atrasada: "Atrasada", atencao: "Em atenção", no_prazo: "No prazo", sem_data: "Sem data",
};
/** Paleta de STATUS (dataviz, fixa) — sempre com rótulo/ícone ao lado, nunca a cor sozinha. */
export const COR_PRAZO: Record<SituacaoPrazo, string> = {
  atrasada: "#d03b3b", atencao: "#fab219", no_prazo: "#0ca30c", sem_data: "#898781",
};

/** Dias que faltam até o prazo (negativo = atrasada há N dias). */
export function diasQueFaltam(v: Pick<VagaDash, "prevista" | "criada">, hoje = hojeSP()): number | null {
  const p = prazoDaVaga(v).data;
  return p ? diasEntre(hoje, p) : null;
}

export function situacaoPrazo(v: Pick<VagaDash, "prevista" | "criada">, hoje = hojeSP()): SituacaoPrazo {
  const f = diasQueFaltam(v, hoje);
  if (f == null) return "sem_data";
  if (f < 0) return "atrasada";
  if (f <= JANELA_ATENCAO) return "atencao";
  return "no_prazo";
}

// ── Candidatos ───────────────────────────────────────────────────────────

/** A ordem do kanban do candidato (Recrutamento.tsx › CAND_ETAPAS). */
export const ETAPAS_CANDIDATO = [
  "ENTRADA", "TRIAGEM", "JURÍDICO", "ENTREVISTA", "ENTREVISTA GESTOR",
  "APROVADO", "DOCUMENTAÇÃO", "SST + COMPRAS", "ADMISSÃO",
];
/** Etapas antigas do paralelo (antes da fusão) caem em "SST + COMPRAS". */
export const etapaCandidato = (e: string | null | undefined): string => {
  const s = String(e ?? "").trim();
  if (s === "EXAME SST" || s === "COMPRAS") return "SST + COMPRAS";
  return s || "ENTRADA";
};
const ordemEtapa = (e: string | null | undefined) => {
  const i = ETAPAS_CANDIDATO.indexOf(etapaCandidato(e));
  return i < 0 ? -1 : i;
};
export const candidatoAtivo = (c: Pick<CandidatoDash, "etapa" | "desistiu">) =>
  !c.desistiu && etapaCandidato(c.etapa) !== "Reprovado";

export interface CandidatoDaVaga { nome: string; etapa: string; total: number }

/** Por vaga: o candidato ativo mais adiantado no kanban, e quantos ativos há. */
export function candidatosPorVaga(candidatos: CandidatoDash[]): Map<number, CandidatoDaVaga> {
  const m = new Map<number, CandidatoDaVaga & { ordem: number }>();
  for (const c of candidatos) {
    if (c.vaga_id == null || !candidatoAtivo(c)) continue;
    const o = ordemEtapa(c.etapa);
    const atual = m.get(c.vaga_id);
    if (!atual) { m.set(c.vaga_id, { nome: c.nome ?? "—", etapa: etapaCandidato(c.etapa), total: 1, ordem: o }); continue; }
    atual.total += 1;
    if (o > atual.ordem) { atual.nome = c.nome ?? "—"; atual.etapa = etapaCandidato(c.etapa); atual.ordem = o; }
  }
  return new Map([...m].map(([id, { nome, etapa, total }]) => [id, { nome, etapa, total }]));
}

// ── Filtros ──────────────────────────────────────────────────────────────

export interface FiltrosDash {
  contratos: string[];
  cidade: string;
  cargo: string;
  urgencia: "" | Urgencia;
  motivo: string;
}
export const FILTROS_VAZIOS: FiltrosDash = { contratos: [], cidade: "", cargo: "", urgencia: "", motivo: "" };

const txt = (s: string | null | undefined) => String(s ?? "").trim();
export const rotuloContrato = (v: Pick<VagaDash, "contrato">) => txt(v.contrato) || "Sem contrato";
export const rotuloCidade = (v: Pick<VagaDash, "cidade">) => txt(v.cidade).toUpperCase() || "Sem cidade";
export const rotuloCargo = (v: Pick<VagaDash, "cargo">) => txt(v.cargo).toUpperCase() || "Sem cargo";
export const rotuloMotivo = (v: Pick<VagaDash, "motivo">) => txt(v.motivo) || "Não informado";

export function filtrar(vagas: VagaDash[], f: FiltrosDash): VagaDash[] {
  return vagas.filter((v) =>
    (f.contratos.length === 0 || f.contratos.includes(txt(v.contrato)))
    && (!f.cidade || rotuloCidade(v) === f.cidade)
    && (!f.cargo || rotuloCargo(v) === f.cargo)
    && (!f.urgencia || urgencia(v.urgencia) === f.urgencia)
    && (!f.motivo || rotuloMotivo(v) === f.motivo));
}

// ── Período ──────────────────────────────────────────────────────────────

export type Periodo = "mes" | "30" | "90" | "ano" | "tudo" | "personalizado";
export const ROTULO_PERIODO: Record<Periodo, string> = {
  mes: "Este mês", "30": "Últimos 30 dias", "90": "Últimos 90 dias", ano: "Este ano", tudo: "Todo o histórico", personalizado: "Personalizado",
};

/** [início, fim] inclusivos em "YYYY-MM-DD"; null = sem limite. */
export function intervalo(p: Periodo, hoje = hojeSP(), de = "", ate = ""): [string | null, string | null] {
  if (p === "mes") return [`${hoje.slice(0, 7)}-01`, hoje];
  if (p === "30") return [somarDias(hoje, -29), hoje];
  if (p === "90") return [somarDias(hoje, -89), hoje];
  if (p === "ano") return [`${hoje.slice(0, 4)}-01-01`, hoje];
  if (p === "personalizado") return [de || null, ate || null];
  return [null, null];
}

export const noIntervalo = (ts: string | null | undefined, [ini, fim]: [string | null, string | null]) => {
  const d = dia(ts);
  if (!d) return false;
  return (!ini || d >= ini) && (!fim || d <= fim);
};

// ── Estatística ──────────────────────────────────────────────────────────

export function mediana(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// ── SITUAÇÃO AGORA ───────────────────────────────────────────────────────

export interface LinhaAberta extends VagaDash {
  prazo: Prazo;
  faltam: number | null;
  situacao: SituacaoPrazo;
  andamento: Andamento;
  fase: number;
  abertaHa: number;
  candidato: CandidatoDaVaga | null;
}

/** As vagas em aberto, prontas para a tabela: mais atrasada primeiro, sem data no fim. */
export function vagasAbertas(vagas: VagaDash[], candidatos: CandidatoDash[], hoje = hojeSP()): LinhaAberta[] {
  const porVaga = candidatosPorVaga(candidatos);
  return vagas
    .filter((v) => desfecho(v.status) === "aberta")
    .map((v) => {
      const prazo = prazoDaVaga(v);
      const faltam = prazo.data ? diasEntre(hoje, prazo.data) : null;
      return {
        ...v, prazo, faltam,
        situacao: situacaoPrazo(v, hoje),
        andamento: andamento(v.status),
        fase: faseDaVaga(v.status),
        abertaHa: Math.max(0, diasEntre(dia(v.criada) ?? hoje, hoje)),
        candidato: porVaga.get(v.id) ?? null,
      };
    })
    .sort((a, b) => (a.faltam ?? Infinity) - (b.faltam ?? Infinity) || a.id - b.id);
}

export interface IndicadoresAgora {
  solicitacoes: number;
  posicoes: number;
  aprovacao: number;
  conferencia: number;
  selecao: number;
  porPrazo: Record<SituacaoPrazo, number>;
  urgentesAtrasadas: number;
  candidatosAtivos: number;
  semCandidato: number;
  idadeMediana: number | null;
}

export function indicadoresAgora(abertas: LinhaAberta[]): IndicadoresAgora {
  const porPrazo: Record<SituacaoPrazo, number> = { atrasada: 0, atencao: 0, no_prazo: 0, sem_data: 0 };
  let aprovacao = 0, conferencia = 0, selecao = 0, posicoes = 0, urgentesAtrasadas = 0, candidatosAtivos = 0, semCandidato = 0;
  for (const v of abertas) {
    porPrazo[v.situacao] += 1;
    posicoes += v.qtd;
    if (v.andamento === "Aguardando aprovação") aprovacao += 1;
    else if (v.andamento === "Conferência do Recrutamento") conferencia += 1;
    else selecao += 1;
    if (v.situacao === "atrasada" && urgencia(v.urgencia) === "Alta") urgentesAtrasadas += 1;
    candidatosAtivos += v.candidato?.total ?? 0;
    if (v.andamento === "Em seleção" && !v.candidato) semCandidato += 1;
  }
  return {
    solicitacoes: abertas.length, posicoes, aprovacao, conferencia, selecao, porPrazo, urgentesAtrasadas,
    candidatosAtivos, semCandidato, idadeMediana: mediana(abertas.map((v) => v.abertaHa)),
  };
}

/** Quantas vagas em aberto em cada fase do fluxo (o funil de agora). */
export function funilAberto(abertas: LinhaAberta[]) {
  return FASES_ABERTAS.map((p, i) => ({ nome: p.titulo, quem: p.quem, qtd: abertas.filter((v) => v.fase === i).length }));
}

/** Contratos com mais vagas em aberto, empilhado pela situação do prazo. */
export function prazoPorContrato(abertas: LinhaAberta[], n = 10) {
  const m = new Map<string, Record<SituacaoPrazo, number> & { total: number }>();
  for (const v of abertas) {
    const k = rotuloContrato(v);
    const r = m.get(k) ?? { atrasada: 0, atencao: 0, no_prazo: 0, sem_data: 0, total: 0 };
    r[v.situacao] += 1; r.total += 1;
    m.set(k, r);
  }
  return [...m.entries()].map(([nome, r]) => ({ nome, ...r }))
    .sort((a, b) => b.total - a.total || b.atrasada - a.atrasada || a.nome.localeCompare(b.nome))
    .slice(0, n);
}

/** Há quanto tempo as vagas em aberto foram pedidas. */
export const FAIXAS_IDADE = [
  { rotulo: "até 7 dias", max: 7 }, { rotulo: "8 a 15", max: 15 }, { rotulo: "16 a 30", max: 30 },
  { rotulo: "31 a 60", max: 60 }, { rotulo: "mais de 60", max: Infinity },
];
export function idadeDasAbertas(abertas: LinhaAberta[]) {
  return FAIXAS_IDADE.map((f, i) => {
    const min = i === 0 ? 0 : FAIXAS_IDADE[i - 1].max + 1;
    return { nome: f.rotulo, qtd: abertas.filter((v) => v.abertaHa >= min && v.abertaHa <= f.max).length };
  });
}

/** Ranking genérico (top N + "Outros (k)"), em solicitações. */
export function ranking<T>(lista: T[], chave: (x: T) => string, n = 10): { nome: string; qtd: number }[] {
  const m = new Map<string, number>();
  for (const x of lista) { const k = chave(x); m.set(k, (m.get(k) ?? 0) + 1); }
  const ord = [...m.entries()].map(([nome, qtd]) => ({ nome, qtd })).sort((a, b) => b.qtd - a.qtd || a.nome.localeCompare(b.nome));
  if (ord.length <= n) return ord;
  const resto = ord.slice(n);
  return [...ord.slice(0, n), { nome: `Outros (${resto.length})`, qtd: resto.reduce((s, x) => s + x.qtd, 0) }];
}

// ── DESEMPENHO NO PERÍODO ────────────────────────────────────────────────

export interface IndicadoresPeriodo {
  solicitadas: number;
  posicoesSolicitadas: number;
  contratadas: number;
  reprovadas: number;
  canceladas: number;
  /** reprovadas ÷ (contratadas + reprovadas) — das que se decidiram no período. */
  taxaReprovacao: number | null;
  /** criação → contratação (dias), das contratadas no período. */
  diasContratar: { mediana: number | null; media: number | null; n: number };
  /** criação → primeira aprovação (dias), das aprovadas no período. */
  diasAprovar: { mediana: number | null; n: number };
  /** aprovação → "Abertura de vaga confirmada" (dias). */
  diasAbrir: { mediana: number | null; n: number };
  /**
   * Contratadas com início ≤ prazo ÷ contratadas com as duas datas, e o
   * atraso médio (início − prazo, em dias; negativo = adiantou). "Imediato"
   * fica de fora: vence no dia do pedido e nunca daria "no prazo".
   */
  noPrazo: { taxa: number | null; n: number; atrasoMedio: number | null };
}

export function indicadoresPeriodo(vagas: VagaDash[], faixa: [string | null, string | null]): IndicadoresPeriodo {
  const solicitadasL = vagas.filter((v) => noIntervalo(v.criada, faixa));
  const fechadas = vagas.filter((v) => desfecho(v.status) !== "aberta" && noIntervalo(v.mudou ?? v.criada, faixa));
  const contratadasL = fechadas.filter((v) => desfecho(v.status) === "contratada");
  const reprovadas = fechadas.filter((v) => desfecho(v.status) === "reprovada").length;
  const canceladas = fechadas.filter((v) => desfecho(v.status) === "cancelada").length;

  const tContratar = contratadasL.map((v) => diasCorridos(v.criada, v.mudou)).filter((x): x is number => x != null);
  const aprovadas = vagas.filter((v) => v.aprovada_em && noIntervalo(v.aprovada_em, faixa));
  const tAprovar = aprovadas.map((v) => diasCorridos(v.criada, v.aprovada_em)).filter((x): x is number => x != null);
  const abertas = vagas.filter((v) => v.aberta_em && noIntervalo(v.aberta_em, faixa));
  const tAbrir = abertas.map((v) => diasCorridos(v.aprovada_em ?? v.criada, v.aberta_em)).filter((x): x is number => x != null);

  let dentro = 0, comDatas = 0;
  const atrasos: number[] = [];
  for (const v of contratadasL) {
    const p = prazoDaVaga(v);
    const ini = String(v.contratado_inicio ?? "").match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (!p.data || p.imediato || !ini) continue;
    comDatas += 1;
    if (ini <= p.data) dentro += 1;
    atrasos.push(diasEntre(p.data, ini));
  }
  const decididas = contratadasL.length + reprovadas;
  return {
    solicitadas: solicitadasL.length,
    posicoesSolicitadas: solicitadasL.reduce((s, v) => s + v.qtd, 0),
    contratadas: contratadasL.length,
    reprovadas, canceladas,
    taxaReprovacao: decididas ? reprovadas / decididas : null,
    diasContratar: { mediana: mediana(tContratar), media: media(tContratar), n: tContratar.length },
    diasAprovar: { mediana: mediana(tAprovar), n: tAprovar.length },
    diasAbrir: { mediana: mediana(tAbrir), n: tAbrir.length },
    noPrazo: { taxa: comDatas ? dentro / comDatas : null, n: comDatas, atrasoMedio: media(atrasos) },
  };
}

/** Meses ("YYYY-MM") do intervalo; sem início, os últimos 12 até o fim. */
export function mesesDoIntervalo([ini, fim]: [string | null, string | null], hoje = hojeSP()): string[] {
  const ate = (fim ?? hoje).slice(0, 7);
  let de = ini ? ini.slice(0, 7) : null;
  if (!de) { const [y, m] = ate.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 - 11, 1)); de = d.toISOString().slice(0, 7); }
  const out: string[] = [];
  let [y, m] = de.split("-").map(Number);
  while (`${y}-${String(m).padStart(2, "0")}` <= ate && out.length < 60) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** Por mês: solicitadas (criação) e contratadas (conclusão). */
export function porMes(vagas: VagaDash[], meses: string[]) {
  return meses.map((ym) => ({
    mes: ym,
    rotulo: rotuloMes(ym),
    solicitadas: vagas.filter((v) => v.criada?.slice(0, 7) === ym).length,
    contratadas: vagas.filter((v) => desfecho(v.status) === "contratada" && (v.mudou ?? "").slice(0, 7) === ym).length,
  }));
}

/** Distribuição do tempo até contratar, das contratadas no período. */
export const FAIXAS_CONTRATAR = [
  { rotulo: "até 7 dias", max: 7 }, { rotulo: "8 a 15", max: 15 }, { rotulo: "16 a 30", max: 30 },
  { rotulo: "31 a 45", max: 45 }, { rotulo: "46 a 60", max: 60 }, { rotulo: "mais de 60", max: Infinity },
];
export function tempoAteContratar(vagas: VagaDash[], faixa: [string | null, string | null]) {
  const dias = vagas
    .filter((v) => desfecho(v.status) === "contratada" && noIntervalo(v.mudou ?? v.criada, faixa))
    .map((v) => diasCorridos(v.criada, v.mudou))
    .filter((x): x is number => x != null);
  return FAIXAS_CONTRATAR.map((f, i) => {
    const min = i === 0 ? -Infinity : FAIXAS_CONTRATAR[i - 1].max;
    return { nome: f.rotulo, qtd: dias.filter((d) => d > min && d <= f.max).length };
  });
}

/**
 * Candidatos: funil por etapa + números do período. "Ativos" = no processo
 * de uma vaga EM ABERTO (quem ficou em ENTRADA numa vaga já preenchida não
 * está mais em processo nenhum — contar esses inflava o funil).
 * `admitido_em` vem da RPC como admitido_em ?? enviado_admissao_em.
 */
export function indicadoresCandidatos(candidatos: CandidatoDash[], faixa: [string | null, string | null], vagasAbertas?: Set<number>) {
  const ativos = candidatos.filter((c) => candidatoAtivo(c) && (!vagasAbertas || (c.vaga_id != null && vagasAbertas.has(c.vaga_id))));
  const funil = ETAPAS_CANDIDATO.map((e) => ({ nome: e, qtd: ativos.filter((c) => etapaCandidato(c.etapa) === e).length }));
  const noPeriodo = candidatos.filter((c) => noIntervalo(c.criado, faixa));
  return {
    funil,
    ativos: ativos.length,
    candidaturas: noPeriodo.length,
    paraVaga: noPeriodo.filter((c) => c.tipo === "vaga").length,
    bancoTalentos: noPeriodo.filter((c) => c.tipo !== "vaga").length,
    admitidos: candidatos.filter((c) => noIntervalo(c.admitido_em, faixa)).length,
    reprovados: noPeriodo.filter((c) => etapaCandidato(c.etapa) === "Reprovado").length,
    desistencias: noPeriodo.filter((c) => c.desistiu).length,
  };
}
