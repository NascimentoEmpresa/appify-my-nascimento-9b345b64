// Despesa parcelada (ex. compra no cartão em 10x): `malote_despesa.data_pagamento` guarda a data da COMPRA (rastreio), e o dinheiro
// sai nos vencimentos das parcelas. A regra "pagamento anterior a hoje não aprova" e a chave do Nível 1 devem olhar a primeira
// parcela ainda em aberto, não a data da compra. Mesma conta da RPC malote_aprovar_despesa (migration 20261026000820).
export function dataPagamentoEfetiva(
  parcelado: boolean | null | undefined,
  parcelas: { data_vencimento: string; pago_em: string | null }[] | null | undefined,
  dataCabecalho: string | null | undefined,
): string {
  if (parcelado) {
    const abertas = (parcelas ?? []).filter((p) => !p.pago_em && p.data_vencimento).map((p) => p.data_vencimento).sort();
    if (abertas.length > 0) return abertas[0];
  }
  return dataCabecalho ?? "";
}
