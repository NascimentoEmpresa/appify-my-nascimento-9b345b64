import type { NfEmissaoItemRow, NfEmissaoRow } from "@/hooks/useNfEmissao";
import { foraDoRelatorio, naoContabilizaKpi, valorPendenteNf } from "@/pages/financeiro/nf-emissao/shared";
import { diasDeAtraso, faixaDeAtraso, ORDEM_FAIXAS, vencimentoDaNota, type FaixaAging, type OrigemVencimento } from "./vencimento";

// SIS-2026-0893 (etapa 3) — Recebimentos pendentes: a CARTEIRA em aberto (todas as notas com saldo, qualquer que seja o período), com vencimento, faixa de
// atraso, cliente e contrato. Funções puras. O valor pendente por nota é o MESMO do Relatório de Serviços (valorPendenteNf):
// líquido − pago − desconto de conta vinculada − descontos pós-emissão.

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ContratoParaPendentes { nome: string; cliente: string; prazoPagamento: string | null }

export interface LinhaPendente {
  id: string;
  numero: string;
  empresaId: string;
  contratoId: string;
  contrato: string;
  cliente: string;
  competencia: string;
  emissao: string | null;
  vencimento: string | null;
  origemVencimento: OrigemVencimento | null;
  /** positivo = dias de atraso; ≤ 0 = no prazo; null = sem vencimento */
  atraso: number | null;
  faixa: FaixaAging;
  liquido: number;
  pago: number;
  contaVinculada: number;
  posEmissao: number;
  pendente: number;
}

export function carteiraPendente(
  nfs: NfEmissaoRow[],
  itensPorNf: Map<string, NfEmissaoItemRow[]> | undefined,
  contratos: Map<string, ContratoParaPendentes>,
  filtro: { empresaId: string; contratoId: string },
  referencia: string,
  feriados: ReadonlySet<string> = new Set(),
): LinhaPendente[] {
  const linhas: LinhaPendente[] = [];
  for (const n of nfs) {
    if (foraDoRelatorio(n) || naoContabilizaKpi(n)) continue;
    if (filtro.empresaId && n.empresa_id !== filtro.empresaId) continue;
    if (filtro.contratoId && n.contrato_id !== filtro.contratoId) continue;
    // itens carregados (notas do período) dão o valor exato; fora deles vale a soma pós-emissão que a própria nota guarda
    const itens: { multas_pos_emissao: number; glosas_pos_emissao: number; outros_descontos_pos_emissao: number }[] = itensPorNf?.get(n.id) ?? [{ multas_pos_emissao: Number(n.descontos_pos_emissao_total) || 0, glosas_pos_emissao: 0, outros_descontos_pos_emissao: 0 }];
    const pendente = r2(valorPendenteNf(n, itens));
    if (pendente <= 0.005) continue;
    const c = contratos.get(n.contrato_id);
    const venc = vencimentoDaNota(n, c?.prazoPagamento, feriados);
    const pos = r2(itens.reduce((s, i) => s + (Number(i.multas_pos_emissao) || 0) + (Number(i.glosas_pos_emissao) || 0) + (Number(i.outros_descontos_pos_emissao) || 0), 0));
    linhas.push({
      id: n.id, numero: n.numero_nf ?? "s/n", empresaId: n.empresa_id, contratoId: n.contrato_id, contrato: c?.nome ?? "(contrato não encontrado)", cliente: c?.cliente?.trim() || "(sem cliente)",
      competencia: n.competencia, emissao: n.data_emissao, vencimento: venc?.data ?? null, origemVencimento: venc?.origem ?? null,
      atraso: venc ? diasDeAtraso(venc.data, referencia) : null, faixa: faixaDeAtraso(venc?.data ?? null, referencia),
      liquido: r2(Number(n.vlr_liquido_total) || 0), pago: r2(Number(n.valor_pago) || 0), contaVinculada: r2(Number(n.desconto_conta_vinculada) || 0), posEmissao: pos, pendente,
    });
  }
  return linhas.sort((a, b) => b.pendente - a.pendente);
}

