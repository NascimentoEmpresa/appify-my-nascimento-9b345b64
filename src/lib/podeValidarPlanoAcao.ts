/**
 * Regra de elegibilidade pra marcar uma ação como "Concluída — Validada":
 * só quem criou a ação. Ações legadas sem criado_por registrado (criadas
 * antes do fix que passou a gravar isso) caem no fallback do Responsável,
 * pra não ficarem órfãs sem ninguém capaz de validar.
 */
export function podeValidarPlanoAcao(
  row: { criado_por: string | null; responsavel_profile_id: string | null },
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  if (row.criado_por) return row.criado_por === userId;
  return row.responsavel_profile_id === userId;
}
