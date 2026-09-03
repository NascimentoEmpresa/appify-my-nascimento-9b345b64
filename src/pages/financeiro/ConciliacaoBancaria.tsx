import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import {
  Upload, FileText, X, Play, Download,
  CheckCircle2, Info, ChevronDown, ChevronUp,
  GitMerge, RefreshCw,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── Tipos ──────────────────────────────────────────────────────────────────

type TipoLancamento = "ENTRADA" | "SAÍDA" | "INDEFINIDO";

interface OFXTransaction {
  dia: string;   // YYYY-MM-DD
  valor: number; // abs
  tipo: "ENTRADA" | "SAÍDA";
  memo: string;
  origem: string;
}

interface PlanilhaRow {
  dia: string;
  valor: number;
  tipo: TipoLancamento;
  banco: string;
}

interface DiaSummary {
  dia: string;        // dd/mm/yyyy
  diaISO: string;     // YYYY-MM-DD
  totalPlanilha: number;
  totalExtrato: number;
  diferenca: number;
  status: "OK" | "DIVERGENTE";
}

interface AuditRow {
  dia: string;
  erro: "⚠️ BANCO - NÃO ENCONTRADO" | "🚨 FLUXO - NÃO ENCONTRADO" | "🔍 VALOR SIMILAR" | "❌ TIPO DIVERGENTE";
  valor: number;
  qtd: number;
  total: number;
  detalhe: string;
  origem: string;
  tipoOFX?: "ENTRADA" | "SAÍDA";
  tipoPlanilha?: TipoLancamento;
}

interface Suspeito {
  planilhaValor: number;
  bancoValor: number;
  diferenca: number;
  bancoHistorico: string;
  bancoOrigem: string;
  confianca: "ALTA" | "MEDIA";
}

interface LancamentoRow {
  dia: string;
  erro: AuditRow["erro"];
  valor: number;
  detalhe: string;
  origem: string;
  tipoOFX?: "ENTRADA" | "SAÍDA";
  tipoPlanilha?: TipoLancamento;
}

interface ReconciliacaoResult {
  resumo: DiaSummary[];
  auditoria: AuditRow[];
  lancamentos: LancamentoRow[];
  suspeitos: Record<string, Suspeito[]>;
  divergencias: number;
  totalDias: number;
  diasOk: number;
  eficiencia: number;
  volFluxo: number;
  volBanco: number;
  saldoTotal: number;
}

// ── Constantes ─────────────────────────────────────────────────────────────

const MEMOS_IGNORAR = ["RENDE FACIL", "BB RENDE", "RENDE F"];

// ── Parser OFX ─────────────────────────────────────────────────────────────

function parseOFX(text: string, origem: string): OFXTransaction[] {
  const txns: OFXTransaction[] = [];
  const regex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const block = m[1];
    const dt  = block.match(/<DTPOSTED>(\d{8})/)?.[1];
    const amt = block.match(/<TRNAMT>([-\d.]+)/)?.[1];
    const memo = (block.match(/<MEMO>([^\n<\r]*)/)?.[1] ?? "").trim();
    const name = (block.match(/<NAME>([^\n<\r]*)/)?.[1] ?? "").trim();
    if (!dt || !amt) continue;
    const hist = memo || name;
    const upper = hist.toUpperCase();
    if (MEMOS_IGNORAR.some((t) => upper.includes(t))) continue;
    const rawAmt = parseFloat(amt);
    txns.push({
      dia: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`,
      valor: Math.abs(rawAmt),
      tipo: rawAmt >= 0 ? "ENTRADA" : "SAÍDA",
      memo: hist,
      origem,
    });
  }
  return txns;
}

// ── Parser Excel (planilha mestre) ─────────────────────────────────────────

function parsePlanilha(buffer: ArrayBuffer): PlanilhaRow[] {
  const wb   = XLSX.read(buffer, { type: "array", cellDates: true });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const raw  = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 }) as unknown[][];

  let colData = -1, colValor = -1, colBanco = -1, colTipo = -1, startRow = 0;

  for (let i = 0; i < Math.min(raw.length, 20); i++) {
    const cells = raw[i].map((c) => String(c ?? "").toUpperCase().trim());
    if (cells.includes("DATA") && cells.includes("VALOR")) {
      colData  = cells.findIndex((c) => c.includes("DATA"));
      colValor = cells.findIndex((c) => c === "VALOR");
      colBanco = cells.findIndex((c) => c.includes("BANCO") || c.includes("CONTA"));
      colTipo  = cells.findIndex((c) => c === "TIPO" || c.includes("NATUREZA") || c === "D/C" || c === "DC");
      startRow = i + 1;
      break;
    }
  }
  if (colData === -1 || colValor === -1) return [];

  const rows: PlanilhaRow[] = [];
  for (let i = startRow; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    const rawDate = row[colData];
    const rawVal  = row[colValor];
    if (!rawDate || rawVal == null) continue;

    let dt: Date | null = null;
    if (rawDate instanceof Date) {
      dt = rawDate;
    } else {
      const s = String(rawDate).trim();
      // DD/MM/YYYY ou DD-MM-YYYY
      const brMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (brMatch) {
        dt = new Date(Number(brMatch[3]), Number(brMatch[2]) - 1, Number(brMatch[1]));
      } else {
        const parsed = new Date(s);
        if (!isNaN(parsed.getTime())) dt = parsed;
      }
    }
    if (!dt || isNaN(dt.getTime())) continue;

    // Se já é number (XLSX retorna números como floats JS), usar diretamente.
    // Não converter para string pois o regex removeria o ponto decimal.
    let val: number;
    if (typeof rawVal === "number") {
      val = rawVal;
    } else {
      // Formato texto BR: "R$ 1.234,56" → remover R$, espaços e pontos-mil, trocar vírgula decimal
      const s = String(rawVal).replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
      val = parseFloat(s);
    }
    if (isNaN(val) || val === 0) continue;

    let tipo: TipoLancamento = "INDEFINIDO";
    if (colTipo >= 0) {
      const t = String(row[colTipo] ?? "").toUpperCase().trim();
      if (t.includes("ENTRADA") || t === "E" || t === "C" || t.includes("CRED")) tipo = "ENTRADA";
      else if (t.includes("SA") || t === "S" || t === "D" || t.includes("DEB")) tipo = "SAÍDA";
    }

    const dia = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    const banco = colBanco >= 0 ? String(row[colBanco] ?? "").trim() : "";
    rows.push({ dia, valor: Math.abs(val), tipo, banco });
  }
  return rows;
}

// ── Motor de conciliação ───────────────────────────────────────────────────

function reconciliar(
  planRows: PlanilhaRow[],
  ofxTrns: OFXTransaction[]
): ReconciliacaoResult {
  const toFmt = (iso: string) =>
    `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

  const diasSet = new Set([
    ...planRows.map((r) => r.dia),
    ...ofxTrns.map((t) => t.dia),
  ]);
  const dias = Array.from(diasSet).sort();

  const planByDay: Record<string, PlanilhaRow[]>  = {};
  const ofxByDay:  Record<string, OFXTransaction[]> = {};
  for (const d of dias) {
    planByDay[d] = planRows.filter((r) => r.dia === d);
    ofxByDay[d]  = ofxTrns.filter((t) => t.dia === d);
  }

  const planTotais: Record<string, number> = {};
  const ofxTotais:  Record<string, number> = {};
  for (const d of dias) {
    planTotais[d] = Math.round(planByDay[d].reduce((s, r) => s + r.valor, 0) * 100) / 100;
    ofxTotais[d]  = Math.round(ofxByDay[d].reduce((s, t) => s + t.valor, 0) * 100) / 100;
  }

  const resumo: DiaSummary[] = dias.map((d) => {
    const diff = Math.round((planTotais[d] - ofxTotais[d]) * 100) / 100;
    return {
      dia: toFmt(d),
      diaISO: d,
      totalPlanilha: planTotais[d],
      totalExtrato: -ofxTotais[d],
      diferenca: diff,
      status: Math.abs(diff) < 0.005 ? "OK" : "DIVERGENTE",
    };
  });

  // ── Auditoria item-a-item ──────────────────────────────────────────────
  const rawAudit: Array<Omit<AuditRow, "qtd" | "total">> = [];

  for (const dia of dias) {
    const planItens = planByDay[dia].map((r) => ({ ...r }));
    const ofxItens  = ofxByDay[dia].map((t) => ({ ...t }));

    const ofxSobra  = [...ofxItens];
    const planSobra: PlanilhaRow[] = [];

    // 1ª passagem — match exato: valor com tolerância float + tipo compatível
    for (const p of planItens) {
      const pv = Math.round(p.valor * 100) / 100;

      // Tenta match com valor E tipo corretos
      const idxExato = ofxSobra.findIndex(
        (e) => Math.abs(Math.round(e.valor * 100) / 100 - pv) < 0.005 &&
                (p.tipo === "INDEFINIDO" || e.tipo === p.tipo)
      );
      if (idxExato >= 0) { ofxSobra.splice(idxExato, 1); continue; }

      // Valor bate mas tipo está errado → TIPO DIVERGENTE
      const idxTipoErrado = p.tipo !== "INDEFINIDO"
        ? ofxSobra.findIndex(
            (e) => Math.abs(Math.round(e.valor * 100) / 100 - pv) < 0.005 && e.tipo !== p.tipo
          )
        : -1;
      if (idxTipoErrado >= 0) {
        const e = ofxSobra[idxTipoErrado];
        rawAudit.push({
          dia: toFmt(dia),
          erro: "❌ TIPO DIVERGENTE",
          valor: pv,
          detalhe: `Fluxo: ${p.tipo} | Banco: ${e.tipo} | ${e.memo.slice(0, 50)}`,
          origem: p.banco,
          tipoOFX: e.tipo,
          tipoPlanilha: p.tipo,
        });
        ofxSobra.splice(idxTipoErrado, 1);
        continue;
      }

      planSobra.push(p);
    }

    // 2ª passagem — near-match (mesmo lançamento, valor ligeiramente diferente)
    const extSemMatch = [...ofxSobra];
    const planSemMatch: PlanilhaRow[] = [];

    for (const p of planSobra) {
      const pv = Math.round(p.valor * 100) / 100;
      let bestIdx = -1, bestDiff = Infinity;

      extSemMatch.forEach((e, i) => {
        const ev   = Math.round(e.valor * 100) / 100;
        const diff = Math.abs(pv - ev);
        const ref  = Math.max(pv, ev) || 1;
        if (diff > 0 && diff <= 200 && diff / ref <= 0.05 && diff < bestDiff) {
          bestDiff = diff; bestIdx = i;
        }
      });

      if (bestIdx >= 0) {
        const ev    = Math.round(extSemMatch[bestIdx].valor * 100) / 100;
        const eItem = extSemMatch[bestIdx];
        const sinal = pv > ev ? `+R$ ${(pv - ev).toFixed(2)}` : `-R$ ${(ev - pv).toFixed(2)}`;
        const tipoInfo = p.tipo !== "INDEFINIDO" ? ` | Fluxo: ${p.tipo} / Banco: ${eItem.tipo}` : "";
        rawAudit.push({
          dia: toFmt(dia),
          erro: "🔍 VALOR SIMILAR",
          valor: pv,
          detalhe: `Planilha: R$ ${fmt(pv)} | Banco: R$ ${fmt(ev)} | Diff: ${sinal}${tipoInfo}`,
          origem: p.banco,
          tipoOFX: eItem.tipo,
          tipoPlanilha: p.tipo,
        });
        extSemMatch.splice(bestIdx, 1);
      } else {
        planSemMatch.push(p);
      }
    }

    for (const p of planSemMatch)
      rawAudit.push({ dia: toFmt(dia), erro: "⚠️ BANCO - NÃO ENCONTRADO", valor: Math.round(p.valor * 100) / 100, detalhe: `Faltou cair na conta`, origem: p.banco, tipoPlanilha: p.tipo });
    for (const e of extSemMatch)
      rawAudit.push({ dia: toFmt(dia), erro: "🚨 FLUXO - NÃO ENCONTRADO", valor: Math.round(e.valor * 100) / 100, detalhe: e.memo, origem: e.origem, tipoOFX: e.tipo });
  }

  // Agrupar linhas idênticas (TIPO DIVERGENTE não agrupa — cada par é único)
  const aggMap = new Map<string, AuditRow>();
  for (const r of rawAudit) {
    if (r.erro === "❌ TIPO DIVERGENTE") {
      aggMap.set(`${r.dia}||${r.erro}||${r.detalhe}||${Math.random()}`, { ...r, qtd: 1, total: r.valor });
      continue;
    }
    const key = `${r.dia}||${r.erro}||${r.detalhe}||${r.valor}||${r.origem}`;
    if (aggMap.has(key)) {
      const existing = aggMap.get(key)!;
      existing.qtd   += 1;
      existing.total  = Math.round(existing.valor * existing.qtd * 100) / 100;
    } else {
      aggMap.set(key, { ...r, qtd: 1, total: r.valor });
    }
  }

  // Remover auditoria de dias OK
  const diasOkSet = new Set(resumo.filter((r) => r.status === "OK").map((r) => r.dia));
  const auditoria = Array.from(aggMap.values())
    .filter((r) => !diasOkSet.has(r.dia))
    .sort((a, b) => a.dia.localeCompare(b.dia) || b.total - a.total);

  // Lista por lançamento (não agrupada, sem dias OK)
  const lancamentos: LancamentoRow[] = rawAudit
    .filter((r) => !diasOkSet.has(r.dia))
    .sort((a, b) => a.dia.localeCompare(b.dia) || b.valor - a.valor);

  // ── Motor detetive ────────────────────────────────────────────────────
  const suspeitos: Record<string, Suspeito[]> = {};
  for (const s of resumo.filter((r) => r.status === "DIVERGENTE")) {
    const dia = s.diaISO;
    const divergencia = s.diferenca;
    const planItens = planByDay[dia].map((r) => ({ ...r }));
    const ofxItens  = ofxByDay[dia].map((t) => ({ ...t }));

    const ofxSobra  = [...ofxItens];
    const planSobra: PlanilhaRow[] = [];
    for (const p of planItens) {
      const pv  = Math.round(p.valor * 100) / 100;
      const idx = ofxSobra.findIndex(
        (e) => Math.abs(Math.round(e.valor * 100) / 100 - pv) < 0.005
      );
      if (idx >= 0) ofxSobra.splice(idx, 1);
      else planSobra.push(p);
    }

    const lista: Suspeito[] = [];
    for (const p of planSobra) {
      for (const e of ofxSobra) {
        const diff = Math.round((p.valor - e.valor) * 100) / 100;
        if (Math.abs(diff) <= 2.0) {
          const alta = Math.abs(Math.abs(diff) - Math.abs(Math.round(divergencia * 100) / 100)) < 0.005;
          lista.push({
            planilhaValor: Math.round(p.valor * 100) / 100,
            bancoValor:    Math.round(e.valor * 100) / 100,
            diferenca: diff,
            bancoHistorico: e.memo.slice(0, 60),
            bancoOrigem: e.origem,
            confianca: alta ? "ALTA" : "MEDIA",
          });
        }
      }
    }
    lista.sort((a, b) => (a.confianca === "ALTA" ? -1 : 1) - (b.confianca === "ALTA" ? -1 : 1));
    if (lista.length) suspeitos[s.dia] = lista.slice(0, 10);
  }

  const totalDias = resumo.length;
  const diasOk    = resumo.filter((r) => r.status === "OK").length;

  return {
    resumo,
    auditoria,
    lancamentos,
    suspeitos,
    divergencias: resumo.filter((r) => r.status === "DIVERGENTE").length,
    totalDias,
    diasOk,
    eficiencia: totalDias > 0 ? Math.round((diasOk / totalDias) * 1000) / 10 : 100,
    volFluxo: resumo.reduce((s, r) => s + r.totalPlanilha, 0),
    volBanco: resumo.reduce((s, r) => s + Math.abs(r.totalExtrato), 0),
    saldoTotal: Math.round(resumo.reduce((s, r) => s + r.diferenca, 0) * 100) / 100,
  };
}

// ── Helpers de formatação ──────────────────────────────────────────────────

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtBRL(v: number) {
  return `R$ ${fmt(Math.abs(v))}`;
}

// ── Export Excel ───────────────────────────────────────────────────────────

function exportarExcel(result: ReconciliacaoResult, nomeArquivo: string) {
  const wb = XLSX.utils.book_new();

  const resumoData = [
    ["Dia", "Total Planilha", "Total Extrato", "Diferença", "Status"],
    ...result.resumo.map((r) => [
      r.dia, r.totalPlanilha, r.totalExtrato, r.diferenca, r.status,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumoData), "RESUMO GERAL");

  if (result.auditoria.length) {
    const audData = [
      ["Dia", "Tipo", "Qtd", "Valor (R$)", "Total (R$)", "Detalhe", "Origem"],
      ...result.auditoria.map((r) => [
        r.dia, r.erro, r.qtd, r.valor, r.total, r.detalhe, r.origem,
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(audData), "AUDITORIA");
  }

  XLSX.writeFile(wb, nomeArquivo);
}

// ── Export PDF ─────────────────────────────────────────────────────────────

function exportarPDF(result: ReconciliacaoResult, nomeArquivo: string) {
  const doc  = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W    = doc.internal.pageSize.getWidth();
  const C    = { azul: "#0A1E3C", laranja: "#E67300", cinza: "#5A6473", branco: "#FFFFFF", verde: "#1E7B3A", vermelho: "#B91C1C", info: "#0369A1" };

  // Header
  doc.setFillColor(C.azul);
  doc.rect(0, 0, W, 22, "F");
  doc.setTextColor(C.branco);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("GRUPO NASCIMENTO — CONCILIAÇÃO BANCÁRIA", W / 2, 14, { align: "center" });

  // KPIs
  let y = 30;
  const kpis = [
    { label: "Eficiência", value: `${result.eficiencia}%`, cor: result.eficiencia >= 100 ? C.verde : C.laranja },
    { label: "Divergências", value: String(result.divergencias), cor: result.divergencias === 0 ? C.verde : C.vermelho },
    { label: "Vol. Planilha", value: fmtBRL(result.volFluxo), cor: C.azul },
    { label: "Vol. Banco", value: fmtBRL(result.volBanco), cor: C.azul },
    { label: "Saldo Total", value: fmtBRL(result.saldoTotal), cor: Math.abs(result.saldoTotal) < 0.005 ? C.verde : C.vermelho },
  ];
  const kw = W / kpis.length - 4;
  kpis.forEach((k, i) => {
    const x = 2 + i * (kw + 4);
    doc.setFillColor("#F8FAFC");
    doc.roundedRect(x, y, kw, 18, 2, 2, "F");
    doc.setFontSize(7);
    doc.setTextColor(C.cinza);
    doc.setFont("helvetica", "normal");
    doc.text(k.label.toUpperCase(), x + kw / 2, y + 6, { align: "center" });
    doc.setFontSize(11);
    doc.setTextColor(k.cor);
    doc.setFont("helvetica", "bold");
    doc.text(k.value, x + kw / 2, y + 14, { align: "center" });
  });

  // Tabela resumo
  y = 54;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setFillColor(C.azul);
  doc.rect(2, y, W - 4, 7, "F");
  doc.setTextColor(C.branco);
  const cols = [30, 50, 50, 40, 30];
  const heads = ["Data", "Total Planilha", "Total Extrato", "Diferença", "Status"];
  let x = 4;
  heads.forEach((h, i) => { doc.text(h, x, y + 5); x += cols[i]; });

  y += 8;
  doc.setFont("helvetica", "normal");
  result.resumo.forEach((r, idx) => {
    if (y > 185) { doc.addPage(); y = 10; }
    const bg = idx % 2 === 0 ? "#F8FAFC" : C.branco;
    doc.setFillColor(bg);
    doc.rect(2, y, W - 4, 7, "F");
    doc.setTextColor(r.status === "OK" ? C.verde : C.vermelho);
    x = 4;
    const vals = [r.dia, fmtBRL(r.totalPlanilha), fmtBRL(Math.abs(r.totalExtrato)), fmtBRL(r.diferenca), r.status];
    vals.forEach((v, i) => { doc.text(v, x, y + 5); x += cols[i]; });
    y += 8;
  });

  // Auditoria (nova página)
  if (result.auditoria.length) {
    doc.addPage();
    y = 10;
    doc.setFillColor(C.azul);
    doc.rect(0, 0, W, 12, "F");
    doc.setTextColor(C.branco);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("AUDITORIA DE DIVERGÊNCIAS", W / 2, 8, { align: "center" });

    y = 18;
    doc.setFontSize(8);
    doc.setFillColor(C.azul);
    doc.rect(2, y, W - 4, 7, "F");
    doc.setTextColor(C.branco);
    doc.setFont("helvetica", "bold");
    const aCols = [22, 52, 18, 30, 30, 70, 50];
    const aHead = ["Data", "Tipo", "Qtd", "Valor Unit.", "Total (R$)", "Detalhe", "Origem"];
    x = 4;
    aHead.forEach((h, i) => { doc.text(h, x, y + 5); x += aCols[i]; });

    y += 8;
    doc.setFont("helvetica", "normal");
    result.auditoria.forEach((r, idx) => {
      if (y > 195) { doc.addPage(); y = 10; }
      doc.setFillColor(idx % 2 === 0 ? "#F8FAFC" : C.branco);
      doc.rect(2, y, W - 4, 7, "F");
      const cor = r.erro.includes("SIMILAR") ? C.info : r.erro.includes("BANCO") ? "#92400E" : C.vermelho;
      doc.setTextColor(cor);
      x = 4;
      const vals = [r.dia, r.erro.replace(/[⚠️🚨🔍]/gu, "").trim(), String(r.qtd), fmtBRL(r.valor), fmtBRL(r.total), r.detalhe.slice(0, 45), r.origem.slice(0, 25)];
      vals.forEach((v, i) => { doc.text(v, x, y + 5); x += aCols[i]; });
      y += 8;
    });
  }

  doc.save(nomeArquivo);
}

// ── Componente principal ───────────────────────────────────────────────────

export default function ConciliacaoBancaria() {
  const { toast } = useToast();

  const [planilhaFile, setPlanilhaFile] = useState<File | null>(null);
  const [ofxFiles,     setOfxFiles]     = useState<File[]>([]);
  const [processando,  setProcessando]  = useState(false);
  const [resultado,    setResultado]    = useState<ReconciliacaoResult | null>(null);

  const [abaAtiva,        setAbaAtiva]        = useState<"resumo" | "auditoria">("resumo");
  const [viewAuditoria,   setViewAuditoria]   = useState<"agrupado" | "lancamento">("agrupado");
  const [modalDetetive,   setModalDetetive]   = useState<string | null>(null);
  const [linhasExp,       setLinhasExp]       = useState<Set<number>>(new Set());

  // ── Drag & drop ──────────────────────────────────────────────────────────

  const onDropPlanilha = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".xlsx") || file.name.endsWith(".xls") || file.name.endsWith(".csv")))
      setPlanilhaFile(file);
  }, []);

  const onDropOFX = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const added = Array.from(e.dataTransfer.files).filter((f) =>
      f.name.toLowerCase().endsWith(".ofx") || f.name.toLowerCase().endsWith(".ofc")
    );
    if (added.length) setOfxFiles((prev) => [...prev, ...added]);
  }, []);

  // ── Executar ─────────────────────────────────────────────────────────────

  const executar = async () => {
    if (!planilhaFile || ofxFiles.length === 0) {
      toast({ title: "Arquivos necessários", description: "Selecione a planilha e ao menos um OFX.", variant: "destructive" });
      return;
    }
    setProcessando(true);
    try {
      // Ler planilha
      const planBuf = await planilhaFile.arrayBuffer();
      const planRows = parsePlanilha(planBuf);
      if (!planRows.length) throw new Error("Planilha sem dados válidos. Verifique as colunas Data e Valor.");

      // Ler OFXs
      const ofxTrns: OFXTransaction[] = [];
      for (const f of ofxFiles) {
        const text = await f.text();
        ofxTrns.push(...parseOFX(text, f.name));
      }
      if (!ofxTrns.length) throw new Error("Nenhum lançamento encontrado nos extratos OFX.");

      const res = reconciliar(planRows, ofxTrns);
      setResultado(res);
      toast({ title: "Conciliação concluída", description: `${res.totalDias} dias processados — ${res.divergencias} divergências.` });
    } catch (err: unknown) {
      toast({ title: "Erro no processamento", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setProcessando(false);
    }
  };

  const reiniciar = () => {
    setPlanilhaFile(null);
    setOfxFiles([]);
    setResultado(null);
    setLinhasExp(new Set());
  };

  const toggleLinha = (i: number) =>
    setLinhasExp((prev) => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s; });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Conciliação Bancária"
        subtitle="Cruza o fluxo de caixa com extratos OFX e identifica divergências automaticamente"
        module="Financeiro"
        breadcrumb={["Ferramentas", "Conciliação Bancária"]}
      />

      {!resultado ? (
        /* ── Upload ──────────────────────────────────────────────────────── */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Planilha */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-500" />
                Planilha de Fluxo de Caixa
              </CardTitle>
            </CardHeader>
            <CardContent>
              <label
                className={cn(
                  "flex flex-col items-center justify-center border-2 border-dashed rounded-lg h-36 cursor-pointer transition-colors",
                  planilhaFile ? "border-green-400 bg-green-50 dark:bg-green-950/20" : "border-border hover:border-blue-400 hover:bg-muted/40"
                )}
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDropPlanilha}
              >
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && setPlanilhaFile(e.target.files[0])}
                />
                {planilhaFile ? (
                  <div className="text-center">
                    <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-1" />
                    <p className="text-sm font-medium text-green-700 dark:text-green-400">{planilhaFile.name}</p>
                    <button className="text-xs text-muted-foreground mt-1 hover:underline" onClick={(e) => { e.preventDefault(); setPlanilhaFile(null); }}>remover</button>
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground">
                    <Upload className="h-8 w-8 mx-auto mb-2" />
                    <p className="text-sm">Arraste ou clique para selecionar</p>
                    <p className="text-xs mt-1">.xlsx, .xls, .csv</p>
                  </div>
                )}
              </label>
            </CardContent>
          </Card>

          {/* OFX */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <GitMerge className="h-4 w-4 text-purple-500" />
                Extratos Bancários OFX
                {ofxFiles.length > 0 && <Badge variant="secondary">{ofxFiles.length}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label
                className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg h-24 cursor-pointer transition-colors border-border hover:border-purple-400 hover:bg-muted/40"
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDropOFX}
              >
                <input
                  type="file"
                  accept=".ofx,.ofc"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && setOfxFiles((p) => [...p, ...Array.from(e.target.files!)])}
                />
                <Upload className="h-6 w-6 text-muted-foreground mb-1" />
                <p className="text-xs text-muted-foreground">Arraste ou clique — múltiplos bancos</p>
              </label>

              {ofxFiles.length > 0 && (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {ofxFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-muted/40 rounded px-2 py-1">
                      <span className="truncate text-foreground">{f.name}</span>
                      <button onClick={() => setOfxFiles((p) => p.filter((_, j) => j !== i))}>
                        <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="lg:col-span-2 flex gap-3">
            <Button
              onClick={executar}
              disabled={processando || !planilhaFile || ofxFiles.length === 0}
              className="flex-1"
            >
              {processando ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              {processando ? "Processando..." : "Iniciar Conciliação"}
            </Button>
          </div>
        </div>
      ) : (
        /* ── Resultado ──────────────────────────────────────────────────── */
        <div className="space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: "Eficiência",    value: `${resultado.eficiencia}%`,  ok: resultado.eficiencia >= 100 },
              { label: "Divergências",  value: String(resultado.divergencias), ok: resultado.divergencias === 0 },
              { label: "Vol. Planilha", value: fmtBRL(resultado.volFluxo),  ok: true },
              { label: "Vol. Banco",    value: fmtBRL(resultado.volBanco),   ok: true },
              { label: "Saldo Total",   value: fmtBRL(resultado.saldoTotal), ok: Math.abs(resultado.saldoTotal) < 0.005 },
            ].map((k) => (
              <Card key={k.label}>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{k.label}</p>
                  <p className={cn("text-lg font-bold", k.ok ? "text-green-600" : "text-red-600")}>{k.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Abas: Resumo / Auditoria */}
          <Card>
            <CardHeader className="pb-0 pt-4 px-4">
              <div className="flex items-center justify-between gap-4">
                <Tabs value={abaAtiva} onValueChange={(v) => setAbaAtiva(v as "resumo" | "auditoria")} className="flex-1">
                  <TabsList className="h-9">
                    <TabsTrigger value="resumo" className="text-xs">
                      📊 Resumo por Dia
                    </TabsTrigger>
                    <TabsTrigger value="auditoria" className="text-xs">
                      🔍 Auditoria
                      {resultado.auditoria.length > 0 && (
                        <Badge variant="destructive" className="ml-1.5 h-4 px-1 text-xs">
                          {resultado.auditoria.length}
                        </Badge>
                      )}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => exportarExcel(resultado, `Conciliacao_${new Date().toLocaleDateString("pt-BR").replace(/\//g, "-")}.xlsx`)}>
                    <Download className="h-3 w-3 mr-1" /> Excel
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => exportarPDF(resultado, `Conciliacao_${new Date().toLocaleDateString("pt-BR").replace(/\//g, "-")}.pdf`)}>
                    <Download className="h-3 w-3 mr-1" /> PDF
                  </Button>
                  <Button size="sm" variant="ghost" onClick={reiniciar}>
                    <RefreshCw className="h-3 w-3 mr-1" /> Nova
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0 pt-0">
              <Tabs value={abaAtiva} onValueChange={(v) => setAbaAtiva(v as "resumo" | "auditoria")}>
                {/* ── Aba Resumo ── */}
                <TabsContent value="resumo" className="mt-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40">
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Data</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">Planilha</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">Extrato</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">Diferença</th>
                          <th className="text-center px-4 py-2 font-medium text-muted-foreground">Status</th>
                          <th className="px-4 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {resultado.resumo.map((r, i) => (
                          <tr key={i} className={cn("border-b transition-colors", r.status === "DIVERGENTE" && "bg-red-50 dark:bg-red-950/10")}>
                            <td className="px-4 py-2 font-medium">{r.dia}</td>
                            <td className="px-4 py-2 text-right">{fmtBRL(r.totalPlanilha)}</td>
                            <td className="px-4 py-2 text-right">{fmtBRL(Math.abs(r.totalExtrato))}</td>
                            <td className={cn("px-4 py-2 text-right font-medium", Math.abs(r.diferenca) < 0.005 ? "text-green-600" : "text-red-600")}>
                              {r.diferenca >= 0 ? "+" : ""}{fmtBRL(r.diferenca)}
                            </td>
                            <td className="px-4 py-2 text-center">
                              {r.status === "OK"
                                ? <Badge className="bg-green-100 text-green-700 border-green-200 hover:bg-green-100">✓ OK</Badge>
                                : <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100">Divergente</Badge>}
                            </td>
                            <td className="px-4 py-2 text-center">
                              {r.status === "DIVERGENTE" && resultado.suspeitos[r.dia] && (
                                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setModalDetetive(r.dia)}>
                                  🔎 Detetive
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>

                {/* ── Aba Auditoria ── */}
                <TabsContent value="auditoria" className="mt-0">
                  {/* toggle Agrupado / Por Lançamento */}
                  <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/20">
                    <span className="text-xs text-muted-foreground mr-1">Visualizar:</span>
                    <Button
                      size="sm" variant={viewAuditoria === "agrupado" ? "secondary" : "ghost"}
                      className="h-7 text-xs px-3"
                      onClick={() => setViewAuditoria("agrupado")}
                    >
                      Agrupado
                    </Button>
                    <Button
                      size="sm" variant={viewAuditoria === "lancamento" ? "secondary" : "ghost"}
                      className="h-7 text-xs px-3"
                      onClick={() => setViewAuditoria("lancamento")}
                    >
                      Por Lançamento
                      <Badge variant="outline" className="ml-1.5 h-4 px-1 text-xs">
                        {resultado.lancamentos.length}
                      </Badge>
                    </Button>
                  </div>

                  {viewAuditoria === "agrupado" ? (
                  <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background border-b z-10">
                        <tr>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground whitespace-nowrap">Data</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Ocorrência</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground whitespace-nowrap">Banco / Origem</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground whitespace-nowrap">Tipo (Fluxo → Banco)</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Detalhe</th>
                          <th className="text-center px-4 py-2 font-medium text-muted-foreground">Qtd</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground whitespace-nowrap">Valor Unit.</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground whitespace-nowrap">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultado.auditoria.map((r, i) => {
                          const isExp = linhasExp.has(i);
                          const isDivTipo = r.erro === "❌ TIPO DIVERGENTE";
                          const bg = isDivTipo
                            ? "bg-purple-50 dark:bg-purple-950/20"
                            : r.erro.includes("SIMILAR")
                            ? "bg-blue-50 dark:bg-blue-950/20"
                            : r.erro.includes("BANCO")
                            ? "bg-amber-50 dark:bg-amber-950/20"
                            : "bg-red-50 dark:bg-red-950/20";
                          const cor = isDivTipo
                            ? "text-purple-700 dark:text-purple-400"
                            : r.erro.includes("SIMILAR")
                            ? "text-blue-700 dark:text-blue-400"
                            : r.erro.includes("BANCO")
                            ? "text-amber-700 dark:text-amber-400"
                            : "text-red-700 dark:text-red-400";

                          const tipoBadge = (tipo: string | undefined, side: "fluxo" | "banco") => {
                            if (!tipo || tipo === "INDEFINIDO") return <span className="text-muted-foreground text-xs">—</span>;
                            const isEntrada = tipo === "ENTRADA";
                            return (
                              <Badge className={cn("text-xs px-1 py-0",
                                isEntrada
                                  ? "bg-green-100 text-green-700 border-green-200"
                                  : "bg-red-100 text-red-700 border-red-200",
                                side === "banco" && isDivTipo && "ring-1 ring-purple-400"
                              )}>
                                {isEntrada ? "↑ ENTRADA" : "↓ SAÍDA"}
                              </Badge>
                            );
                          };

                          return (
                            <tr
                              key={i}
                              className={cn("border-b cursor-pointer hover:opacity-80", bg)}
                              onClick={() => toggleLinha(i)}
                            >
                              <td className="px-4 py-2 font-medium whitespace-nowrap">{r.dia}</td>
                              <td className={cn("px-4 py-2 font-medium", cor)}>
                                {r.erro}
                                {r.qtd > 1 && <Badge variant="secondary" className="ml-1 text-xs">×{r.qtd}</Badge>}
                              </td>
                              <td className="px-4 py-2 text-muted-foreground whitespace-nowrap text-xs">
                                {r.origem || "—"}
                              </td>
                              <td className="px-4 py-2">
                                <div className="flex items-center gap-1">
                                  {tipoBadge(r.tipoPlanilha, "fluxo")}
                                  {(r.tipoOFX || r.tipoPlanilha) && r.tipoPlanilha !== "INDEFINIDO" && (
                                    <span className="text-muted-foreground text-xs">→</span>
                                  )}
                                  {tipoBadge(r.tipoOFX, "banco")}
                                </div>
                              </td>
                              <td className="px-4 py-2 text-muted-foreground max-w-xs">
                                {isExp ? r.detalhe : r.detalhe.slice(0, 55) + (r.detalhe.length > 55 ? "…" : "")}
                                {isExp ? <ChevronUp className="inline h-3 w-3 ml-1" /> : <ChevronDown className="inline h-3 w-3 ml-1 opacity-40" />}
                              </td>
                              <td className="px-4 py-2 text-center text-muted-foreground">{r.qtd > 1 ? r.qtd : "—"}</td>
                              <td className="px-4 py-2 text-right text-muted-foreground">{r.qtd > 1 ? fmtBRL(r.valor) : "—"}</td>
                              <td className="px-4 py-2 text-right font-bold">{fmtBRL(r.total)}</td>
                            </tr>
                          );
                        })}
                        {resultado.auditoria.length === 0 && (
                          <tr>
                            <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                              Nenhuma divergência encontrada.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  ) : (
                  /* ── Por Lançamento ── */
                  <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background border-b z-10">
                        <tr>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground whitespace-nowrap">Data</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Ocorrência</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground whitespace-nowrap">Banco / Origem</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground whitespace-nowrap">Tipo</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Histórico / Detalhe</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground whitespace-nowrap">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultado.lancamentos.map((r, i) => {
                          const isDivTipo = r.erro === "❌ TIPO DIVERGENTE";
                          const bg = isDivTipo
                            ? "bg-purple-50 dark:bg-purple-950/20"
                            : r.erro.includes("SIMILAR")
                            ? "bg-blue-50 dark:bg-blue-950/20"
                            : r.erro.includes("BANCO")
                            ? "bg-amber-50 dark:bg-amber-950/20"
                            : "bg-red-50 dark:bg-red-950/20";
                          const cor = isDivTipo
                            ? "text-purple-700 dark:text-purple-400"
                            : r.erro.includes("SIMILAR")
                            ? "text-blue-700 dark:text-blue-400"
                            : r.erro.includes("BANCO")
                            ? "text-amber-700 dark:text-amber-400"
                            : "text-red-700 dark:text-red-400";
                          const tipo = r.tipoOFX ?? r.tipoPlanilha;
                          return (
                            <tr key={i} className={cn("border-b", bg)}>
                              <td className="px-4 py-2 font-medium whitespace-nowrap">{r.dia}</td>
                              <td className={cn("px-4 py-2 font-medium text-xs", cor)}>{r.erro}</td>
                              <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{r.origem || "—"}</td>
                              <td className="px-4 py-2">
                                {tipo && tipo !== "INDEFINIDO" ? (
                                  <Badge className={cn("text-xs px-1 py-0",
                                    tipo === "ENTRADA"
                                      ? "bg-green-100 text-green-700 border-green-200"
                                      : "bg-red-100 text-red-700 border-red-200"
                                  )}>
                                    {tipo === "ENTRADA" ? "↑ ENTRADA" : "↓ SAÍDA"}
                                  </Badge>
                                ) : <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="px-4 py-2 text-muted-foreground max-w-xs truncate">{r.detalhe}</td>
                              <td className="px-4 py-2 text-right font-bold">{fmtBRL(r.valor)}</td>
                            </tr>
                          );
                        })}
                        {resultado.lancamentos.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                              Nenhuma divergência encontrada.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Modal Detetive ──────────────────────────────────────────────── */}
      <Dialog open={!!modalDetetive} onOpenChange={() => setModalDetetive(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>🔎 Detetive — {modalDetetive}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground mb-3">
            Pares suspeitos de causar a divergência do dia. Conferência rápida antes de corrigir.
          </p>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {(modalDetetive && resultado?.suspeitos[modalDetetive] || []).map((s, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-lg border p-3 text-sm",
                  s.confianca === "ALTA"
                    ? "border-red-200 bg-red-50 dark:bg-red-950/20"
                    : "border-amber-200 bg-amber-50 dark:bg-amber-950/20"
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <Badge className={s.confianca === "ALTA" ? "bg-red-100 text-red-700 border-red-300" : "bg-amber-100 text-amber-700 border-amber-300"}>
                    {s.confianca === "ALTA" ? "⚡ ALTA CONFIANÇA" : "MÉDIA CONFIANÇA"}
                  </Badge>
                  <span className={cn("font-bold", Math.abs(s.diferenca) > 0 ? "text-red-600" : "text-green-600")}>
                    Diff: {s.diferenca >= 0 ? "+" : ""}{fmtBRL(s.diferenca)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Planilha</p>
                    <p className="font-bold">{fmtBRL(s.planilhaValor)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Banco</p>
                    <p className="font-bold">{fmtBRL(s.bancoValor)}</p>
                  </div>
                </div>
                {s.bancoHistorico && (
                  <p className="text-xs text-muted-foreground mt-2 truncate">
                    <Info className="inline h-3 w-3 mr-1" />{s.bancoHistorico}
                  </p>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
