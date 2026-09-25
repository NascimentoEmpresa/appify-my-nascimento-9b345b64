// Dúvidas jurídicas (Parecer Jurídico / Orientações Jurídicas): o que as duas
// telas compartilham — tipos, a avaliação da resposta e o fio de
// complementos (17/09/2026, mig 20260930000170).
//
// Fica fora das telas porque Central de Serviços › Orientações Jurídicas (quem
// pergunta) e Jurídico › Parecer Jurídico (quem responde) mostram o MESMO fio;
// duas cópias divergiriam na primeira correção.

export interface Duvida {
  id: number; created_at?: string; autor_id?: string; autor_nome?: string;
  titulo: string; pergunta: string; categoria?: string; status: string;
  resposta?: string; respondido_por?: string; respondido_em?: string;
  aprovado_por?: string; aprovado_em?: string; motivo_reprovacao?: string;
  /** Avaliação de quem perguntou (só depois de respondida; RPC jur_duvida_avaliar). */
  avaliacao?: Avaliacao | null; avaliacao_comentario?: string | null; avaliado_em?: string | null;
  /**
   * Mig 244 (25/09/2026): de onde veio (a do encarregado passa pelo
   * Operacional), quem respondeu, a decisão do Operacional e se está
   * OCULTA (publicada = false: fora da biblioteca, só os responsáveis veem).
   */
  origem?: "encarregados" | "central" | null;
  respondido_etapa?: "juridico" | "operacional" | null;
  operacional_por?: string | null; operacional_em?: string | null;
  operacional_acao?: "respondeu" | "encaminhou" | null; operacional_obs?: string | null;
  publicada?: boolean | null; ocultada_por?: string | null; ocultada_em?: string | null;
}

/** Status novo (mig 244): a pergunta do encarregado esperando o Operacional. */
export const STATUS_PENDENTE_OPERACIONAL = "Pendente Operacional";
export const estaOculta = (d: Pick<Duvida, "publicada">): boolean => d.publicada === false;
/** Resposta dada pelo Operacional (não é parecer do Jurídico). */
export const respondidaPeloOperacional = (d: Pick<Duvida, "respondido_etapa">): boolean => d.respondido_etapa === "operacional";

/** Um item do fio que continua depois da resposta principal. */
export interface Complemento {
  id: number; duvida_id: number; tipo: "pergunta" | "resposta";
  texto: string; autor_id?: string | null; autor_nome?: string | null; created_at?: string;
}

export const CATEGORIAS_DUVIDA = ["Trabalhista", "Contratos", "Processos", "Tributário", "Cível", "Administrativo", "Compliance", "LGPD", "Outros"];

// ── Avaliação ──────────────────────────────────────────────────────────
export type Avaliacao = "resolveu" | "parcial" | "nao_resolveu";
export const AVALIACOES: { valor: Avaliacao; rotulo: string; emoji: string; cor: string; bg: string }[] = [
  { valor: "resolveu",     rotulo: "Resolveu minha dúvida", emoji: "👍", cor: "#15803d", bg: "#dcfce7" },
  { valor: "parcial",      rotulo: "Resolveu em parte",     emoji: "🤔", cor: "#b45309", bg: "#fef3c7" },
  { valor: "nao_resolveu", rotulo: "Não resolveu",          emoji: "👎", cor: "#b91c1c", bg: "#fee2e2" },
];
export const infoAvaliacao = (a?: Avaliacao | null) => AVALIACOES.find(x => x.valor === a) ?? null;

// ── Fio de complementos ────────────────────────────────────────────────
/** O último item é uma pergunta: o Jurídico ainda deve um complemento. */
export const complementoPendente = (fio: Complemento[]): boolean =>
  fio.length > 0 && fio[fio.length - 1].tipo === "pergunta";

/** Agrupa os complementos por dúvida, já na ordem do fio (id crescente). */
export function agruparComplementos(itens: Complemento[]): Map<number, Complemento[]> {
  const m = new Map<number, Complemento[]>();
  for (const c of [...itens].sort((a, b) => a.id - b.id)) {
    if (!m.has(c.duvida_id)) m.set(c.duvida_id, []);
    m.get(c.duvida_id)!.push(c);
  }
  return m;
}

/** Quem pode perguntar mais: o autor, depois de respondida. */
export const podeComplementar = (d: Pick<Duvida, "autor_id" | "status">, userId?: string | null): boolean =>
  !!userId && d.autor_id === userId && d.status === "Respondida";

/** Quem pode avaliar: o autor, depois de respondida (pode trocar a avaliação depois). */
export const podeAvaliar = podeComplementar;

