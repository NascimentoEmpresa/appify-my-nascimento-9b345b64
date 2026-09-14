// Um colaborador não entra duas vezes na mesma fila (14/09/2026).
//
// Quem decide é o banco: `solicitacao_em_aberto(tipo, colaborador_id)`
// (migration 20260930000104) — a mesma função que os triggers BEFORE INSERT
// de demissão, férias, mudança de função e advertência chamam. A tela só
// pergunta ANTES, na hora em que o colaborador é escolhido, para avisar
// antes de a pessoa preencher o formulário inteiro. Se a tela deixar passar,
// o trigger recusa o INSERT com a mesma mensagem.
//
// O que conta como "já tem" mora no SQL, não aqui — mudar a janela das
// férias (150 dias) ou os status que travam é mexer na função, e as telas
// seguem.

export type TipoSolicitacaoDup = "demissao" | "ferias" | "troca_funcao" | "advertencia";

export interface SolicitacaoEmAberto {
  tipo: TipoSolicitacaoDup;
  id: number;
  status: string;
  criado_em: string;
  /** Pronta para mostrar — é o mesmo texto que o trigger devolve no erro. */
  mensagem: string;
}

/** Título do card de bloqueio, por tipo. */
export const TITULO_DUPLICIDADE: Record<TipoSolicitacaoDup, string> = {
  demissao: "Já existe solicitação de demissão",
  ferias: "Já existe solicitação de férias",
  troca_funcao: "Já existe mudança de função em andamento",
  advertencia: "Já existe advertência aguardando decisão",
};

/**
 * Pergunta ao banco se este colaborador já está na fila deste tipo.
 *
 * Devolve `null` quando pode abrir — inclusive quando a RPC ainda não existe
 * no banco (schema cache sem a função): aí não há trigger também, e travar
 * a tela por causa disso seria pior do que deixar passar.
 */
export async function solicitacaoEmAberto(
  sb: any,
  tipo: TipoSolicitacaoDup,
  colaboradorId: number | null | undefined,
): Promise<SolicitacaoEmAberto | null> {
  if (!colaboradorId) return null;
  const { data, error } = await sb.rpc("solicitacao_em_aberto", {
    p_tipo: tipo, p_colaborador_id: colaboradorId,
  });
  if (error) {
    console.warn("[solicitacao_em_aberto]", error.message);
    return null;
  }
  return (data as SolicitacaoEmAberto | null) ?? null;
}
