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
  // SIS-2026-0927: vários IDs/termos separados por vírgula (ex.: "DM-2026-2845, DM-2026-2846"); a linha entra se casar com QUALQUER um.
  const termos = termo.split(",").map((t) => t.trim()).filter(Boolean);
  if (termos.length === 0) return true;
  const tem = (s: string | null | undefined, t: string) => (s ?? "").toLowerCase().includes(t);
  return termos.some(
    (t) => tem(l.id_malote, t) || tem(l.descricao, t) || !!l.rateioDetalhe?.some((r) => tem(r.nome, t) || tem(r.idMalote, t) || tem(r.descricao, t)),
  );
}
