import type { RateioLinha } from "@/hooks/useMaloteDespesa";

// SIS-2026-0856 (Juliana/Compras, decisão com o Iury): em ajuste_pagamento (devolvida pela Conferência de Pagamento) o Rateio inteiro é editável
// (empresa, contrato, fornecedor, integrante, valor, linhas). QUALQUER mudança nele — inclusive só a Empresa — refaz toda a aprovação (volta ao N1
// e segue até o pagamento), para o orçamento utilizado ser reavaliado. Compara por linha; linha nova ou removida também conta.
export function rateioMudou(antigo: RateioLinha[], novo: RateioLinha[]): boolean {
  if (antigo.length !== novo.length) return true;
  const antigosPorId = new Map(antigo.filter((l) => l.id).map((l) => [l.id as string, l]));
  for (const l of novo) {
    if (!l.id) return true;
    const a = antigosPorId.get(l.id);
    if (!a) return true;
    if (
      Number(a.valor) !== Number(l.valor) ||
      (a.empresa_id ?? null) !== (l.empresa_id ?? null) ||
      (a.contrato_id ?? null) !== (l.contrato_id ?? null) ||
      (a.fornecedor_id ?? null) !== (l.fornecedor_id ?? null) ||
      (a.integrante_empregado_id ?? null) !== (l.integrante_empregado_id ?? null) ||
      (a.classificacao_id ?? null) !== (l.classificacao_id ?? null)
    ) return true;
  }
  return false;
}
