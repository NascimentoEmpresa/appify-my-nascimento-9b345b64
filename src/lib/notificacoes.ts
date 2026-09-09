// Notificações com ciência — as regras que as telas compartilham.
//
// Novidade é changelog: a pessoa lê se quiser. Notificação é o contrário —
// aparece no CENTRO da tela e só sai depois de CONCORDO ou DISCORDO.
//
// A escolha não muda nada no sistema, de propósito. O que se registra é que a
// pessoa VIU e RESPONDEU; qual botão ela apertou fica no histórico, porque
// "todo mundo leu, e três discordaram" é uma informação diferente de "todo
// mundo leu".
//
// Quem publica é o MESMO de Novidades (`novidades_publicar`): foi o pedido —
// quem cria novidade ganha Notificações ao lado. Nada de menu de permissão
// novo (ver o README sobre não criar tela de permissão à parte).

export const TABELA = "SISTEMA_NOTIFICACOES";
export const TABELA_CIENCIA = "SISTEMA_NOTIFICACAO_CIENCIA";
export const MENU_PUBLICAR = "novidades_publicar";

export const ESCOLHAS = ["CONCORDO", "DISCORDO"] as const;
export type Escolha = (typeof ESCOLHAS)[number];

export interface Notificacao {
  id: number;
  titulo: string;
  mensagem: string;
  publicado: boolean;
  publicado_em: string;
  criado_por_nome: string | null;
  created_at: string;
}

export interface CienciaNotificacao {
  notificacao_id: number;
  user_id: string;
  escolha: Escolha;
  respondido_em: string;
}

export interface FormNotificacao {
  id?: number;
  titulo: string;
  mensagem: string;
  publicado: boolean;
}

/** O mínimo para a notificação valer alguma coisa na tela. */
export function erroDoFormulario(f: FormNotificacao): string | null {
  if (!f.titulo.trim()) return "Escreva um título.";
  if (f.mensagem.trim().length < 10) return "Escreva a mensagem (mín. 10 caracteres).";
  return null;
}

/**
 * As que esta pessoa ainda não respondeu.
 *
 * Só publicadas: rascunho aparece para quem publica na lista de gestão, mas
 * travar a tela de todo mundo com um rascunho seria o pior tipo de acidente.
 */
export function pendentesDe(
  notificacoes: Notificacao[],
  minhas: CienciaNotificacao[],
): Notificacao[] {
  const respondidas = new Set(minhas.map((c) => c.notificacao_id));
  return notificacoes.filter((n) => n.publicado && !respondidas.has(n.id));
}

/** "12 de 30 responderam · 3 discordaram" — o histórico em uma linha. */
export function resumoDasRespostas(ciencias: CienciaNotificacao[]): string {
  if (!ciencias.length) return "Ninguém respondeu ainda.";
  const discordaram = ciencias.filter((c) => c.escolha === "DISCORDO").length;
  const plural = ciencias.length === 1 ? "pessoa respondeu" : "pessoas responderam";
  if (!discordaram) return `${ciencias.length} ${plural}.`;
  return `${ciencias.length} ${plural} · ${discordaram} discordou${discordaram > 1 ? "ram" : ""}.`;
}

export const fmtDataHora = (iso?: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};
