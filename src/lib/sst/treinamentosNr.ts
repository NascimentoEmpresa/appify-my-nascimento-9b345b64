// =====================================================================
// SST › Treinamentos Obrigatórios (NR) (SIS-2026-0816, mig 20261121100000).
// Testado em src/test/sst-treinamentos-nr.test.ts.
//
// Duas planilhas do setor viram duas tabelas:
//   · "Plano_Treinamentos_Empresas" — a MATRIZ: por contrato e função, o
//     treinamento obrigatório, a base legal, a periodicidade e a data do
//     último. Uma aba por empresa (HAGG, SN, NH, CANAA). O status (em dia /
//     próximo / vencido / pendente) é calculado, nunca gravado — a mesma
//     régua de sst_trn_status no banco, com o aviso de 30 dias da planilha.
//   · "CRONOGRAMA DE TREINAMENTOS" — as TURMAS presenciais: data, contrato,
//     funções, NRs, participantes e o custo do coffee/material. Linha sem
//     nº é a mesma turma em outro contrato (herda o nº e a data de cima).
// =====================================================================

import * as XLSX from "xlsx";
import { dataPlanilha, normNome } from "@/lib/sst/asoHistorico";
import { fmtData, hojeIso } from "@/lib/sst/exameToxicologico";

export { fmtData, hojeIso };

export const DIAS_AVISO_TRN = 30;

export type StatusTrn = "em_dia" | "proximo" | "vencido" | "pendente";
export const ROTULO_STATUS_TRN: Record<StatusTrn, string> = {
  em_dia: "Em dia", proximo: "Próximo do vencimento", vencido: "Vencido", pendente: "Pendente (sem registro)",
};
export const COR_STATUS_TRN: Record<StatusTrn, string> = {
  em_dia: "bg-emerald-100 text-emerald-800 border-emerald-200",
  proximo: "bg-amber-100 text-amber-800 border-amber-200",
  vencido: "bg-red-100 text-red-800 border-red-200",
  pendente: "bg-slate-100 text-slate-700 border-slate-200",
};

export const EMPRESAS_TRN = ["HAGG", "SN", "NH", "CANAÃ"] as const;

export interface Obrigatorio {
  id: number;
  empresa: string | null;
  contrato_texto: string;
  contrato_id: string | null;
  contrato_nome: string | null;
  funcoes: string | null;
  treinamento: string;
  base_legal: string | null;
  periodicidade_meses: number | null;
  ultimo_treinamento: string | null;
  validade: string | null;
  status: StatusTrn;
  observacoes: string | null;
  ativo: boolean;
  origem: "manual" | "planilha";
  updated_at: string;
}

export interface Turma {
  id: number;
  numero: number | null;
  empresa: string | null;
  contrato_texto: string;
  contrato_id: string | null;
  contrato_nome: string | null;
  funcoes: string | null;
  nrs: string | null;
  tema: string | null;
  data: string | null;
  participantes: number | null;
  custo: number | null;
  instrutor: string | null;
  local: string | null;
  observacoes: string | null;
  cancelada: boolean;
  origem: "manual" | "planilha";
}

