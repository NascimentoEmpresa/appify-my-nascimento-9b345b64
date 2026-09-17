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
}

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
