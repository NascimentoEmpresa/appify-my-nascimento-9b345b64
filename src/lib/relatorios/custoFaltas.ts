// =====================================================================
// RELATÓRIOS › CUSTO DAS FALTAS POR CONTRATO (21/10/2026, mig
// 20261021000060). Lógica pura, testada em src/test/custo-faltas.test.ts.
//
// O VALOR: o campo "Faltas" de cada item da nota fiscal (nf_emissao_item.
// faltas) — o desconto que o cliente aplicou porque o posto ficou sem gente.
// Preenchido na emissão da NF; é o mesmo número que o Relatório de Serviços
// soma em Dashboard › Composição dos descontos › Faltas.
//
// QUAIS NOTAS CONTAM: as do Relatório de Serviços — a regra é a de lá
// (foraDoRelatorio + naoContabilizaKpi), importada, não copiada: nota em
// rascunho/enviada ainda não é do relatório, e cancelada/substituída aparece
// mas não soma.
//
// A COMPETÊNCIA é o mês da nota (o mês trabalhado), não o da emissão.
// =====================================================================

import * as XLSX from "xlsx";
import { foraDoRelatorio, naoContabilizaKpi, statusDaNota, type StatusNota } from "@/pages/financeiro/nf-emissao/shared";

// ---- O que a RPC devolve ----------------------------------------------------------

export interface ItemFalta { identificacao: string; faltas: number }
export interface LinhaFaltaDiasNf { item: number | null; posto: string | null; valor_posto: number | null; dias: number }

export interface NotaFaltas {
  id: string;
  numero_nf: string | null;
  /** AAAA-MM */
  competencia: string;
  data_emissao: string | null;
  tipo_nota: string;
  variacao: string | null;
  status: string;
  situacao_site_pmt: string | null;
  situacao_dominio: string | null;
  data_pagamento: string | null;
  valor_pago: number | null;
  contrato_id: string;
  contrato_nome: string;
  contrato_cliente: string | null;
  empresa_id: string | null;
  empresa_nome: string | null;
  valor_contrato_exec_total: number;
  vlr_bruto_total: number;
  faltas: number;
  itens_falta: ItemFalta[];
  faltas_calculo: LinhaFaltaDiasNf[] | null;
}

export interface DadosCustoFaltas { de: string; ate: string; gerado_em: string; notas: NotaFaltas[] }

// ---- Regra das notas -----------------------------------------------------------------

/** A nota entra nas somas do relatório (a mesma regra dos totais do Relatório de Serviços). */
export const notaConta = (n: NotaFaltas) => !foraDoRelatorio(n) && !naoContabilizaKpi(n);

/** Dias de falta informados no cálculo por dias da nota (0 quando a nota não usou). */
export const diasDeFalta = (n: Pick<NotaFaltas, "faltas_calculo">) =>
  (n.faltas_calculo ?? []).reduce((s, l) => s + (Number(l.dias) || 0), 0);

const r2 = (v: number) => Math.round(v * 100) / 100;

// ---- Filtros -----------------------------------------------------------------------

export interface FiltrosCustoFaltas {
  /** AAAA-MM, inclusive. */
  de: string;
  ate: string;
  /** Nomes de contrato (FiltroContratos); vazio = todos. */
  contratos: string[];
  empresa: string | null;      // empresa_id
  tipoNota: string | null;     // N / R / M / DH
  status: StatusNota | null;   // pago / pendente
  /** Só contratos que tiveram falta no período. */
  soComFalta: boolean;
}

export function filtrarNotas(notas: NotaFaltas[], f: FiltrosCustoFaltas): NotaFaltas[] {
  return notas.filter((n) => {
    if (!notaConta(n)) return false;
    if (n.competencia < f.de || n.competencia > f.ate) return false;
    if (f.contratos.length && !f.contratos.includes(n.contrato_nome)) return false;
    if (f.empresa && n.empresa_id !== f.empresa) return false;
    if (f.tipoNota && n.tipo_nota !== f.tipoNota) return false;
    if (f.status && statusDaNota(n) !== f.status) return false;
    return true;
  });
}

