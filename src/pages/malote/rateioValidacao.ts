/**
 * Regra de Fornecedor no Rateio do Malote.
 *
 * Mora fora do componente porque mudou quatro vezes em uma semana, e a última
 * volta explica as outras três:
 *
 *   SIS-2026-0457 (18/09)  exige Fornecedor OU Integrante em cada linha.
 *   SIS-2026-0467 (18/09)  Fornecedor passa a ser sempre obrigatório;
 *                          Integrante volta a ser dimensão opcional e solta.
 *   SIS-2026-0480 (22/09)  o Operacional não conseguia concluir a aprovação de
 *                          diária: "preciso definir um Fornecedor no rateio,
 *                          qual informação devo preencher?". A leitura na hora
 *                          foi de que a regra do 0467 tinha vazado para uma
 *                          tela onde não cabia — PainelDespesaMalote é
 *                          compartilhado com as duas telas de diária — e a
 *                          exigência virou opcional lá.
 *   SIS-2026-0480 (22/09, depois de investigar)
 *                          era a causa errada. O problema real era o combobox
 *                          de Fornecedor vindo VAZIO: a policy forn_select de
 *                          public.fornecedor exige o menu do CADASTRO
 *                          ('fornecedores', /app/suprimentos/fornecedores),
 *                          que quem aprova diária não tem — e RLS negada
 *                          devolve zero linhas, não erro. Não havia o que
 *                          escolher, num campo obrigatório. Consertado o
 *                          combobox (RPC malote_fornecedores_para_rateio, em
 *                          20260930000201), a diária voltou a exigir
 *                          Fornecedor como todo o resto do Malote.
 *
 * A lição que o histórico registra: campo obrigatório que ninguém consegue
 * preencher parece regra errada e quase sempre é dado que não chega na tela.
 */
export interface DimensoesFornecedor {
  fornecedor: boolean;
}

export interface LinhaFornecedor {
  fornecedor_id: string | null;
}

/** Devolve a mensagem de erro, ou null quando o rateio pode ser enviado. */
export function erroFornecedorNoRateio(
  dimensoes: DimensoesFornecedor,
  linhas: LinhaFornecedor[],
): string | null {
  if (!dimensoes.fornecedor) {
    return "Marque \"Fornecedor\" no Rateio e informe-o em cada linha.";
  }
  if (linhas.some((l) => !l.fornecedor_id)) {
    return "Informe o Fornecedor em todas as linhas do rateio.";
  }
  return null;
}
