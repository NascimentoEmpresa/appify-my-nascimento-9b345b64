import * as XLSX from "xlsx";
import jsPDF from "jspdf";

// SIS-2026-0492: motor de conciliação extraído de
// `src/pages/financeiro/ConciliacaoBancaria.tsx` (tela manual, planilha +
// OFX) pra ser reaproveitado por `ConciliacaoFluxoCaixa.tsx` (tela nova,
// Fluxo de Caixa interno + OFX) — o algoritmo de comparação é o mesmo nos
// dois casos, só muda de onde vem o lado "Fluxo" (planilha subida vs.
// `useFluxoCaixaCombinado()`). Qualquer ajuste no motor (tolerância de
// match, agrupamento, etc.) vale para as duas telas.

export type TipoLancamento = "ENTRADA" | "SAÍDA" | "INDEFINIDO";

export interface OFXTransaction {
  dia: string; // YYYY-MM-DD
  valor: number; // abs
  tipo: "ENTRADA" | "SAÍDA";
  memo: string;
  origem: string;
}

export interface PlanilhaRow {
  dia: string;
  valor: number;
  tipo: TipoLancamento;
  banco: string;
  // SIS-2026-0492: só vem preenchido quando a linha veio do Fluxo de
  // Caixa interno (não de planilha Excel) — permite a tela de conciliação
  // automática voltar pro lançamento real quando o usuário quiser
  // "Ajustar" uma divergência, sem precisar casar por valor/data de novo.
  despesaId?: string | null;
  numeroParcela?: number | null;
  origemFluxo?: "malote" | "debito_automatico" | "cartao_fatura" | "aplicacao_financeira" | null;
  // SIS-2026-0492 (Iury): mostrar de qual empresa é o lançamento do Fluxo
  // ajuda a identificar a divergência mais rápido quando há várias empresas
  // do grupo no mesmo período/banco.
  empresaNome?: string | null;
}

export interface DiaSummary {
  dia: string; // dd/mm/yyyy
  diaISO: string; // YYYY-MM-DD
  totalPlanilha: number;
  totalExtrato: number;
  diferenca: number;
  status: "OK" | "DIVERGENTE";
}

export interface AuditRow {
  dia: string;
  erro: "⚠️ BANCO - NÃO ENCONTRADO" | "🚨 FLUXO - NÃO ENCONTRADO" | "🔍 VALOR SIMILAR" | "❌ TIPO DIVERGENTE";
  valor: number;
  qtd: number;
  total: number;
  detalhe: string;
  origem: string;
  tipoOFX?: "ENTRADA" | "SAÍDA";
  tipoPlanilha?: TipoLancamento;
  despesaId?: string | null;
  numeroParcela?: number | null;
  origemFluxo?: "malote" | "debito_automatico" | "cartao_fatura" | "aplicacao_financeira" | null;
  empresaNome?: string | null;
}

export interface Suspeito {
  planilhaValor: number;
  bancoValor: number;
  diferenca: number;
  bancoHistorico: string;
  bancoOrigem: string;
  confianca: "ALTA" | "MEDIA";
}

export interface LancamentoRow {
  id: string;
  dia: string;
  erro: AuditRow["erro"];
  valor: number;
  detalhe: string;
  origem: string;
  tipoOFX?: "ENTRADA" | "SAÍDA";
  tipoPlanilha?: TipoLancamento;
  despesaId?: string | null;
  numeroParcela?: number | null;
  origemFluxo?: "malote" | "debito_automatico" | "cartao_fatura" | "aplicacao_financeira" | null;
  empresaNome?: string | null;
}

