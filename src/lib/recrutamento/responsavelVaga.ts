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

/**
 * Filas de aprovação (antes do Recrutamento): vaga aqui não tem responsável
 * nem entra no filtro por pessoa. 14/10/2026 — "pesquiso a vaga 261 e aparece
 * a Giovana, mas filtrando a Giovana ela não aparece": o filtro por pessoa
 * prendia nas vagas EM ANDAMENTO e escondia as que ela já fechou (Contratado,
 * Concluído). Por pessoa vale tudo menos estas filas; "sem responsável" segue
 * só nas em andamento (senão entra todo o legado anterior ao responsável).
 */
export const STATUS_FILA_APROVACAO = ["Pendente Operacional", "Pendente Analista", "Pendente Diretoria"] as const;
export const vagaForaDaFila = (status: string | null | undefined) =>
  !!status && !(STATUS_FILA_APROVACAO as readonly string[]).includes(status);

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
  // "Sem responsável": só em andamento. Por pessoa: tudo o que ela cuidou, menos as filas de aprovação.
  if (alvo.tipo === "sem") return vagaTemResponsavel(vaga.status) && !responsavelId;
  return vagaForaDaFila(vaga.status) && responsavelId === alvo.id;
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
