// =====================================================================
// Recrutamento — responsável pela vaga: filtro e "assumir" (14/10/2026,
// mig 20261014000003). Com teste em src/test/recrutamento-responsavel-vaga.test.ts.
//
// Pedido do Pablo: "mais um filtro, Responsável da vaga; um botão em cada
// vaga 'Tornar-me responsável'; vira responsável automaticamente ao passar
// uma etapa e, se já tiver alguém, pergunta 'tem certeza que deseja assumir
// a vaga?'. Só conta para vagas no Recrutamento ou na Seleção — Operacional
// não aparece nesse filtro."
// =====================================================================

/**
 * Status em que a vaga tem responsável: "Pendente Recrutamento" + os status
 * dirigidos pelo candidato (STATUS_PROCESSO da Gestão Recrutamento). A MESMA
 * lista de rec_vaga_tem_responsavel no banco — mudou lá, muda aqui.
 */
export const STATUS_COM_RESPONSAVEL = [
  "Pendente Recrutamento",
  "Vaga aberta - Seleção de Currículos", "Em análise jurídica", "Entrevista e Avaliação", "Entrevista com Gestor",
  "Aprovado - Aguardando SST", "Compras Confirmou - Aguardando Documentação", "Aguardando SST e Compras",
  "Encaminhado para SST (ASO)", "ASO Aprovado - Aguardando Informe de EPIs", "Aguardando Confirmação Compras",
] as const;

export const vagaTemResponsavel = (status: string | null | undefined) =>
  !!status && (STATUS_COM_RESPONSAVEL as readonly string[]).includes(status);

/** Filtro "Responsável da vaga": vazio = todos; "eu"; "sem"; ou o id de uma pessoa. */
export type FiltroResponsavel = "" | "eu" | "sem" | string;

/** O id a filtrar (ou "sem"/null) — "eu" vira o id de quem está logado. */
export function alvoDoFiltro(filtro: FiltroResponsavel, meuId: string | null | undefined): { tipo: "todos" } | { tipo: "sem" } | { tipo: "pessoa"; id: string } {
  if (!filtro) return { tipo: "todos" };
  if (filtro === "sem") return { tipo: "sem" };
  const id = filtro === "eu" ? meuId : filtro;
  return id ? { tipo: "pessoa", id } : { tipo: "todos" };
}

/** A vaga passa no filtro? (para a lista já carregada, ex.: o kanban). */
export function passaNoFiltro(
  vaga: { status: string | null | undefined },
  responsavelId: string | null | undefined,
  filtro: FiltroResponsavel,
  meuId: string | null | undefined,
): boolean {
  const alvo = alvoDoFiltro(filtro, meuId);
  if (alvo.tipo === "todos") return true;
  if (!vagaTemResponsavel(vaga.status)) return false; // Operacional e encerradas não entram
  return alvo.tipo === "sem" ? !responsavelId : responsavelId === alvo.id;
}

/**
 * Ao passar uma etapa: perguntar se a pessoa quer assumir? Só quando a vaga
 * já tem OUTRO responsável. Sem ninguém, o banco já marca quem moveu
 * (automático); sendo a própria pessoa, nada a fazer.
 */
export function devePerguntarAssumir(
  vaga: { status: string | null | undefined },
  responsavel: { responsavel_id: string | null } | null | undefined,
  meuId: string | null | undefined,
): boolean {
  return !!meuId && vagaTemResponsavel(vaga.status) && !!responsavel?.responsavel_id && responsavel.responsavel_id !== meuId;
}

export const textoConfirmarAssumir = (vagaId: number, nomeAtual: string) =>
  `${nomeAtual} já é o responsável pela vaga #${vagaId}.\n\nTem certeza que deseja assumir a vaga?`;