export interface ReconciliacaoResult {
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

// SIS-2026-0491 (Iury, correção): só o rótulo "BB Rende Fácil" em si deve
// ser ignorado no extrato — "Aplicação BB CDB DI"/"Resgate BB CDB DI" são
// movimentações normais e devem continuar contabilizadas.
export const MEMOS_IGNORAR = ["RENDE FACIL", "BB RENDE", "RENDE F"];

// ── Parser OFX ─────────────────────────────────────────────────────────────

// SIS-2026-0344: o padrão OFX usa "." como separador decimal, mas o Bradesco
// (achado real, ao testar os .OFX da usuária) exporta em formato BR — vírgula
// decimal, ponto como separador de milhar ("10000,00", "-7.191,44"). O regex
// antigo só aceitava dígito/"-"/"." e cortava o valor exatamente na vírgula
// ("-183,60" virava "-183") — não era arredondamento, era truncamento.
export function parseOfxAmount(raw: string): number {
  if (raw.includes(",")) {
    return parseFloat(raw.replace(/\./g, "").replace(",", "."));
  }
  return parseFloat(raw);
}

export function parseOFX(text: string, origem: string): OFXTransaction[] {
  const txns: OFXTransaction[] = [];
  const regex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const block = m[1];
    const dt = block.match(/<DTPOSTED>(\d{8})/)?.[1];
    const amt = block.match(/<TRNAMT>([-\d.,]+)/)?.[1];
    const memo = (block.match(/<MEMO>([^\n<\r]*)/)?.[1] ?? "").trim();
    const name = (block.match(/<NAME>([^\n<\r]*)/)?.[1] ?? "").trim();
    if (!dt || !amt) continue;
    const hist = memo || name;
    const upper = hist.toUpperCase();
    if (MEMOS_IGNORAR.some((t) => upper.includes(t))) continue;
    const rawAmt = parseOfxAmount(amt);
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

// ── Motor de conciliação ───────────────────────────────────────────────────

export function reconciliar(planRows: PlanilhaRow[], ofxTrns: OFXTransaction[]): ReconciliacaoResult {
  const toFmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

  const diasSet = new Set([...planRows.map((r) => r.dia), ...ofxTrns.map((t) => t.dia)]);
  const dias = Array.from(diasSet).sort();

  const planByDay: Record<string, PlanilhaRow[]> = {};
  const ofxByDay: Record<string, OFXTransaction[]> = {};
  for (const d of dias) {
    planByDay[d] = planRows.filter((r) => r.dia === d);
    ofxByDay[d] = ofxTrns.filter((t) => t.dia === d);
  }

  const planTotais: Record<string, number> = {};
  const ofxTotais: Record<string, number> = {};
  for (const d of dias) {
    planTotais[d] = Math.round(planByDay[d].reduce((s, r) => s + r.valor, 0) * 100) / 100;
    ofxTotais[d] = Math.round(ofxByDay[d].reduce((s, t) => s + t.valor, 0) * 100) / 100;
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
    const ofxItens = ofxByDay[dia].map((t) => ({ ...t }));

    const ofxSobra = [...ofxItens];
    const planSobra: PlanilhaRow[] = [];

    // 1ª passagem — match exato: valor com tolerância float + tipo compatível
    for (const p of planItens) {
      const pv = Math.round(p.valor * 100) / 100;

      const idxExato = ofxSobra.findIndex(
        (e) => Math.abs(Math.round(e.valor * 100) / 100 - pv) < 0.005 && (p.tipo === "INDEFINIDO" || e.tipo === p.tipo)
      );
      if (idxExato >= 0) {
        ofxSobra.splice(idxExato, 1);
        continue;
      }

      const idxTipoErrado =
        p.tipo !== "INDEFINIDO"
          ? ofxSobra.findIndex((e) => Math.abs(Math.round(e.valor * 100) / 100 - pv) < 0.005 && e.tipo !== p.tipo)
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
          despesaId: p.despesaId,
          numeroParcela: p.numeroParcela,
          origemFluxo: p.origemFluxo,
          empresaNome: p.empresaNome,
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
      let bestIdx = -1,
        bestDiff = Infinity;

      extSemMatch.forEach((e, i) => {
        const ev = Math.round(e.valor * 100) / 100;
        const diff = Math.abs(pv - ev);
        const ref = Math.max(pv, ev) || 1;
        if (diff > 0 && diff <= 200 && diff / ref <= 0.05 && diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      });

      if (bestIdx >= 0) {
        const ev = Math.round(extSemMatch[bestIdx].valor * 100) / 100;
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
          despesaId: p.despesaId,
          numeroParcela: p.numeroParcela,
          origemFluxo: p.origemFluxo,
          empresaNome: p.empresaNome,
        });
        extSemMatch.splice(bestIdx, 1);
      } else {
        planSemMatch.push(p);
      }
    }

    for (const p of planSemMatch)
      rawAudit.push({
        dia: toFmt(dia),
        erro: "⚠️ BANCO - NÃO ENCONTRADO",
        valor: Math.round(p.valor * 100) / 100,
        detalhe: `Faltou cair na conta`,
        origem: p.banco,
        tipoPlanilha: p.tipo,
        despesaId: p.despesaId,
        numeroParcela: p.numeroParcela,
        origemFluxo: p.origemFluxo,
        empresaNome: p.empresaNome,
      });
    for (const e of extSemMatch)
      rawAudit.push({
        dia: toFmt(dia),
        erro: "🚨 FLUXO - NÃO ENCONTRADO",
        valor: Math.round(e.valor * 100) / 100,
        detalhe: e.memo,
        origem: e.origem,
        tipoOFX: e.tipo,
      });
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
      existing.qtd += 1;
      existing.total = Math.round(existing.valor * existing.qtd * 100) / 100;
    } else {
      aggMap.set(key, { ...r, qtd: 1, total: r.valor });
    }
  }