export interface ResumoFaixa { faixa: FaixaAging; qtd: number; valor: number; pct: number }

/** Valor por faixa de atraso, na ordem fixa a vencer → vencidos; `pct` é sobre o total da carteira. */
export function resumoPorFaixa(linhas: LinhaPendente[]): ResumoFaixa[] {
  const total = linhas.reduce((s, l) => s + l.pendente, 0);
  return ORDEM_FAIXAS.map((faixa) => {
    const doGrupo = linhas.filter((l) => l.faixa === faixa);
    const valor = r2(doGrupo.reduce((s, l) => s + l.pendente, 0));
    return { faixa, qtd: doGrupo.length, valor, pct: total > 0 ? valor / total : 0 };
  });
}

export interface GrupoPendente {
  chave: string;
  rotulo: string;
  qtd: number;
  total: number;
  vencido: number;
  porFaixa: Record<FaixaAging, number>;
  linhas: LinhaPendente[];
}

export function agruparPendentes(linhas: LinhaPendente[], por: "cliente" | "contrato"): GrupoPendente[] {
  const mapa = new Map<string, GrupoPendente>();
  for (const l of linhas) {
    const chave = por === "cliente" ? l.cliente : l.contratoId;
    const g = mapa.get(chave) ?? { chave, rotulo: por === "cliente" ? l.cliente : l.contrato, qtd: 0, total: 0, vencido: 0, porFaixa: Object.fromEntries(ORDEM_FAIXAS.map((f) => [f, 0])) as Record<FaixaAging, number>, linhas: [] };
    g.qtd += 1; g.total = r2(g.total + l.pendente); g.porFaixa[l.faixa] = r2(g.porFaixa[l.faixa] + l.pendente);
    if (l.faixa.startsWith("vencido")) g.vencido = r2(g.vencido + l.pendente);
    g.linhas.push(l);
    mapa.set(chave, g);
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total);
}

export interface ComposicaoPendente {
  liquido: number;
  pago: number;
  contaVinculada: number;
  posEmissao: number;
  /** nota paga a maior ou com desconto acima do saldo não gera pendência negativa: o piso de zero por nota */
  ajusteDePisoZero: number;
  pendente: number;
}

/** Composição do valor pendente: líquido − pago − conta vinculada − pós-emissão (+ piso de zero por nota) = pendente. A soma sempre fecha. */
export function composicaoPendente(linhas: LinhaPendente[]): ComposicaoPendente {
  const liquido = r2(linhas.reduce((s, l) => s + l.liquido, 0));
  const pago = r2(linhas.reduce((s, l) => s + l.pago, 0));
  const contaVinculada = r2(linhas.reduce((s, l) => s + l.contaVinculada, 0));
  const posEmissao = r2(linhas.reduce((s, l) => s + l.posEmissao, 0));
  const pendente = r2(linhas.reduce((s, l) => s + l.pendente, 0));
  return { liquido, pago, contaVinculada, posEmissao, ajusteDePisoZero: r2(pendente - (liquido - pago - contaVinculada - posEmissao)), pendente };
}

/** Conciliação com o KPI "Valor Pendente de Recebimento" (notas do recorte de faturamento): KPI + carteira fora do recorte = carteira total. */
export function conciliarComKpi(carteira: LinhaPendente[], idsDoRecorte: ReadonlySet<string>): { doRecorte: number; foraDoRecorte: number; total: number } {
  const doRecorte = r2(carteira.filter((l) => idsDoRecorte.has(l.id)).reduce((s, l) => s + l.pendente, 0));
  const total = r2(carteira.reduce((s, l) => s + l.pendente, 0));
  return { doRecorte, foraDoRecorte: r2(total - doRecorte), total };
}
