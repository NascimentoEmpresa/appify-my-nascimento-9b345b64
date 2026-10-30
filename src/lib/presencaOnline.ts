/**
 * Quem está online — regra do painel da lateral direita (30/10/2026).
 *
 * O front manda um heartbeat (RPC presenca_registrar) a cada
 * INTERVALO_HEARTBEAT_MS enquanto a aba está aberta. O banco guarda dois
 * horários (ver 20261030003100_usuarios_online_presenca.sql):
 *   - visto_em: último heartbeat — a aba está aberta;
 *   - ativo_em: último heartbeat em que a pessoa estava usando (aba visível ou
 *     mexeu em algo há pouco).
 *
 * Status, igual à bolinha do Discord:
 *   - online  (verde):   ativo nos últimos JANELA_ONLINE_MS;
 *   - ausente (amarelo): aba aberta (visto recente), mas parada;
 *   - offline:           sem heartbeat há mais de JANELA_ONLINE_MS — some da lista.
 *
 * A janela é 3× o heartbeat: navegador joga timer de aba em segundo plano para
 * 1×/min ou mais, e um heartbeat perdido na rede não pode derrubar ninguém.
 */

export const INTERVALO_HEARTBEAT_MS = 60_000;
export const JANELA_ONLINE_MS = 3 * INTERVALO_HEARTBEAT_MS;
/** Sem mexer em nada por este tempo (com a aba visível) vira "ausente". */
export const INATIVIDADE_AUSENTE_MS = 5 * 60_000;

export type StatusPresenca = "online" | "ausente" | "offline";

export interface PresencaLinha {
  user_id: string;
  nome: string | null;
  avatar_url: string | null;
  setor: string | null;
  visto_em: string;
  ativo_em: string;
}

function ms(data: string | Date | null | undefined): number {
  if (!data) return NaN;
  return data instanceof Date ? data.getTime() : Date.parse(data);
}

/**
 * Status de uma pessoa contra o relógio `agora` — de preferência o do
 * servidor (presenca_listar devolve `agora`), não o da máquina, que pode
 * estar adiantado ou atrasado.
 */
export function statusPresenca(
  vistoEm: string | Date | null | undefined,
  ativoEm: string | Date | null | undefined,
  agora: string | Date,
): StatusPresenca {
  const t = ms(agora);
  const visto = ms(vistoEm);
  if (!Number.isFinite(visto) || t - visto > JANELA_ONLINE_MS) return "offline";
  const ativo = ms(ativoEm);
  if (Number.isFinite(ativo) && t - ativo <= JANELA_ONLINE_MS) return "online";
  return "ausente";
}

/**
 * O que o heartbeat manda em `_ativo`: aba visível E mexeu em algo há menos de
 * INATIVIDADE_AUSENTE_MS. Aba escondida conta como parada na hora.
 */
export function estaAtivo(abaVisivel: boolean, ultimaInteracao: number, agora: number): boolean {
  return abaVisivel && agora - ultimaInteracao < INATIVIDADE_AUSENTE_MS;
}

export interface PessoaPresenca extends PresencaLinha {
  status: Exclude<StatusPresenca, "offline">;
}

/**
 * Lista do painel: tira quem já está offline, online antes de ausente e,
 * dentro de cada grupo, por nome (pt-BR, sem diferenciar acento/caixa).
 */
export function montarListaPresenca(linhas: PresencaLinha[], agora: string | Date): PessoaPresenca[] {
  const ordem = { online: 0, ausente: 1 } as const;
  return linhas
    .map((l) => ({ ...l, status: statusPresenca(l.visto_em, l.ativo_em, agora) }))
    .filter((l): l is PessoaPresenca => l.status !== "offline")
    .sort(
      (a, b) =>
        ordem[a.status] - ordem[b.status] ||
        (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR", { sensitivity: "base" }),
    );
}

/** Iniciais para o avatar sem foto: "Ana Luiza Faleiro" → "AF". */
export function iniciais(nome: string | null | undefined): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primeira + ultima).toUpperCase();
}