// ---- Agrupamentos ------------------------------------------------------------------

export interface LinhaContrato {
  contrato_id: string;
  contrato: string;
  cliente: string | null;
  empresa: string | null;
  faltas: number;
  executado: number;
  faturado: number;
  /** faltas ÷ executado (0–1); null sem executado. */
  pctExecutado: number | null;
  notas: number;
  notasComFalta: number;
  /** Meses (competências) com falta. */
  mesesComFalta: number;
  diasFalta: number;
  /** Falta por competência (AAAA-MM → R$). */
  porMes: Map<string, number>;
}

export function porContrato(notas: NotaFaltas[]): LinhaContrato[] {
  const m = new Map<string, LinhaContrato>();
  for (const n of notas) {
    let l = m.get(n.contrato_id);
    if (!l) {
      l = { contrato_id: n.contrato_id, contrato: n.contrato_nome, cliente: n.contrato_cliente, empresa: n.empresa_nome,
        faltas: 0, executado: 0, faturado: 0, pctExecutado: null, notas: 0, notasComFalta: 0, mesesComFalta: 0, diasFalta: 0, porMes: new Map() };
      m.set(n.contrato_id, l);
    }
    l.faltas += n.faltas;
    l.executado += n.valor_contrato_exec_total;
    l.faturado += n.vlr_bruto_total;
    l.notas++;
    if (n.faltas) { l.notasComFalta++; l.porMes.set(n.competencia, (l.porMes.get(n.competencia) ?? 0) + n.faltas); }
    l.diasFalta += diasDeFalta(n);
  }
  return [...m.values()].map((l) => {
    l.faltas = r2(l.faltas); l.executado = r2(l.executado); l.faturado = r2(l.faturado);
    l.porMes.forEach((v, k) => l.porMes.set(k, r2(v)));
    l.mesesComFalta = [...l.porMes.values()].filter((v) => v !== 0).length;
    l.pctExecutado = l.executado > 0 ? l.faltas / l.executado : null;
    return l;
  });
}

export interface LinhaMes { competencia: string; faltas: number; executado: number; pctExecutado: number | null; contratosComFalta: number; notasComFalta: number }

/** Uma linha por competência do período (também os meses sem nota, com zero). */
export function porMes(notas: NotaFaltas[], de: string, ate: string): LinhaMes[] {
  const meses: string[] = [];
  for (let m = de; m <= ate; m = proximoMes(m)) meses.push(m);
  const acc = new Map(meses.map((c) => [c, { faltas: 0, executado: 0, contratos: new Set<string>(), notas: 0 }]));
  for (const n of notas) {
    const a = acc.get(n.competencia);
    if (!a) continue;
    a.faltas += n.faltas; a.executado += n.valor_contrato_exec_total;
    if (n.faltas) { a.contratos.add(n.contrato_id); a.notas++; }
  }
  return meses.map((c) => {
    const a = acc.get(c)!;
    return { competencia: c, faltas: r2(a.faltas), executado: r2(a.executado), pctExecutado: a.executado > 0 ? a.faltas / a.executado : null, contratosComFalta: a.contratos.size, notasComFalta: a.notas };
  });
}

export interface TotalCustoFaltas { faltas: number; executado: number; pctExecutado: number | null; contratos: number; contratosComFalta: number; notas: number; notasComFalta: number; diasFalta: number }
export function totalCustoFaltas(notas: NotaFaltas[]): TotalCustoFaltas {
  const cs = porContrato(notas);
  const faltas = r2(notas.reduce((s, n) => s + n.faltas, 0));
  const executado = r2(notas.reduce((s, n) => s + n.valor_contrato_exec_total, 0));
  return {
    faltas, executado, pctExecutado: executado > 0 ? faltas / executado : null,
    contratos: cs.length, contratosComFalta: cs.filter((c) => c.faltas !== 0).length,
    notas: notas.length, notasComFalta: notas.filter((n) => n.faltas !== 0).length,
    diasFalta: notas.reduce((s, n) => s + diasDeFalta(n), 0),
  };
}

