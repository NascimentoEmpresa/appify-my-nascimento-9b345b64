export type CasoInclusaoEnxoval =
  | "inserir"
  | "ja_existe"
  | "desfazer_rascunho"
  | "desfazer_pendente"
  | "reativar_orfao";

/**
 * SIS-2026-0455: uma remoção ainda pendente mantém o vínculo físico para que
 * possa ser desfeita sem violar a unicidade entre função e material.
 */
export function decidirInclusaoEnxoval(
  vinculo: { id: string; ativo: boolean } | null,
  alteracoes: { tipo_acao: string; status: string }[],
): CasoInclusaoEnxoval {
  if (vinculo == null) return "inserir";
  if (vinculo.ativo) return "ja_existe";
  if (alteracoes.some((alteracao) => alteracao.tipo_acao === "excluir" && alteracao.status === "RASCUNHO")) {
    return "desfazer_rascunho";
  }
  if (alteracoes.some((alteracao) => alteracao.tipo_acao === "excluir" && alteracao.status === "PENDENTE")) {
    return "desfazer_pendente";
  }
  return "reativar_orfao";
}
