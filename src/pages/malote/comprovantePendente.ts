// Pagamento do Malote sem comprovante ("Pago — aguardando comprovante").
// A despesa/parcela fica `paga` (o pagamento é real — Fluxo de Caixa, Orçamento
// e juros seguem como estão) com a marca comprovante_pendente até quem pagou
// anexar o arquivo. Migration 20261006000004.

interface PartePaga {
  status: string;
  comprovante_pendente?: boolean | null;
  pago_em?: string | null;
}

// Linha da lista do Pagamento Malote: parcelada = a parcela decide; não
// parcelada = a despesa.
export function comprovantePendenteDoItem(item: { despesa: PartePaga; parcela: PartePaga | null }): boolean {
  if (item.parcela) return item.parcela.status === "paga" && !!item.parcela.comprovante_pendente;
  return item.despesa.status === "despesa_paga" && !!item.despesa.comprovante_pendente;
}

export function pagoEmDoItem(item: { despesa: PartePaga; parcela: PartePaga | null }): string | null {
  return (item.parcela ? item.parcela.pago_em : item.despesa.pago_em) ?? null;
}

// Dias corridos desde o pagamento (0 = hoje).
export function diasAguardandoComprovante(pagoEm: string | null | undefined, agora: Date = new Date()): number {
  if (!pagoEm) return 0;
  const ms = agora.getTime() - new Date(pagoEm).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

// Cobrança visual: a etiqueta esquenta com o tempo parado.
export type SeveridadeComprovante = "normal" | "atencao" | "critico";
export function severidadeComprovante(dias: number): SeveridadeComprovante {
  if (dias >= 7) return "critico";
  if (dias >= 3) return "atencao";
  return "normal";
}

export function textoDiasComprovante(dias: number): string {
  if (dias <= 0) return "hoje";
  return dias === 1 ? "há 1 dia" : `há ${dias} dias`;
}
