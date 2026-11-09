import { naoContabilizaKpi, pendenciaContaVinculada } from "@/pages/financeiro/nf-emissao/shared";

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
  conta_vinculada_valor_recebido?: number | null;
  // SIS-2026-0819: impostos retidos na nota (opcionais: quem não informa conta zero).
  issqn_total?: number | null;
  inss_total?: number | null;
  ir_total?: number | null;
  cofins_total?: number | null;
  pis_total?: number | null;
  csll_total?: number | null;
}

// SIS-2026-0819: os seis impostos retidos nas notas, na ordem das colunas do Relatório Geral.
export const IMPOSTOS_RETIDOS = [
  { campo: "issqn_total", rotulo: "ISSQN" },
  { campo: "inss_total", rotulo: "INSS" },
  { campo: "ir_total", rotulo: "IR" },
  { campo: "cofins_total", rotulo: "COFINS" },
  { campo: "pis_total", rotulo: "PIS" },
  { campo: "csll_total", rotulo: "CSLL" },
] as const;

export type CampoImposto = (typeof IMPOSTOS_RETIDOS)[number]["campo"];

/** Soma dos seis impostos retidos numa nota. */
export function retencoesDaNf(n: NfParaTotais): number {
  return IMPOSTOS_RETIDOS.reduce((soma, i) => soma + (n[i.campo] ?? 0), 0);
}

export interface RetencaoPorContrato {
  contratoId: string;
  total: number;
  porImposto: Record<CampoImposto, number>;
  notas: number;
}

/** Total retido por contrato (maior primeiro). Cancelada/Substituída fica de fora, como em todos os totais. Contratos sem retenção não aparecem. */
export function retencoesPorContrato<T extends NfParaTotais>(linhas: T[]): RetencaoPorContrato[] {
  const mapa = new Map<string, RetencaoPorContrato>();
  for (const n of linhas) {
    if (naoContabilizaKpi(n)) continue;
    const total = retencoesDaNf(n);
    if (total === 0) continue;
    let r = mapa.get(n.contrato_id);
    if (!r) {
      r = { contratoId: n.contrato_id, total: 0, notas: 0, porImposto: { issqn_total: 0, inss_total: 0, ir_total: 0, cofins_total: 0, pis_total: 0, csll_total: 0 } };
      mapa.set(n.contrato_id, r);
    }
    r.total += total;
    r.notas += 1;
    for (const i of IMPOSTOS_RETIDOS) r.porImposto[i.campo] += n[i.campo] ?? 0;
  }
  const out = [...mapa.values()].map((r) => ({
    ...r,
    total: r2(r.total),
    porImposto: Object.fromEntries(IMPOSTOS_RETIDOS.map((i) => [i.campo, r2(r.porImposto[i.campo])])) as Record<CampoImposto, number>,
  }));
  return out.sort((a, b) => b.total - a.total);
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
  // SIS-2026-0794: o que entrou na conta vinculada e o que ainda falta (soma das pendências por nota, nunca negativa).
  contaVinculadaRecebida: number;
  pendenciaContaVinculada: number;
  recebido: number;
  pendente: number;
  // SIS-2026-0819: soma dos impostos retidos (ISSQN, INSS, IR, COFINS, PIS, CSLL) nas notas das linhas filtradas.
  retencoes: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function totaisDoRelatorio<T extends NfParaTotais>(
  linhas: T[],
  executavelDoContratoMes: (contratoId: string, anoMes: string) => number,
  pendenteDaNf: (nf: T) => number,
): TotaisRelatorio {
  let executado = 0, faturado = 0, liquido = 0, contaVinculada = 0, contaVinculadaRecebida = 0, pendenciaCv = 0, recebido = 0, pendente = 0, retencoes = 0;
  // Só nota Código N é lançamento (mesmo critério do Controle de Faturamento); o executável de cada contrato/mês entra uma vez.
  const paresExecutavel = new Set<string>();
  for (const n of linhas) {
    if (naoContabilizaKpi(n)) continue;
    executado += n.valor_contrato_exec_total || 0;
    faturado += n.vlr_bruto_total || 0;
    liquido += n.vlr_liquido_total || 0;
    contaVinculada += n.desconto_conta_vinculada || 0;
    contaVinculadaRecebida += n.conta_vinculada_valor_recebido || 0;
    pendenciaCv += pendenciaContaVinculada(n);
    recebido += n.valor_pago ?? 0;
    pendente += pendenteDaNf(n);
    retencoes += retencoesDaNf(n);
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
    contaVinculadaRecebida: r2(contaVinculadaRecebida),
    pendenciaContaVinculada: r2(pendenciaCv),
    recebido: r2(recebido),
    pendente: r2(pendente),
    retencoes: r2(retencoes),
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
