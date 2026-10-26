// Fluxo de Caixa: exportação para Excel com os rateios abertos (uma linha por cota), para a planilha poder
// ser filtrada/somada por contrato. A tela agrega o rateio em 1 linha ("Rateio" + rateioDetalhe); aqui desfaz.

export interface CotaExport {
  id: string;
  nome: string;
  valor: number;
}

export interface LinhaParaExport {
  valor: number | string;
  contrato_id: string | null;
  contrato_nome?: string | null;
  descricao?: string | null;
  fatura_cartao_id?: string | null;
  rateioDetalhe?: CotaExport[];
}

export interface LinhaExportada<L extends LinhaParaExport> {
  linha: L;
  /** valor desta linha da planilha (a cota, ou o lançamento inteiro se não for rateio). */
  valor: number;
  contrato: string;
  descricao: string;
  rateado: boolean;
  /** valor do lançamento inteiro (igual a `valor` quando não é rateio). */
  valorLancamento: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Abre o lançamento em uma linha por cota. Fatura do cartão abre por despesa (descrição = "DM-xxx · …"); rateio
 * entre contratos abre por contrato. `contratoId`: filtro de contrato do export — numa linha rateada, só as
 * cotas daquele contrato entram.
 */
export function linhasDoExport<L extends LinhaParaExport>(l: L, contratoId?: string): LinhaExportada<L>[] {
  const total = Number(l.valor) || 0;
  const cotas = l.rateioDetalhe ?? [];
  if (cotas.length === 0) {
    return [{ linha: l, valor: total, contrato: l.contrato_nome ?? "", descricao: l.descricao ?? "", rateado: false, valorLancamento: total }];
  }
  if (l.fatura_cartao_id) {
    const contrato = l.contrato_nome && l.contrato_nome !== "Rateio" ? l.contrato_nome : "";
    return cotas.map((c) => ({ linha: l, valor: r2(c.valor), contrato, descricao: c.nome, rateado: true, valorLancamento: total }));
  }
  return cotas
    .filter((c) => !contratoId || c.id === contratoId)
    .map((c) => ({ linha: l, valor: r2(c.valor), contrato: c.nome, descricao: l.descricao ?? "", rateado: true, valorLancamento: total }));
}

/** O filtro de contrato do export aceita a linha rateada se alguma cota for do contrato escolhido. */
export function linhaTemContrato(l: LinhaParaExport, contratoId: string): boolean {
  if (l.contrato_id === contratoId) return true;
  return !l.fatura_cartao_id && !!l.rateioDetalhe?.some((c) => c.id === contratoId);
}
