import { conferirTamanho } from "@/lib/limiteAnexo";

// SIS-2026-0843: a solicitação de manutenção leva a foto do equipamento
// (obrigatória) e, se houver, o orçamento (opcional). O orçamento costuma
// chegar em PDF — em 09/11 alguém converteu um PDF em JPG só para caber no
// campo da foto —, então ele aceita PDF; a foto do equipamento continua só imagem.
export const BUCKET_SOLICITACAO_MANUTENCAO = "sup-solicitacoes-manutencao";

export type CategoriaAnexoManutencao = "foto_equipamento" | "orcamento";

export const ACCEPT_ANEXO_MANUTENCAO: Record<CategoriaAnexoManutencao, string> = {
  foto_equipamento: "image/jpeg,image/png,image/webp",
  orcamento: "image/jpeg,image/png,image/webp,application/pdf",
};

/** Mensagem de recusa, ou null se o arquivo serve para a categoria. */
export function validarArquivoManutencao(
  arquivo: Pick<File, "name" | "type" | "size">,
  categoria: CategoriaAnexoManutencao,
): string | null {
  const tipo = arquivo.type || "";
  const ehImagem = tipo.startsWith("image/");
  if (categoria === "foto_equipamento" && !ehImagem) {
    return "Anexe uma foto do equipamento em formato de imagem.";
  }
  if (categoria === "orcamento" && !ehImagem && tipo !== "application/pdf") {
    return "O orçamento deve ser uma imagem (JPG, PNG, WEBP) ou PDF.";
  }
  return conferirTamanho(BUCKET_SOLICITACAO_MANUTENCAO, arquivo, arquivo.name);
}
