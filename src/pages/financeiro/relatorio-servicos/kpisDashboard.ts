import type { NfEmissaoItemRow, NfEmissaoRow } from "@/hooks/useNfEmissao";
import { naoContabilizaKpi, statusDaNota, valorPendenteNf } from "@/pages/financeiro/nf-emissao/shared";

// SIS-2026-0869: os KPIs do Dashboard do Relatório de Serviços viraram função pura para a Conciliação testar a MESMA conta
// que o Dashboard mostra (e não uma cópia que poderia se afastar dela). O Dashboard chama esta função; qualquer mudança
// aqui aparece nos dois lugares.

export const CAMPOS_DESCONTO: { key: keyof NfEmissaoItemRow; label: string }[] = [
  { key: "faltas", label: "Faltas" },
  { key: "posto_nao_implementado", label: "Posto não implementado" },
  { key: "multas", label: "Multas antes da NF" },
  { key: "multas_pos_emissao", label: "Multas depois da NF" },
  { key: "glosas", label: "Glosas antes da NF" },
  { key: "glosas_pos_emissao", label: "Glosas depois da NF" },
  { key: "outros_descontos", label: "Outros descontos antes da NF" },
  { key: "outros_descontos_pos_emissao", label: "Outros descontos depois da NF" },
];

export interface KpisDashboard {
  total: number;
  executado: number;
  faturado: number;
  recebido: number;
  pendente: number;
  descontos: number;
  pctPago: number;
  pctDescontos: number;
}

export function kpisDoDashboard(linhas: NfEmissaoRow[], itensPorNf: Map<string, NfEmissaoItemRow[]> | undefined): KpisDashboard {
  let executado = 0, faturado = 0, recebido = 0, pendente = 0, descontos = 0;
  let pagas = 0;
  // Achado real (Ruan): nota Cancelada/Substituída ainda carrega valores em vlr_bruto_total/vlr_liquido_total/valor_pago (a
  // planilha legada não zera na migração) — sem esse filtro, ela entrava em Executado/Faturado/Recebido como se fosse uma
  // nota normal, inflando o total.
  for (const n of linhas) {
    if (naoContabilizaKpi(n)) continue;
    const itens = itensPorNf?.get(n.id) ?? [];
    executado += n.valor_contrato_exec_total;
    faturado += n.vlr_bruto_total;
    recebido += n.valor_pago ?? 0;
    pendente += valorPendenteNf(n, itens);
    descontos += n.desconto_conta_vinculada + itens.reduce((s, it) => s + CAMPOS_DESCONTO.reduce((s2, c) => s2 + (Number(it[c.key]) || 0), 0), 0);
    if (statusDaNota(n) === "pago") pagas++;
  }
  const pctPago = linhas.length ? (pagas / linhas.length) * 100 : 0;
  const pctDescontos = executado ? (descontos / executado) * 100 : 0;
  return { total: linhas.length, executado, faturado, recebido, pendente, descontos, pctPago, pctDescontos };
}
