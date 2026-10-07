/** Limite da coluna integer usada por sup_pedido_item.quantidade no Postgres. */
export const QUANTIDADE_MAXIMA_SOLICITACAO = 2_147_483_647;

/**
 * Converte a quantidade escolhida ou digitada sem aceitar decimais, sinais,
 * notação exponencial ou valores que estourariam a coluna no banco.
 */
export function normalizarQuantidadeSolicitada(
  valor: string | number | null | undefined,
): number | null {
  const texto = String(valor ?? "").trim();
  if (!/^\d+$/.test(texto)) return null;

  const quantidade = Number(texto);
  if (
    !Number.isSafeInteger(quantidade)
    || quantidade < 1
    || quantidade > QUANTIDADE_MAXIMA_SOLICITACAO
  ) return null;

  return quantidade;
}

export function quantidadeSolicitadaValida(
  valor: string | number | null | undefined,
): boolean {
  return normalizarQuantidadeSolicitada(valor) !== null;
}
