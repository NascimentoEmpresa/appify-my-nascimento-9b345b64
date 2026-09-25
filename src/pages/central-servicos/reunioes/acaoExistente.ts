export const STATUS_ACAO_NAO_VINCULAVEL = [
  "concluida_pendente_evidencia",
  "concluida_validada",
  "cancelada",
] as const;

export interface PlanoAcaoVinculavel {
  id: string;
  titulo: string | null;
  acao: string | null;
  area: string | null;
  status_normalizado: string;
  prioridade_normalizada: string | null;
  responsavel_profile_id: string | null;
  data_fim_planejado: string | null;
  updated_at: string;
}

/**
 * Só ações em aberto podem virar assunto de uma pauta. Canceladas também
 * ficam de fora: apesar de não serem "concluídas", não existe mais trabalho
 * ativo para acompanhar na reunião.
 */
export function acaoPodeSerVinculada(
  acao: Pick<PlanoAcaoVinculavel, "status_normalizado">,
): boolean {
  return !STATUS_ACAO_NAO_VINCULAVEL.includes(
    acao.status_normalizado as (typeof STATUS_ACAO_NAO_VINCULAVEL)[number],
  );
}

export function tituloAcaoVinculavel(
  acao: Pick<PlanoAcaoVinculavel, "titulo" | "acao">,
): string {
  return acao.titulo?.trim() || acao.acao?.trim() || "Ação sem título";
}
