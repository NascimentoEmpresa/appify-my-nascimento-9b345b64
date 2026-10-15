// Fluxo de Caixa: busca livre da tela (ID ou descrição). Lançamento dentro de um rateio/fatura também é achado:
// a fatura do cartão guarda as despesas (DM-xxx · descrição) em rateioDetalhe, e a linha dela só tem o nome da fatura.

export interface LinhaParaBusca {
  id_malote?: string | null;
  descricao?: string | null;
  rateioDetalhe?: { nome: string; idMalote?: string | null; descricao?: string | null }[];
}

/** `termo` já em minúsculas e sem espaços nas pontas; vazio casa tudo. */
export function linhaCasaBusca(l: LinhaParaBusca, termo: string): boolean {
  if (!termo) return true;
  const tem = (s?: string | null) => (s ?? "").toLowerCase().includes(termo);
  if (tem(l.id_malote) || tem(l.descricao)) return true;
  return !!l.rateioDetalhe?.some((r) => tem(r.nome) || tem(r.idMalote) || tem(r.descricao));
}
