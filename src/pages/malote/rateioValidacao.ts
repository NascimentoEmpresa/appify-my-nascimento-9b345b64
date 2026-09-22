/**
 * Regra de Fornecedor no Rateio do Malote.
 *
 * Mora fora do componente porque ela já mudou três vezes em uma semana e cada
 * mudança quebrou uma tela que ninguém tinha em mente na hora:
 *
 *   SIS-2026-0457 (18/09)  exige Fornecedor OU Integrante em cada linha.
 *   SIS-2026-0467 (18/09)  Fornecedor passa a ser sempre obrigatório;
 *                          Integrante volta a ser dimensão opcional e solta.
 *   SIS-2026-0480 (22/09)  ...mas PainelDespesaMalote é compartilhado com as
 *                          duas telas de aprovação de diária, e diária não tem
 *                          fornecedor: o PIX vai para o próprio colaborador.
 *                          Com o 0467 em produção a aprovação de diária ficou
 *                          impossível de concluir — 13 solicitações represadas
 *                          quando o Dickson (Operacional) abriu o chamado.
 *
 * Conferido no banco antes de mexer: TODAS as despesas de diária já pagas têm
 * fornecedor_id nulo e integrante_empregado_id preenchido. Exigir fornecedor
 * na diária não era regra apertada, era regra impossível.
 */
export interface DimensoesFornecedor {
  fornecedor: boolean;
}

export interface LinhaFornecedor {
  fornecedor_id: string | null;
}

/**
 * Devolve a mensagem de erro, ou null quando o rateio pode ser enviado.
 *
 * @param exigir  false quando quem embute o painel não trabalha com
 *                fornecedor (as duas telas de diária). O default do painel é
 *                true, então o Malote segue como o SIS-2026-0467 deixou.
 */
export function erroFornecedorNoRateio(
  exigir: boolean,
  dimensoes: DimensoesFornecedor,
  linhas: LinhaFornecedor[],
): string | null {
  if (!exigir) return null;
  if (!dimensoes.fornecedor) {
    return "Marque \"Fornecedor\" no Rateio e informe-o em cada linha.";
  }
  if (linhas.some((l) => !l.fornecedor_id)) {
    return "Informe o Fornecedor em todas as linhas do rateio.";
  }
  return null;
}
