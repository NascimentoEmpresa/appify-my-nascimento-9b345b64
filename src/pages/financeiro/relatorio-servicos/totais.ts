import { naoContabilizaKpi } from "@/pages/financeiro/nf-emissao/shared";

// SIS-2026-0647: totais do topo do Relatório Geral. Tudo é calculado em cima das linhas já filtradas
// (empresa, competência, contrato, status, código, emissão, busca), então os valores mudam com qualquer filtro.
// Cancelada/Substituída continua na lista mas fica fora de todos os totais (mesma regra de sempre).

export interface NfParaTotais {
  contrato_id: string;
  competencia: string;
  tipo_nota: string;
  status?: string;
  situacao_site_pmt?: string | null;
  situacao_dominio?: string | null;
  data_pagamento?: string | null;
  valor_contrato_exec_total: number;
  vlr_bruto_total: number;
  vlr_liquido_total: number;
  valor_pago?: number | null;
  desconto_conta_vinculada: number;
}

export interface TotaisRelatorio {
  // Valor da licitação/contrato (planilha de custo vigente): uma vez por contrato e mês, mesmo com várias NFs.
  executavel: number;
  // O que o analista digitou na NF como valor executado.
  executado: number;
  faturado: number;
  liquido: number;
  // Executado − Faturado. Positivo: executou mais do que faturou; negativo: faturou acima do executado.
  divergencia: number;
  contaVinculada: number;
  recebido: number;
  pendente: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function totaisDoRelatorio<T extends NfParaTotais>(
  linhas: T[],
  executavelDoContratoMes: (contratoId: string, anoMes: string) => number,
  pendenteDaNf: (nf: T) => number,
): TotaisRelatorio {
  let executado = 0, faturado = 0, liquido = 0, contaVinculada = 0, recebido = 0, pendente = 0;
  // Só nota Código N é lançamento (mesmo critério do Controle de Faturamento); o executável de cada contrato/mês entra uma vez.
  const paresExecutavel = new Set<string>();
  for (const n of linhas) {
    if (naoContabilizaKpi(n)) continue;
    executado += n.valor_contrato_exec_total || 0;
    faturado += n.vlr_bruto_total || 0;
    liquido += n.vlr_liquido_total || 0;
    contaVinculada += n.desconto_conta_vinculada || 0;
    recebido += n.valor_pago ?? 0;
    pendente += pendenteDaNf(n);
    if (n.tipo_nota === "N") paresExecutavel.add(`${n.contrato_id}|${n.competencia.slice(0, 7)}`);
  }
  let executavel = 0;
  for (const par of paresExecutavel) {
    const [contratoId, anoMes] = par.split("|");
    executavel += executavelDoContratoMes(contratoId, anoMes);
  }
  return {
    executavel: r2(executavel),
    executado: r2(executado),
    faturado: r2(faturado),
    liquido: r2(liquido),
    divergencia: r2(executado - faturado),
    contaVinculada: r2(contaVinculada),
    recebido: r2(recebido),
    pendente: r2(pendente),
  };
}

// SIS-2026-0694: o filtro Contrato do Relatório Geral depende do filtro Empresa. O vínculo é o do cadastro (contrato.empresa_id).
// Sem empresa escolhida, valem todos os contratos.
export function contratosDaEmpresa<T extends { empresa_id: string }>(contratos: T[], empresaId: string): T[] {
  return empresaId ? contratos.filter((c) => c.empresa_id === empresaId) : contratos;
}

// O contrato selecionado ainda é compatível com a empresa? (contrato desconhecido ou sem empresa escolhida: não há o que limpar)
export function contratoCombinaComEmpresa(contrato: { empresa_id: string } | undefined, empresaId: string): boolean {
  return !empresaId || !contrato || contrato.empresa_id === empresaId;
}
