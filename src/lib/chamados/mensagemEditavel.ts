// =====================================================================
// Chat do chamado — editar e apagar a própria mensagem (13/11/2026)
//
// Espelho da regra da mig 20261115000600 (chamado_mensagem_checar_autor):
// quem manda é o banco; aqui é só para a tela decidir se mostra os botões e
// como escrever o balão. Se a tela liberar mais que o banco, o botão aparece e
// a RPC devolve erro — por isso as duas regras andam juntas.
//
//   · só o AUTOR mexe (a gestão não edita nem apaga mensagem dos outros);
//   · só mensagem de gente: comentario / observacao_interna, sem meta.canal
//     nem meta.origem (o resumo da I.A no merge é comentario com o autor do
//     dev — não pode virar editável);
//   · apagada não volta nem é editada;
//   · conversa fechada (reprovado/cancelado) só deixa mexer na interna.
// =====================================================================

export interface MensagemChat {
  autor_id: string | null;
  tipo: string;
  meta?: Record<string, unknown> | null;
  apagado_em?: string | null;
}

const TIPOS_DE_GENTE = new Set(["comentario", "observacao_interna"]);
const STATUS_CONVERSA_FECHADA = new Set(["reprovado", "cancelado"]);

export function ehMensagemDeGente(m: Pick<MensagemChat, "tipo" | "meta">): boolean {
  const meta = (m.meta ?? {}) as Record<string, unknown>;
  return TIPOS_DE_GENTE.has(m.tipo) && meta.canal == null && meta.origem == null;
}

export function podeAlterarMensagem(
  m: MensagemChat,
  usuarioId: string | null | undefined,
  statusChamado?: string | null,
): boolean {
  if (!usuarioId || m.autor_id !== usuarioId) return false;
  if (m.apagado_em) return false;
  if (!ehMensagemDeGente(m)) return false;
  if (statusChamado && STATUS_CONVERSA_FECHADA.has(statusChamado) && m.tipo !== "observacao_interna") return false;
  return true;
}

/** Editar e apagar seguem a mesma regra no banco. */
export const podeEditarMensagem = podeAlterarMensagem;
export const podeApagarMensagem = podeAlterarMensagem;

const fmt = (s: string) => {
  const d = new Date(s);
  return isNaN(+d)
    ? ""
    : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** "Mensagem apagada por Pablo em 13/11/2026, 14:10" — o que fica no lugar do balão. */
export function rotuloMensagemApagada(nome: string, apagadoEm: string): string {
  const quando = fmt(apagadoEm);
  return `Mensagem apagada por ${nome || "Usuário"}${quando ? ` em ${quando}` : ""}`;
}

/** Selo ao lado da hora. */
export function rotuloEditada(editadoEm: string | null | undefined): string | null {
  return editadoEm ? "(editada)" : null;
}

/** Título do selo: quando foi a última edição. */
export function dicaEditada(editadoEm: string): string {
  const quando = fmt(editadoEm);
  return `Editada${quando ? ` em ${quando}` : ""} — clique para ver o original`;
}

/** Texto que os relatórios (PDF, feed) mostram no lugar do conteúdo. */
export function textoParaRelatorio(
  m: { texto: string | null; apagado_em?: string | null; editado_em?: string | null; apagado_por?: string | null },
  nomeDe: (uid: string | null) => string,
): string | null {
  if (m.apagado_em) return rotuloMensagemApagada(nomeDe(m.apagado_por ?? null), m.apagado_em);
  if (!m.texto) return m.texto;
  return m.editado_em ? `${m.texto} (editada)` : m.texto;
}