export const COMPLEMENTO_MIN = 5;

// ── Biblioteca, avaliação obrigatória e dashboard (17/09/2026, mig 176) ──

/** O que entra na biblioteca pública: respondida e NÃO avaliada como "Não resolveu". */
export const entraNaBiblioteca = (d: Pick<Duvida, "status" | "avaliacao" | "publicada">): boolean =>
  // Oculta (mig 244) não entra — e a resposta do Operacional já nasce oculta.
  d.status === "Respondida" && d.avaliacao !== "nao_resolveu" && d.publicada !== false;

/** As respondidas do autor que ele ainda não avaliou — travam a pergunta nova. */
export const pendentesDeAvaliacao = <T extends Pick<Duvida, "autor_id" | "status" | "avaliacao">>(duvidas: T[], userId?: string | null): T[] =>
  !userId ? [] : duvidas.filter(d => d.autor_id === userId && d.status === "Respondida" && !d.avaliacao);

/**
 * Perguntar de novo exige ter avaliado o que já foi respondido. Perguntar
 * MAIS dentro de uma dúvida (fio) não passa por aqui — ver podeComplementar.
 */
export const podePerguntarNova = (duvidas: Pick<Duvida, "autor_id" | "status" | "avaliacao">[], userId?: string | null): boolean =>
  pendentesDeAvaliacao(duvidas, userId).length === 0;

export interface LinhaCategoria {
  categoria: string; total: number; respondidas: number;
  resolveu: number; parcial: number; nao_resolveu: number; sem_avaliacao: number;
  /** % de "Resolveu" entre as avaliadas (0–100), ou null sem avaliação. */
  satisfacao: number | null;
}

/** Dias corridos entre a pergunta e a resposta (null se faltar uma data). */
export const diasParaResponder = (d: Pick<Duvida, "created_at" | "respondido_em">): number | null => {
  if (!d.created_at || !d.respondido_em) return null;
  const a = new Date(d.created_at).getTime(), b = new Date(d.respondido_em).getTime();
  if (isNaN(a) || isNaN(b) || b < a) return null;
  return Math.round(((b - a) / 86_400_000) * 10) / 10;
};

/** Os números do dashboard de Parecer Jurídico. */
export function resumoDashboard(duvidas: Duvida[]) {
  const respondidas = duvidas.filter(d => d.status === "Respondida");
  const avaliadas = respondidas.filter(d => !!d.avaliacao);
  const conta = (a: Avaliacao) => avaliadas.filter(d => d.avaliacao === a).length;
  const porCategoria = new Map<string, LinhaCategoria>();
  for (const d of duvidas) {
    const c = d.categoria || "Sem categoria";
    const l = porCategoria.get(c) ?? { categoria: c, total: 0, respondidas: 0, resolveu: 0, parcial: 0, nao_resolveu: 0, sem_avaliacao: 0, satisfacao: null };
    l.total++;
    if (d.status === "Respondida") {
      l.respondidas++;
      if (d.avaliacao === "resolveu") l.resolveu++;
      else if (d.avaliacao === "parcial") l.parcial++;
      else if (d.avaliacao === "nao_resolveu") l.nao_resolveu++;
      else l.sem_avaliacao++;
    }
    porCategoria.set(c, l);
  }
  for (const l of porCategoria.values()) {
    const n = l.resolveu + l.parcial + l.nao_resolveu;
    l.satisfacao = n ? Math.round((l.resolveu / n) * 100) : null;
  }
  const tempos = respondidas.map(diasParaResponder).filter((x): x is number => x != null);
  const tempoMedio = tempos.length ? Math.round((tempos.reduce((s, x) => s + x, 0) / tempos.length) * 10) / 10 : null;
  const porStatus = ["Aberta", "Aprovada", "Respondida", "Reprovada"].map(s => ({ status: s, n: duvidas.filter(d => d.status === s).length }));
  return {
    total: duvidas.length,
    respondidas: respondidas.length,
    avaliadas: avaliadas.length,
    resolveu: conta("resolveu"), parcial: conta("parcial"), nao_resolveu: conta("nao_resolveu"),
    semAvaliacao: respondidas.length - avaliadas.length,
    satisfacao: avaliadas.length ? Math.round((conta("resolveu") / avaliadas.length) * 100) : null,
    tempoMedioDias: tempoMedio,
    porCategoria: [...porCategoria.values()].sort((a, b) => b.total - a.total),
    porStatus,
    naoResolvidas: respondidas.filter(d => d.avaliacao === "nao_resolveu"),
  };
}
