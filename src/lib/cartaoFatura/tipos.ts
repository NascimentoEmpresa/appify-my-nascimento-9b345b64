// SIS-2026-0255: Importar fatura do Cartão de Crédito.
//
// Cada banco exporta a fatura num formato completamente diferente (achado
// inspecionando 3 amostras reais: Banrisul, Banco do Brasil, Bradesco) —
// nenhum tem cabeçalho de coluna detectável por um parser genérico único.
// Por isso o import é por "adaptador": 1 função por banco que sabe filtrar
// as linhas de compra de verdade (ignorando metadados, subtotal, seções
// informativas) e devolver tudo no mesmo formato comum (`LinhaBruta`), que
// o algoritmo de reconciliação (reconciliar.ts) e a tela de conferência
// não precisam saber de onde vieram.

export interface LinhaBruta {
  /** ISO yyyy-mm-dd — data da COMPRA (não necessariamente dentro do mês da
   * fatura atual: uma parcela antiga referencia a data da compra original). */
  data: string | null;
  descricao: string;
  valor: number;
  parcelaAtual: number | null;
  parcelaTotal: number | null;
}

export type FormatoArquivoFatura = "xlsx" | "csv" | "html";

export interface AdaptadorBanco {
  /** Precisa bater com malote_cartao_banco.nome (case-insensitive). */
  nomeBanco: string;
  formatos: FormatoArquivoFatura[];
  /**
   * `competenciaAno`/`competenciaMes` (1-12) vêm da Competência já
   * selecionada no passo 1 do modal — usados só pra inferir o ANO de datas
   * que o banco exporta sem ano (`DD/MM`); nunca pra filtrar linha.
   */
  parse: (args: { arquivo: File; competenciaAno: number; competenciaMes: number }) => Promise<LinhaBruta[]>;
}
