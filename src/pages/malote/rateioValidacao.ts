/**
 * Regra de Fornecedor no Rateio do Malote.
 *
 * Mora fora do componente porque mudou cinco vezes em pouco mais de uma
 * semana, e a última volta explica as outras quatro:
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
 *   [SEM-CHAMADO] (25/09, pedido do Iury) volta pra regra original do 0457
 *                          ("OU Fornecedor OU Integrante") — o combobox de
 *                          Fornecedor já está corrigido desde o 0480, então
 *                          o motivo que levou ao 0467 (exigir sempre
 *                          Fornecedor) não se sustenta mais; casos de
 *                          despesa paga a um Integrante (funcionário) sem
 *                          Fornecedor cadastrado voltam a ser possíveis.
 *
 * A lição que o histórico registra: campo obrigatório que ninguém consegue
 * preencher parece regra errada e quase sempre é dado que não chega na tela.
 */
export interface DimensoesFornecedor {
  fornecedor: boolean;
  integrante: boolean;
}

export interface LinhaFornecedor {
  fornecedor_id: string | null;
  integrante_empregado_id: number | null;
}

/** Devolve a mensagem de erro, ou null quando o rateio pode ser enviado. */
export function erroFornecedorNoRateio(
  dimensoes: DimensoesFornecedor,
  linhas: LinhaFornecedor[],
): string | null {
  if (!dimensoes.fornecedor && !dimensoes.integrante) {
    return "Marque \"Fornecedor\" ou \"Integrante\" no Rateio e informe um dos dois em cada linha.";
  }
  if (linhas.some((l) => !l.fornecedor_id && !l.integrante_empregado_id)) {
    return "Informe o Fornecedor ou o Integrante em todas as linhas do rateio.";
  }
  return null;
}

/**
 * Regra de Empresa no Rateio do Malote ([SEM-CHAMADO], pedido do Iury,
 * achado: DM-2026-1364 — Contrato "ADM - SN" derivou Empresa "HAGG" sem
 * ninguém escolher isso, e não havia nada bloqueando esse cenário).
 *
 * Só se aplica quando a linha realmente TEM uma coluna de Empresa pra
 * preencher: dimensão "Empresa" marcada manualmente, OU a Classificação da
 * linha é do tipo "contrato" (aí o RateioGrid deriva Empresa a partir do
 * Contrato escolhido, ver `atualizarContratoDaLinha` em RateioGrid.tsx).
 * Despesa de empresa única, sem essas duas condições, não tem coluna
 * Empresa na grade — não faz sentido exigir o campo que nem aparece.
 */
export function erroEmpresaNoRateio(
  linhas: { empresa_id: string | null; exigeEmpresa: boolean }[],
): string | null {
  if (linhas.some((l) => l.exigeEmpresa && !l.empresa_id)) {
    return "Informe a Empresa em todas as linhas do rateio.";
  }
  return null;
}
