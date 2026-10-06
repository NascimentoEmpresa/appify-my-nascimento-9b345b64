// SIS-2026-0583: ao escolher "Pix" como forma de pagamento, a chave Pix é
// obrigatória. Antes, o checkbox "Pagamento só por anexo" (feito pro boleto)
// dispensava o campo mesmo com Pix selecionado e a despesa seguia sem chave.
// A forma vem do catálogo cadastrável ("Pix", "PIX", "Pix - Itaú"...), então
// o reconhecimento é por nome, sem diferenciar caixa.
export function formaPagamentoEhPix(forma: string | null | undefined): boolean {
  return /(^|[^a-z])pix([^a-z]|$)/i.test((forma ?? "").trim());
}

// Dados de pagamento dispensados só quando a forma não é Pix e a pessoa
// marcou "só por anexo".
export function dadosPagamentoDispensados(forma: string | null | undefined, soAnexo: boolean): boolean {
  return soAnexo && !formaPagamentoEhPix(forma);
}