// ---- Meses -------------------------------------------------------------------------

export function proximoMes(m: string): string {
  const a = +m.slice(0, 4), mm = +m.slice(5, 7);
  return mm === 12 ? `${a + 1}-01` : `${a}-${String(mm + 1).padStart(2, "0")}`;
}
export function somaMeses(m: string, n: number): string {
  const t = +m.slice(0, 4) * 12 + (+m.slice(5, 7) - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
/** Último dia do mês AAAA-MM (para o _ate da RPC). */
export const fimDoMes = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "2026-09" → "set/2026" */
export const rotuloComp = (m: string) => `${MESES[+m.slice(5, 7) - 1]}/${m.slice(0, 4)}`;

// ---- Excel ---------------------------------------------------------------------------

const MOEDA = '"R$" #,##0.00';
const PCT = "0.00%";
const ROTULO_STATUS: Record<StatusNota, string> = { pago: "Pago", pendente: "Pendente", substituida: "Substituída", cancelada: "Cancelada" };
const dataBR = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");

/** Folha com cabeçalho, filtro, largura pelo conteúdo e formato por coluna. */
function folha(cab: string[], linhas: (string | number | null)[][], formatos: Record<number, string> = {}): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([cab, ...linhas]);
  for (let r = 1; r <= linhas.length; r++) for (const [c, z] of Object.entries(formatos)) {
    const cel = ws[XLSX.utils.encode_cell({ r, c: +c })];
    if (cel && typeof cel.v === "number") cel.z = z;
  }
  ws["!cols"] = cab.map((h, c) => ({ wch: Math.min(60, Math.max(h.length, ...linhas.slice(0, 500).map((l) => String(l[c] ?? "").length)) + 2) }));
  if (linhas.length) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: linhas.length, c: cab.length - 1 } }) };
  return ws;
}

export interface DadosPlanilhaCustoFaltas {
  de: string;
  ate: string;
  filtrosTexto: string[];
  /** As notas já filtradas (filtrarNotas). */
  notas: NotaFaltas[];
  /** Mostrar na aba Por contrato só quem teve falta. */
  soComFalta: boolean;
  geradoEm?: Date;
}

