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

// SIS-2026-0867: descontos de uma nota separados pelo momento em que entram. ANTES da nota = já abatidos no valor emitido (faltas, postos não
// implementados, multas, glosas e outros); DEPOIS = lançados após a emissão (multas, glosas e outros), que não estão no líquido. Só existem por item.
export interface ItemComDescontos {
  faltas?: number | null; posto_nao_implementado?: number | null; multas?: number | null; glosas?: number | null; outros_descontos?: number | null;
  multas_pos_emissao?: number | null; glosas_pos_emissao?: number | null; outros_descontos_pos_emissao?: number | null;
}
export interface DescontosDaNf {
  antes: { faltas: number; postosNaoImplementados: number; multas: number; glosas: number; outros: number; total: number };
  depois: { multas: number; glosas: number; outros: number; total: number };
}
export function descontosDaNf(itens: ItemComDescontos[]): DescontosDaNf {
  const soma = (f: (i: ItemComDescontos) => number | null | undefined) => Math.round(itens.reduce((s, i) => s + (f(i) ?? 0), 0) * 100) / 100;
  const antes = { faltas: soma((i) => i.faltas), postosNaoImplementados: soma((i) => i.posto_nao_implementado), multas: soma((i) => i.multas), glosas: soma((i) => i.glosas), outros: soma((i) => i.outros_descontos) };
  const depois = { multas: soma((i) => i.multas_pos_emissao), glosas: soma((i) => i.glosas_pos_emissao), outros: soma((i) => i.outros_descontos_pos_emissao) };
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    antes: { ...antes, total: r2(antes.faltas + antes.postosNaoImplementados + antes.multas + antes.glosas + antes.outros) },
    depois: { ...depois, total: r2(depois.multas + depois.glosas + depois.outros) },
  };
}

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

// SIS-2026-0952: KPI "Total de Descontos" e seu detalhamento. Uma linha por nota × tipo × classificação (antes/após a NF), só com valor
// diferente de zero. Entram faltas, postos não implementados, multas, glosas e outros (antes) e multas, glosas e outros (após) — os
// mesmos de descontosDaNf. Desconto de conta vinculada NÃO entra: é retenção com KPI próprio. Cancelada/Substituída fora, como todos os KPIs.
export type TipoDesconto = "faltas" | "posto_nao_implementado" | "multas" | "glosas" | "outros";
export type ClassificacaoDesconto = "antes" | "apos";

export const TIPOS_DESCONTO: { tipo: TipoDesconto; rotulo: string }[] = [
  { tipo: "faltas", rotulo: "Faltas" },
  { tipo: "posto_nao_implementado", rotulo: "Posto não implementado" },
  { tipo: "multas", rotulo: "Multa" },
  { tipo: "glosas", rotulo: "Glosa" },
  { tipo: "outros", rotulo: "Outros descontos" },
];
export const ROTULO_CLASSIFICACAO: Record<ClassificacaoDesconto, string> = { antes: "Antes da NF", apos: "Após a NF" };

export interface LinhaDesconto {
  nfId: string;
  empresaId: string;
  contratoId: string;
  competencia: string;
  dataEmissao: string | null;
  numeroNf: string | null;
  tipo: TipoDesconto;
  classificacao: ClassificacaoDesconto;
  valor: number;
}

type NfParaDescontos = NfParaTotais & { id: string; empresa_id: string; data_emissao?: string | null; numero_nf?: string | null };

export function linhasDeDesconto(nfs: NfParaDescontos[], itensPorNf: Map<string, ItemComDescontos[]> | undefined): LinhaDesconto[] {
  const out: LinhaDesconto[] = [];
  for (const n of nfs) {
    if (naoContabilizaKpi(n)) continue;
    const itens = itensPorNf?.get(n.id);
    if (!itens || itens.length === 0) continue;
    const d = descontosDaNf(itens);
    const base = { nfId: n.id, empresaId: n.empresa_id, contratoId: n.contrato_id, competencia: n.competencia, dataEmissao: n.data_emissao ?? null, numeroNf: n.numero_nf ?? null };
    const valores: [TipoDesconto, ClassificacaoDesconto, number][] = [
      ["faltas", "antes", d.antes.faltas],
      ["posto_nao_implementado", "antes", d.antes.postosNaoImplementados],
      ["multas", "antes", d.antes.multas],
      ["glosas", "antes", d.antes.glosas],
      ["outros", "antes", d.antes.outros],
      ["multas", "apos", d.depois.multas],
      ["glosas", "apos", d.depois.glosas],
      ["outros", "apos", d.depois.outros],
    ];
    for (const [tipo, classificacao, valor] of valores) if (valor !== 0) out.push({ ...base, tipo, classificacao, valor });
  }
  return out;
}

export interface ResumoDescontos {
  total: number;
  antes: number;
  apos: number;
  porTipo: { tipo: TipoDesconto; antes: number; apos: number; total: number }[];
  porContrato: { contratoId: string; empresaId: string; notas: number; antes: number; apos: number; total: number }[];
}

export function resumoDescontos(linhas: LinhaDesconto[]): ResumoDescontos {
  const tipos = new Map(TIPOS_DESCONTO.map((t) => [t.tipo, { tipo: t.tipo, antes: 0, apos: 0, total: 0 }]));
  const contratos = new Map<string, { contratoId: string; empresaId: string; notas: Set<string>; antes: number; apos: number; total: number }>();
  let antes = 0, apos = 0;
  for (const l of linhas) {
    const t = tipos.get(l.tipo)!;
    t[l.classificacao] += l.valor;
    t.total += l.valor;
    let c = contratos.get(l.contratoId);
    if (!c) { c = { contratoId: l.contratoId, empresaId: l.empresaId, notas: new Set(), antes: 0, apos: 0, total: 0 }; contratos.set(l.contratoId, c); }
    c.notas.add(l.nfId);
    c[l.classificacao] += l.valor;
    c.total += l.valor;
    if (l.classificacao === "antes") antes += l.valor; else apos += l.valor;
  }
  return {
    total: r2(antes + apos),
    antes: r2(antes),
    apos: r2(apos),
    porTipo: [...tipos.values()].map((t) => ({ ...t, antes: r2(t.antes), apos: r2(t.apos), total: r2(t.total) })),
    porContrato: [...contratos.values()]
      .map((c) => ({ contratoId: c.contratoId, empresaId: c.empresaId, notas: c.notas.size, antes: r2(c.antes), apos: r2(c.apos), total: r2(c.total) }))
      .sort((a, b) => b.total - a.total),
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
