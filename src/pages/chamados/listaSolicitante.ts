// =====================================================================
// CHAMADOS — o que aparece na lista PADRÃO de "Meus chamados" (13/11/2026)
//
// Pedido de um solicitante: concluídos e avaliados continuavam na lista,
// escondiam o que estava pendente e levavam a abrir chamado em duplicidade.
// O Pablo definiu a regra:
//   · por padrão só aparece o que tem PENDÊNCIA — chamado ainda na fila
//     (chamadoAtivo) ou concluído que ainda espera o solicitante confirmar ou
//     avaliar; o resto (concluído e avaliado, reprovado, cancelado) vai para o
//     Histórico, que abre em "Mostrar chamados já concluídos";
//   · encerrado com mensagem nova não lida VOLTA para a lista;
//   · sai de novo quando o solicitante lê a mensagem (abre o chat) ou clica em
//     "Marcar como visto" — a não ser que ele mesmo responda: aí fica, até
//     alguém responder e ele ler, ou até ele marcar como visto.
// O estado da conversa vem de chamados_meus_conversa() (mig 20261115000900),
// numa consulta só para a lista inteira.
// =====================================================================
import { chamadoAtivo, type Chamado } from "./types";

/** Linha de chamados_meus_conversa(). */
export interface ConversaSolicitante {
  ultima_minha_em: string | null;
  ultima_outros_em: string | null;
  visto_em: string | null;
}

const ms = (s: string | null | undefined) => (s ? new Date(s).getTime() : NaN);

/**
 * O chamado ainda depende de alguém? Fila (chamadoAtivo), pendência do
 * solicitante que o banco já calcula (chamados_meus_avaliacoes_pendentes:
 * confirmar ou avaliar — tem o corte de data dos chamados antigos) ou
 * concluído ainda na validação da Presidência (confirmar/avaliar vem depois).
 */
export function chamadoComPendencia(
  c: Pick<Chamado, "status">,
  pendenciaSolicitante: boolean,
  emValidacaoPresidencia = false,
): boolean {
  return chamadoAtivo(c.status) || pendenciaSolicitante || (c.status === "concluido" && emValidacaoPresidencia);
}

/**
 * A última mensagem da conversa é do solicitante e veio depois do "visto"?
 * Ele respondeu e espera retorno — o chamado continua na lista.
 */
export function respondeuDepoisDoVisto(conv: ConversaSolicitante | null | undefined): boolean {
  if (!conv) return false;
  const minha = ms(conv.ultima_minha_em);
  if (Number.isNaN(minha)) return false;
  const outros = ms(conv.ultima_outros_em);
  if (!Number.isNaN(outros) && outros >= minha) return false;
  const visto = ms(conv.visto_em);
  return Number.isNaN(visto) || minha > visto;
}

export type MotivoNaLista = "pendencia" | "mensagem_nova" | "respondeu" | null;

/** Por que o chamado está na lista padrão (null = vai só para o Histórico). */
export function motivoNaListaPadrao(args: {
  pendente: boolean;
  naoLidos: number;
  conversa?: ConversaSolicitante | null;
}): MotivoNaLista {
  if (args.pendente) return "pendencia";
  if ((args.naoLidos ?? 0) > 0) return "mensagem_nova";
  if (respondeuDepoisDoVisto(args.conversa)) return "respondeu";
  return null;
}

export const apareceNaListaPadrao = (args: Parameters<typeof motivoNaListaPadrao>[0]) =>
  motivoNaListaPadrao(args) !== null;

// ---- Filtros do topo --------------------------------------------------

export interface FiltrosMeusChamados {
  busca: string;
  status: string;          // "" = todos
  responsavel: string;     // "" = todos · "sem" = sem responsável
  modulo: string;          // "" = todos (rótulo de moduloLabel)
  prioridade: string;      // "" = todas
  campoData: "abertura" | "conclusao";
  de: string;              // yyyy-mm-dd ou ""
  ate: string;             // yyyy-mm-dd ou ""
}

export const FILTROS_VAZIOS: FiltrosMeusChamados = {
  busca: "", status: "", responsavel: "", modulo: "", prioridade: "", campoData: "abertura", de: "", ate: "",
};

export const filtrosAtivos = (f: FiltrosMeusChamados) =>
  !!(f.busca.trim() || f.status || f.responsavel || f.modulo || f.prioridade || f.de || f.ate);

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Data local (yyyy-mm-dd) de um timestamp, para comparar com o input type=date. */
const diaLocal = (s: string) => {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function passaNosFiltros(
  c: Pick<Chamado, "numero" | "assunto" | "status" | "responsavel_id" | "prioridade" | "created_at" | "concluido_em">,
  modulo: string,
  f: FiltrosMeusChamados,
): boolean {
  const busca = semAcento(f.busca.trim().replace(/^#/, ""));
  if (busca && !semAcento(`${c.numero} ${c.assunto}`).includes(busca)) return false;
  if (f.status && c.status !== f.status) return false;
  if (f.responsavel === "sem" ? !!c.responsavel_id : f.responsavel && c.responsavel_id !== f.responsavel) return false;
  if (f.modulo && modulo !== f.modulo) return false;
  if (f.prioridade && c.prioridade !== f.prioridade) return false;
  if (f.de || f.ate) {
    const base = f.campoData === "conclusao" ? c.concluido_em : c.created_at;
    if (!base) return false;
    const dia = diaLocal(base);
    if (f.de && dia < f.de) return false;
    if (f.ate && dia > f.ate) return false;
  }
  return true;
}

// ---- Painel do solicitante -------------------------------------------

export interface LinhaDev {
  responsavel_id: string;
  quantidade: number;
  concluidos: number;
  prazo_medio: number | null;   // dias corridos, abertura → conclusão
  nota_media: number | null;    // 0..5, média das MINHAS avaliações
}

const dias = (de: string, ate: string) => (ms(ate) - ms(de)) / 86400000;
const media = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/**
 * Quem atendeu mais os chamados do solicitante. Prazo médio = mesma conta de
 * chamados_meus_stats (dias corridos entre abertura e conclusão).
 */
export function rankingDevs(
  chamados: Pick<Chamado, "id" | "responsavel_id" | "status" | "created_at" | "concluido_em">[],
  notaPorChamado: Record<string, number>,
): LinhaDev[] {
  const por = new Map<string, { q: number; c: number; prazos: number[]; notas: number[] }>();
  for (const ch of chamados) {
    if (!ch.responsavel_id) continue;
    const g = por.get(ch.responsavel_id) ?? { q: 0, c: 0, prazos: [], notas: [] };
    g.q += 1;
    if (ch.status === "concluido") g.c += 1;
    if (ch.concluido_em) g.prazos.push(dias(ch.created_at, ch.concluido_em));
    if (notaPorChamado[ch.id] != null) g.notas.push(notaPorChamado[ch.id]);
    por.set(ch.responsavel_id, g);
  }
  return [...por.entries()]
    .map(([responsavel_id, g]) => ({
      responsavel_id,
      quantidade: g.q,
      concluidos: g.c,
      prazo_medio: media(g.prazos),
      nota_media: media(g.notas),
    }))
    .sort((a, b) => b.quantidade - a.quantidade || b.concluidos - a.concluidos);
}

export { media as mediaSimples };
