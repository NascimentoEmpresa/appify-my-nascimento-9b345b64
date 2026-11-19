export const CATEGORIAS_CANCELAMENTO_PEDIDO = [
  { valor: "DUPLICIDADE", rotulo: "Pedido duplicado" },
  { valor: "DESISTENCIA_ADMISSAO", rotulo: "Desistência da admissão" },
  { valor: "PEDIDO_INCORRETO", rotulo: "Pedido incorreto" },
  { valor: "COLABORADOR_DESLIGADO", rotulo: "Colaborador desligado" },
  { valor: "NAO_NECESSARIO", rotulo: "Material não necessário" },
  { valor: "OUTRO", rotulo: "Outro" },
] as const;

export type CategoriaCancelamentoPedido = (typeof CATEGORIAS_CANCELAMENTO_PEDIDO)[number]["valor"];
export type EstadoCancelamentoPedido = "NENHUM" | "SOLICITADO" | "RECUSADO" | "APROVADO";

export interface DadosCancelamentoPedido {
  cancelamento_estado: EstadoCancelamentoPedido;
  cancelamento_categoria: CategoriaCancelamentoPedido | null;
  cancelamento_detalhe: string | null;
  cancelamento_origem: "RECRUTAMENTO" | "ENCARREGADO" | null;
  cancelamento_solicitado_por_nome: string | null;
  cancelamento_solicitado_em: string | null;
  cancelamento_decidido_por_nome: string | null;
  cancelamento_decidido_em: string | null;
  cancelamento_decisao_observacao: string | null;
}

const STATUS_CANCELAVEIS = new Set([
  "EM PREPARACAO",
  "EM SEPARACAO",
  "AGUARDANDO ENVIO",
  "AGUARDANDO COMPRA",
]);

export function pedidoAceitaSolicitacaoCancelamento(
  status: string,
  estado: EstadoCancelamentoPedido | null | undefined,
): boolean {
  return STATUS_CANCELAVEIS.has(status) && estado !== "SOLICITADO";
}

export function rotuloCategoriaCancelamento(categoria?: string | null): string {
  return CATEGORIAS_CANCELAMENTO_PEDIDO.find((item) => item.valor === categoria)?.rotulo ?? "Outro";
}

export function validarMotivoCancelamento(
  categoria: string,
  detalhe: string,
): string | null {
  if (!CATEGORIAS_CANCELAMENTO_PEDIDO.some((item) => item.valor === categoria)) {
    return "Selecione o motivo do cancelamento.";
  }
  const tamanho = detalhe.trim().length;
  if (tamanho < 10) return "Explique o motivo com pelo menos 10 caracteres.";
  if (tamanho > 1000) return "O detalhe deve ter no máximo 1000 caracteres.";
  return null;
}