  // Remover auditoria de dias OK
  const diasOkSet = new Set(resumo.filter((r) => r.status === "OK").map((r) => r.dia));
  const auditoria = Array.from(aggMap.values())
    .filter((r) => !diasOkSet.has(r.dia))
    .sort((a, b) => a.dia.localeCompare(b.dia) || b.total - a.total);

  // Lista por lançamento (não agrupada, sem dias OK) — `id` baseado no
  // CONTEÚDO da linha (não índice de array) pra telas interativas
  // (SIS-2026-0492) conseguirem marcar "resolvido" e reconhecer a mesma
  // divergência entre recálculos (uma linha ajustada/criada some do
  // resultado ao recalcular; uma "ignorada" precisa continuar reconhecível
  // pra não voltar a aparecer como pendência).
  const lancamentos: LancamentoRow[] = rawAudit
    .filter((r) => !diasOkSet.has(r.dia))
    .sort((a, b) => a.dia.localeCompare(b.dia) || b.valor - a.valor)
    .map((r) => ({
      ...r,
      id: [r.dia, r.erro, r.valor, r.origem, r.detalhe, r.despesaId ?? "", r.numeroParcela ?? ""].join("||"),
    }));

  // ── Motor detetive ────────────────────────────────────────────────────
  const suspeitos: Record<string, Suspeito[]> = {};
  for (const s of resumo.filter((r) => r.status === "DIVERGENTE")) {
    const dia = s.diaISO;
    const divergencia = s.diferenca;
    const planItens = planByDay[dia].map((r) => ({ ...r }));
    const ofxItens = ofxByDay[dia].map((t) => ({ ...t }));

    const ofxSobra = [...ofxItens];
    const planSobra: PlanilhaRow[] = [];
    for (const p of planItens) {
      const pv = Math.round(p.valor * 100) / 100;
      const idx = ofxSobra.findIndex((e) => Math.abs(Math.round(e.valor * 100) / 100 - pv) < 0.005);
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
            bancoValor: Math.round(e.valor * 100) / 100,
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
  const diasOk = resumo.filter((r) => r.status === "OK").length;

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

export function fmt(v: number) {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function fmtBRL(v: number) {
  return `R$ ${fmt(Math.abs(v))}`;
}

// ── Export Excel ───────────────────────────────────────────────────────────

export function exportarExcel(result: ReconciliacaoResult, nomeArquivo: string) {
  const wb = XLSX.utils.book_new();

  const resumoData = [
    ["Dia", "Total Planilha", "Total Extrato", "Diferença", "Status"],
    ...result.resumo.map((r) => [r.dia, r.totalPlanilha, r.totalExtrato, r.diferenca, r.status]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumoData), "RESUMO GERAL");

  if (result.auditoria.length) {
    const audData = [
      ["Dia", "Tipo", "Qtd", "Valor (R$)", "Total (R$)", "Detalhe", "Origem"],
      ...result.auditoria.map((r) => [r.dia, r.erro, r.qtd, r.valor, r.total, r.detalhe, r.origem]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(audData), "AUDITORIA");
  }

  XLSX.writeFile(wb, nomeArquivo);
}

// ── Export PDF ─────────────────────────────────────────────────────────────

export function exportarPDF(result: ReconciliacaoResult, nomeArquivo: string) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const C = { azul: "#0A1E3C", laranja: "#E67300", cinza: "#5A6473", branco: "#FFFFFF", verde: "#1E7B3A", vermelho: "#B91C1C", info: "#0369A1" };

  doc.setFillColor(C.azul);
  doc.rect(0, 0, W, 22, "F");
  doc.setTextColor(C.branco);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("GRUPO NASCIMENTO — CONCILIAÇÃO BANCÁRIA", W / 2, 14, { align: "center" });

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

  y = 54;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setFillColor(C.azul);
  doc.rect(2, y, W - 4, 7, "F");
  doc.setTextColor(C.branco);
  const cols = [30, 50, 50, 40, 30];
  const heads = ["Data", "Total Planilha", "Total Extrato", "Diferença", "Status"];
  let x = 4;
  heads.forEach((h, i) => {
    doc.text(h, x, y + 5);
    x += cols[i];
  });

  y += 8;
  doc.setFont("helvetica", "normal");
  result.resumo.forEach((r, idx) => {
    if (y > 185) {
      doc.addPage();
      y = 10;
    }
    const bg = idx % 2 === 0 ? "#F8FAFC" : C.branco;
    doc.setFillColor(bg);
    doc.rect(2, y, W - 4, 7, "F");
    doc.setTextColor(r.status === "OK" ? C.verde : C.vermelho);
    x = 4;
    const vals = [r.dia, fmtBRL(r.totalPlanilha), fmtBRL(Math.abs(r.totalExtrato)), fmtBRL(r.diferenca), r.status];
    vals.forEach((v, i) => {
      doc.text(v, x, y + 5);
      x += cols[i];
    });
    y += 8;
  });

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
    aHead.forEach((h, i) => {
      doc.text(h, x, y + 5);
      x += aCols[i];
    });

    y += 8;
    doc.setFont("helvetica", "normal");
    result.auditoria.forEach((r, idx) => {
      if (y > 195) {
        doc.addPage();
        y = 10;
      }
      doc.setFillColor(idx % 2 === 0 ? "#F8FAFC" : C.branco);
      doc.rect(2, y, W - 4, 7, "F");
      const cor = r.erro.includes("SIMILAR") ? C.info : r.erro.includes("BANCO") ? "#92400E" : C.vermelho;
      doc.setTextColor(cor);
      x = 4;
      const vals = [r.dia, r.erro.replace(/[⚠️🚨🔍]/gu, "").trim(), String(r.qtd), fmtBRL(r.valor), fmtBRL(r.total), r.detalhe.slice(0, 45), r.origem.slice(0, 25)];
      vals.forEach((v, i) => {
        doc.text(v, x, y + 5);
        x += aCols[i];
      });
      y += 8;
    });
  }

  doc.save(nomeArquivo);
}
