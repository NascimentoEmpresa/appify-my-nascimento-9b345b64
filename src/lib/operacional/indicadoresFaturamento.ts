// =====================================================================
// Operacional › Indicadores › 2. FATURAMENTO E RECEBIMENTOS (09/11/2026)
//
// Mesma base de Controladoria › Faturamento da Empresa: notas válidas
// (agruparFaturamento), Valor Bruto, Líquido, Recebido e A Receber como lá.
// O que a tela de origem não tem, e o que é estimado:
//   · vencimento = emissão + 30 dias (a NF não guarda vencimento próprio, a
//     mesma regra do Painel Executivo): aging e inadimplência são PARCIAIS;
//   · PMR = média de dias entre emissão e pagamento das notas da competência
//     já pagas;
//   · % faturado no prazo: o ERP não registra prazo de faturamento (sem fonte).
// =====================================================================
import {
  agruparFaturamento, aReceberDaNf, notaValidaNoFaturamento, totaisVazios, type NfFaturamento, type TotaisFaturamento,
} from "@/pages/controladoria/faturamento/regras";
import { dozeMeses } from "./painelPeloFaturamento";

export type NfComDatas = NfFaturamento & { data_emissao?: string | null };

export interface ContratoRotulo { nome: string; cliente: string | null }

export interface FaixaAging { nome: string; valor: number }

export interface LinhaTabela extends TotaisFaturamento { chave: string; nome: string }

export interface DadosFaturamento {
  atual: TotaisFaturamento;
  anterior: TotaisFaturamento;
  pmr: number | null;
  pmrAnterior: number | null;
  /** Posição de HOJE de todas as notas em aberto, por faixa de atraso. */
  aging: FaixaAging[];
  vencido90: number;
  serie: { competencia: string; bruto: number; recebido: number; aReceber: number }[];
  porContrato: LinhaTabela[];
  porCliente: LinhaTabela[];
  /** Competência mais nova com nota (para abrir a tela nela). */
  ultimaComNota: string | null;
}

const DIA = 86_400_000;
const dias = (de: string, ate: string) => Math.round((Date.parse(ate.slice(0, 10)) - Date.parse(de.slice(0, 10))) / DIA);

function mesAnterior(c: string): string {
  const [a, m] = c.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

function pmrDo(nfs: NfComDatas[]): number | null {
  const prazos = nfs
    .filter((n) => n.data_emissao && n.data_pagamento)
    .map((n) => dias(n.data_emissao!, n.data_pagamento!))
    .filter((d) => d >= 0);
  return prazos.length ? Math.round(prazos.reduce((s, d) => s + d, 0) / prazos.length) : null;
}

export const FAIXAS_AGING = ["A vencer", "1 a 30 dias", "31 a 60 dias", "61 a 90 dias", "> 90 dias"] as const;

/** Faixa de uma nota em aberto pelo atraso em dias (vencimento = emissão + 30). */
export function faixaDoAtraso(atraso: number): typeof FAIXAS_AGING[number] {
  if (atraso <= 0) return "A vencer";
  if (atraso <= 30) return "1 a 30 dias";
  if (atraso <= 60) return "31 a 60 dias";
  if (atraso <= 90) return "61 a 90 dias";
  return "> 90 dias";
}

export function montarFaturamento(nfsTodas: NfComDatas[], contratos: Map<string, ContratoRotulo>, competencia: string, hojeIso: string): DadosFaturamento {
  const nfs = nfsTodas.filter((n) => contratos.has(n.contrato_id));
  const porMes = agruparFaturamento(nfs, (n) => n.competencia.slice(0, 7));
  const doMes = (c: string) => nfs.filter((n) => n.competencia.startsWith(c));
  const ant = mesAnterior(competencia);

  // Mesmo corte do agruparFaturamento (sem cancelada/substituída) para aging e PMR.
  const validas = new Set(nfs.filter(notaValidaNoFaturamento));
  const aging = new Map<string, number>(FAIXAS_AGING.map((f) => [f, 0]));
  for (const n of validas) {
    const aberto = aReceberDaNf(n);
    if (aberto <= 0 || !n.data_emissao) continue;
    const f = faixaDoAtraso(dias(n.data_emissao, hojeIso) - 30);
    aging.set(f, (aging.get(f) ?? 0) + aberto);
  }

  const linhas = (mapa: Map<string, TotaisFaturamento>, nome: (k: string) => string): LinhaTabela[] =>
    [...mapa.entries()].map(([chave, t]) => ({ ...t, chave, nome: nome(chave) })).sort((a, b) => b.liquido - a.liquido);
  const doMesValidas = doMes(competencia).filter((n) => validas.has(n));

  return {
    atual: porMes.get(competencia) ?? totaisVazios(),
    anterior: porMes.get(ant) ?? totaisVazios(),
    pmr: pmrDo(doMesValidas),
    pmrAnterior: pmrDo(doMes(ant).filter((n) => validas.has(n))),
    aging: FAIXAS_AGING.map((nome) => ({ nome, valor: Math.round((aging.get(nome) ?? 0) * 100) / 100 })),
    vencido90: Math.round((aging.get("> 90 dias") ?? 0) * 100) / 100,
    serie: dozeMeses(competencia).map((c) => {
      const t = porMes.get(c) ?? totaisVazios();
      return { competencia: c, bruto: t.bruto, recebido: t.recebido, aReceber: t.aReceber };
    }),
    porContrato: linhas(agruparFaturamento(doMesValidas, (n) => n.contrato_id), (k) => contratos.get(k)?.nome ?? k),
    porCliente: linhas(agruparFaturamento(doMesValidas, (n) => contratos.get(n.contrato_id)?.cliente || "(sem cliente)"), (k) => k),
    ultimaComNota: [...porMes.entries()].filter(([c, t]) => t.notas > 0 && c <= hojeIso.slice(0, 7)).map(([c]) => c).sort().pop() ?? null,
  };
}
