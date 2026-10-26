// [SEM-CHAMADO] SIS-2026-0682: despesa rateada em várias Classificações não tem classificacao_id no cabeçalho (cada linha do
// rateio tem a sua). Na edição pelo solicitante, "Selecione a Classificação." barrava qualquer alteração (ex.: trocar a data
// de pagamento) e o save mandava "" para uma coluna uuid. Aqui a regra: cabeçalho sem classificação + linhas com classificação
// = classificação definida pelo rateio (não há o que escolher no cabeçalho).
export function classificacaoPorRateio(classificacaoIdDespesa: string | null | undefined, idsClassificacaoDoRateio: Iterable<string>): boolean {
  if (classificacaoIdDespesa) return false;
  for (const _ of idsClassificacaoDoRateio) return true;
  return false;
}