/** Soma meses a uma data ISO, como o `date + interval` do Postgres (31/01 + 1 mês = 28/02). */
export function somarMesesIso(data: string, meses: number): string {
  const [a, m, d] = data.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

const somarDias = (data: string, dias: number): string => {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

/** Espelho de sst_trn_status. Sem periodicidade = vale enquanto houver a data. */
export function statusObrigatorio(ultimo: string | null, meses: number | null, hoje = hojeIso(), aviso = DIAS_AVISO_TRN): StatusTrn {
  if (!ultimo) return "pendente";
  if (meses == null) return "em_dia";
  const validade = somarMesesIso(ultimo, meses);
  if (validade < hoje) return "vencido";
  if (validade <= somarDias(hoje, aviso)) return "proximo";
  return "em_dia";
}

export const validadeObrigatorio = (ultimo: string | null, meses: number | null): string | null =>
  ultimo && meses != null ? somarMesesIso(ultimo, meses) : null;

/** As NRs citadas num texto: "NR-01, NR06,NR 17-NR-31" → ["NR-01", "NR-06", "NR-17", "NR-31"]. */
export function nrsDoTexto(t: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of String(t ?? "").toUpperCase().matchAll(/\bN\s*-?\s*R?\s*-?\s*(\d{1,2})\b/g)) {
    // "N-12" (erro de digitação da planilha) também é NR.
    const nr = `NR-${m[1].padStart(2, "0")}`;
    if (!out.includes(nr)) out.push(nr);
  }
  return out;
}

export interface ContagemTrn { total: number; em_dia: number; proximo: number; vencido: number; pendente: number }
export function contarObrigatorios(lista: Pick<Obrigatorio, "status" | "ativo">[]): ContagemTrn {
  const c: ContagemTrn = { total: 0, em_dia: 0, proximo: 0, vencido: 0, pendente: 0 };
  for (const o of lista) {
    if (!o.ativo) continue;
    c.total++;
    c[o.status]++;
  }
  return c;
}

/** Turma realizada = tem data até hoje e não foi cancelada; com data futura é prevista. */
export function situacaoTurma(t: Pick<Turma, "data" | "cancelada">, hoje = hojeIso()): "realizada" | "prevista" | "sem_data" | "cancelada" {
  if (t.cancelada) return "cancelada";
  if (!t.data) return "sem_data";
  return t.data <= hoje ? "realizada" : "prevista";
}

// ── Leitura das planilhas ────────────────────────────────────────────────
const texto = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const normCab = (v: unknown): string => texto(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const numero = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const t = texto(v).replace(/\./g, "").replace(",", ".");
  return t && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

/** Aba → empresa da matriz ("CANAA" → "CANAÃ"); as de apoio não são empresa. */
export function empresaDaAba(aba: string): string | null {
  const n = normNome(aba);
  if (n === "HAGG" || n === "NASCIMENTO") return "HAGG";
  if (n === "SN") return "SN";
  if (n === "NH") return "NH";
  if (n === "CANAA") return "CANAÃ";
  return null;
}

export interface LinhaPlano {
  chave: string;
  linha: number;
  empresa: string;
  contrato: string;
  funcoes: string | null;
  treinamento: string;
  base_legal: string | null;
  periodicidade_meses: number | null;
  ultimo_treinamento: string | null;
  observacoes: string | null;
}
export interface LeituraPlano { linhas: LinhaPlano[]; abas: { aba: string; empresa: string; linhas: number }[]; avisos: string[] }

/**
 * Lê a matriz. Linha sem contrato nem treinamento é a "sobra" da tabela da
 * planilha (vem com 30/12/1899 e "VENCIDO" calculado) — não entra. As
 * colunas calculadas (Validade, Dias, Status, Alerta) são ignoradas.
 */
export function lerPlanilhaPlano(dados: ArrayBuffer | Uint8Array, hoje = hojeIso()): LeituraPlano {
  const wb = XLSX.read(dados, { type: "array" });
  const linhas: LinhaPlano[] = [];
  const abas: LeituraPlano["abas"] = [];
  const avisos: string[] = [];
  const vistas = new Map<string, number>();
  for (const aba of wb.SheetNames) {
    const empresa = empresaDaAba(aba);
    if (!empresa) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[aba], { header: 1, raw: true, defval: "" });
    const iCab = rows.slice(0, 10).findIndex((r) => r.map(normCab).includes("CONTRATO") && r.map(normCab).some((c) => /^TREINAMENTO/.test(c)));
    if (iCab < 0) continue;
    const cab = rows[iCab].map(normCab);
    const ix = (re: RegExp) => cab.findIndex((c) => re.test(c));
    const c = { contrato: ix(/^CONTRATO$/), funcao: ix(/^FUNC/), trein: ix(/^TREINAMENTO/), base: ix(/^BASE/), per: ix(/^PERIODICIDADE/),
                ult: ix(/^DATA DO ULTIMO/), obs: ix(/^OBSERVA/) };
    const cel = (r: unknown[], i: number) => (i < 0 ? "" : r[i]);
    let n = 0;
    rows.slice(iCab + 1).forEach((r, k) => {
      const linha = iCab + k + 2;
      const contrato = texto(cel(r, c.contrato));
      const treinamento = texto(cel(r, c.trein));
      if (!contrato || !treinamento) return;
      const funcoes = texto(cel(r, c.funcao)) || null;
      let ultimo = dataPlanilha(cel(r, c.ult));
      if (ultimo && ultimo > hoje) { avisos.push(`${aba} linha ${linha}: último treinamento no futuro (${fmtData(ultimo)}) — fica em branco`); ultimo = null; }
      const per = numero(cel(r, c.per));
      const base = `plano:${empresa}:${normNome(contrato)}:${normNome(funcoes)}:${normNome(treinamento)}`;
      const seq = (vistas.get(base) ?? 0) + 1;
      vistas.set(base, seq);
      n++;
      linhas.push({
        chave: `${base}:${seq}`, linha, empresa, contrato, funcoes, treinamento,
        base_legal: texto(cel(r, c.base)) || null,
        periodicidade_meses: per != null && per >= 1 && per <= 120 ? Math.round(per) : null,
        ultimo_treinamento: ultimo,
        observacoes: texto(cel(r, c.obs)) || null,
      });
    });
    abas.push({ aba, empresa, linhas: n });
  }
  if (abas.length === 0) throw new Error("Nenhuma aba de empresa (HAGG, SN, NH, CANAA) com as colunas Contrato e Treinamento Obrigatório.");
  return { linhas, abas, avisos };
}

export interface LinhaCronograma {
  chave: string;
  linha: number;
  numero: number | null;
  empresa: string | null;
  contrato: string;
  funcoes: string | null;
  nrs: string | null;
  data: string | null;
  participantes: number | null;
  custo: number | null;
}
export interface LeituraCronograma { aba: string; linhas: LinhaCronograma[] }

/**
 * Lê o cronograma. Cabeçalho: (nº) | (empresa) | Data da Realização |
 * Contrato | Função | NR | Quantidade de Participantes | e os itens de custo
 * (Comida, Bolacha, Bombons, material impresso, Água, Pó de café, Material
 * para Dinâmica) — o custo da turma é a soma desses itens. A linha de
 * totais do rodapé (sem contrato) não entra.
 */
export function lerPlanilhaCronograma(dados: ArrayBuffer | Uint8Array): LeituraCronograma {
  const wb = XLSX.read(dados, { type: "array" });
  for (const aba of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[aba], { header: 1, raw: true, defval: "" });
    const iCab = rows.slice(0, 10).findIndex((r) => r.map(normCab).includes("CONTRATO") && r.map(normCab).some((c) => /^DATA/.test(c)));
    if (iCab < 0) continue;
    const cab = rows[iCab].map(normCab);
    const ix = (re: RegExp) => cab.findIndex((c) => re.test(c));
    const iData = ix(/^DATA/);
    const iContrato = ix(/^CONTRATO$/);
    const iFuncao = ix(/^FUNC/);
    const iNr = ix(/^NR/);
    const iPart = ix(/PARTICIPANTES/);
    // Itens de custo: as colunas com nome depois de Participantes.
    const iCustos = cab.map((c, i) => ({ c, i })).filter((x) => iPart >= 0 && x.i > iPart && x.c).map((x) => x.i);
    const linhas: LinhaCronograma[] = [];
    const vistas = new Map<string, number>();
    let numeroAtual: number | null = null;
    let dataAtual: string | null = null;
    rows.slice(iCab + 1).forEach((r, k) => {
      const linha = iCab + k + 2;
      const contrato = texto(r[iContrato]);
      if (!contrato) return;
      const nLido = numero(r[0]);
      const continuacao = nLido == null;
      if (!continuacao) { numeroAtual = nLido; dataAtual = null; }
      const dataLida = dataPlanilha(r[iData]);
      const data = dataLida ?? (continuacao ? dataAtual : null);
      if (!continuacao || dataLida) dataAtual = data;
      const custos = iCustos.map((i) => numero(r[i])).filter((v): v is number => v != null && v >= 0);
      const nrs = texto(r[iNr]) || null;
      const base = `crono:${numeroAtual ?? "x"}:${normNome(contrato)}:${normNome(nrs)}`;
      const seq = (vistas.get(base) ?? 0) + 1;
      vistas.set(base, seq);
      const part = numero(r[iPart]);
      linhas.push({
        chave: `${base}:${seq}`, linha, numero: numeroAtual,
        empresa: texto(r[1]).toUpperCase() || null,
        contrato, funcoes: texto(r[iFuncao]) || null, nrs, data,
        participantes: part != null && part >= 0 ? Math.round(part) : null,
        custo: custos.length ? Math.round(custos.reduce((a, b) => a + b, 0) * 100) / 100 : null,
      });
    });
    if (linhas.length) return { aba, linhas };
  }
  throw new Error('Nenhuma aba com as colunas "Data da Realização" e "Contrato" foi encontrada.');
}

export interface ResultadoImportacaoTrn {
  simulado: boolean;
  tipo: "plano" | "cronograma";
  lidas: number;
  recusadas: number;
  novos: number;
  atualizados: number;
  contratos_sem_casar: string[];
}

export interface OnlineResumo {
  obrigatorios: number;
  concluidos: number;
  pendentes: number;
  pessoas: number;
  por_curso: { curso: string; obrigatorios: number; concluidos: number }[];
  por_contrato: { contrato: string; obrigatorios: number; concluidos: number }[];
}

export const pct = (parte: number, total: number): number | null => (total > 0 ? Math.round((100 * parte) / total) : null);