export function montarPlanilhaCustoFaltas(d: DadosPlanilhaCustoFaltas): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const t = totalCustoFaltas(d.notas);
  const meses = porMes(d.notas, d.de, d.ate);
  const contratos = porContrato(d.notas).filter((c) => !d.soComFalta || c.faltas !== 0)
    .sort((a, b) => b.faltas - a.faltas || a.contrato.localeCompare(b.contrato, "pt-BR"));

  // Resumo
  const resumo: (string | number | null)[][] = [
    ["Custo das Faltas por Contrato", ""],
    ["Período (competência)", `${rotuloComp(d.de)} a ${rotuloComp(d.ate)}`],
    ["Gerado em", (d.geradoEm ?? new Date()).toLocaleString("pt-BR")],
    ["Filtros", d.filtrosTexto.length ? d.filtrosTexto.join(" · ") : "Nenhum (todos os contratos)"],
    ["", ""],
    ["Total descontado por faltas", t.faltas],
    ["Valor executado das notas", t.executado],
    ["Faltas sobre o executado", t.pctExecutado],
    ["Contratos com falta", `${t.contratosComFalta} de ${t.contratos}`],
    ["Notas com falta", `${t.notasComFalta} de ${t.notas}`],
    ["Dias de falta informados (cálculo por dias)", t.diasFalta],
    ["", ""],
    ["Fonte: campo Faltas dos itens da NF (Financeiro › Relatório de Serviços). Notas em rascunho/enviadas ainda não entram; canceladas e substituídas não somam.", ""],
  ];
  const wsR = XLSX.utils.aoa_to_sheet(resumo);
  resumo.forEach((l, r) => {
    const cel = wsR[XLSX.utils.encode_cell({ r, c: 1 })];
    if (!cel || typeof cel.v !== "number") return;
    if (l[0] === "Total descontado por faltas" || l[0] === "Valor executado das notas") cel.z = MOEDA;
    if (l[0] === "Faltas sobre o executado") cel.z = PCT;
  });
  wsR["!cols"] = [{ wch: 44 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsR, "Resumo");

  // Por contrato
  const cabC = ["Contrato", "Cliente", "Empresa", "Faltas (R$)", "Executado (R$)", "Faltas / executado", "Notas", "Notas com falta", "Meses com falta", "Dias de falta"];
  XLSX.utils.book_append_sheet(wb, folha(cabC, contratos.map((c) => [
    c.contrato, c.cliente ?? "", c.empresa ?? "", c.faltas, c.executado, c.pctExecutado, c.notas, c.notasComFalta, c.mesesComFalta, c.diasFalta || null,
  ]), { 3: MOEDA, 4: MOEDA, 5: PCT }), "Por contrato");

  // Contrato × mês (o valor de cada contrato em cada competência)
  const cabCM = ["Contrato", ...meses.map((m) => rotuloComp(m.competencia)), "Total"];
  const linhasCM = contratos.filter((c) => c.faltas !== 0).map((c) => [c.contrato, ...meses.map((m) => c.porMes.get(m.competencia) ?? null), c.faltas]);
  linhasCM.push(["TOTAL", ...meses.map((m) => m.faltas), t.faltas]);
  XLSX.utils.book_append_sheet(wb, folha(cabCM, linhasCM, Object.fromEntries(cabCM.slice(1).map((_, i) => [i + 1, MOEDA]))), "Contrato x mês");

  // Por mês
  const cabM = ["Competência", "Faltas (R$)", "Executado (R$)", "Faltas / executado", "Contratos com falta", "Notas com falta"];
  XLSX.utils.book_append_sheet(wb, folha(cabM, meses.map((m) => [rotuloComp(m.competencia), m.faltas, m.executado, m.pctExecutado, m.contratosComFalta, m.notasComFalta]),
    { 1: MOEDA, 2: MOEDA, 3: PCT }), "Por mês");

  // Notas com falta (uma linha por item com desconto)
  const cabN = ["Competência", "Contrato", "Empresa", "NF", "Emissão", "Tipo", "Variação", "Situação", "Item / posto", "Faltas do item (R$)", "Faltas da nota (R$)", "Executado da nota (R$)", "Dias de falta (cálculo por dias)"];
  const linhasN: (string | number | null)[][] = [];
  for (const n of [...d.notas].filter((x) => x.faltas !== 0).sort((a, b) => a.competencia.localeCompare(b.competencia) || a.contrato_nome.localeCompare(b.contrato_nome, "pt-BR"))) {
    const itens = n.itens_falta.length ? n.itens_falta : [{ identificacao: "", faltas: n.faltas }];
    itens.forEach((it, i) => linhasN.push([
      rotuloComp(n.competencia), n.contrato_nome, n.empresa_nome ?? "", n.numero_nf ?? "", dataBR(n.data_emissao), n.tipo_nota, n.variacao ?? "",
      ROTULO_STATUS[statusDaNota(n)], it.identificacao, it.faltas, i === 0 ? n.faltas : null, i === 0 ? n.valor_contrato_exec_total : null,
      i === 0 && diasDeFalta(n) ? diasDeFalta(n) : null,
    ]));
  }
  XLSX.utils.book_append_sheet(wb, folha(cabN, linhasN, { 9: MOEDA, 10: MOEDA, 11: MOEDA }), "Notas com falta");
  return wb;
}
