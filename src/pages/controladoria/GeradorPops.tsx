import { useState, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import {
  FileSpreadsheet, Download, CheckCircle2, RefreshCw,
  Paperclip, Eye, ListChecks, Plus, Trash2, AlertCircle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

// ── tipos ──────────────────────────────────────────────────────────────────
interface PopItem {
  seq: string; area: string; setor: string; atividade: string;
  periodicidade: string; responsavel: string; classificacao: string;
  backup: string; recurso: string; criticidade: string;
  depProcesso: string; depArea: string; tempoExec: string;
  descDetalhada: string; processo: string; id: string;
  gerado: boolean; selected: boolean; tipo: "PRÉVIA" | "PUBLICAÇÃO";
  etapas: string[] | null;
  nomesFluxo: string[];
  criterioExito: string; acaoInconsistencia: string;
  fluxogramaImg?: string; fluxogramaFileName?: string;
}

interface POPContent { objetivo: string; procedimento: string[]; }

// ── helpers gerais ─────────────────────────────────────────────────────────
function gerarId(area: string, setor: string) {
  return `${(area || "GEN").substring(0, 3).toUpperCase()}-${(setor || "GEN").substring(0, 3).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
}
function criticidadeBadge(crit: string) {
  const c = (crit || "").toLowerCase();
  if (c.includes("alta") || c.includes("crít")) return "bg-red-100 text-red-700 border-red-200";
  if (c.includes("media") || c.includes("média")) return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}
function montarConteudo(item: PopItem): POPContent {
  const etapas = item.etapas ?? [];
  const objetivo = `Padronizar o procedimento de ${item.atividade.toLowerCase()} na área de ${item.area}${item.setor ? `, setor ${item.setor}` : ""}, garantindo a correta execução e rastreabilidade das atividades.`;
  return { objetivo, procedimento: etapas };
}

// ── paleta compartilhada ───────────────────────────────────────────────────
const PAL = {
  azulEscuro: "#0A1E3C",
  azulMedio:  "#123460",
  azulClaro:  "#EBF0F8",
  laranja:    "#E67300",
  laranjaClr: "#FFF3E0",
  cinzaBorda: "#D2D7E1",
  cinzaTxt:   "#5A6473",
  escuro:     "#141E32",
  branco:     "#FFFFFF",
  verde:      "#1E7B3A",
  verdeClaro: "#DCF0E1",
  vermClaro:  "#FFEBEB",
};

// ── Canvas: wrapping de texto ──────────────────────────────────────────────
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

// ── Canvas: render de UMA etapa (para PDF com quebra de página) ───────────
function renderEtapaCanvas(
  step: string, index: number, total: number
): { url: string; canvasW: number; canvasH: number } {
  const DPR = 2;
  const W = 1100;
  const FONT = "Inter, system-ui, Arial, sans-serif";
  const TEXT_X = 46 + 26 + 22;
  const TEXT_W = W - TEXT_X - 24;
  const LINE_H_TITLE = 34;
  const LINE_H_BODY = 30;
  const ROW_V_PAD = 18;
  const ARROW_H = 28;
  const BADGE_H = 68;

  const tmp = document.createElement("canvas");
  const tctx = tmp.getContext("2d")!;
  const colon = step.indexOf(":");
  const hasTitulo = colon > 0 && colon < 50;
  const corpo = hasTitulo ? step.substring(colon + 1).trim() : step;
  tctx.font = `400 22px ${FONT}`;
  const bodyLines = wrapText(tctx, corpo, TEXT_W);
  const titleH = hasTitulo ? LINE_H_TITLE : 0;
  const rh = Math.max(titleH + bodyLines.length * LINE_H_BODY + ROW_V_PAD * 2, BADGE_H + ROW_V_PAD * 2);
  const hasArrow = index < total - 1;
  const totalH = rh + (hasArrow ? ARROW_H : 0);

  const canvas = document.createElement("canvas");
  canvas.width = W * DPR;
  canvas.height = totalH * DPR;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(DPR, DPR);
  ctx.clearRect(0, 0, W, totalH);

  // fundo alternado
  ctx.fillStyle = index % 2 === 0 ? "#FFFFFF" : "#F4F7FB";
  ctx.fillRect(0, 0, W, rh);

  // borda laranja esquerda
  ctx.fillStyle = PAL.laranja;
  ctx.fillRect(0, 0, 6, rh);

  const BW = 56, BH = BADGE_H;
  const BX = 30, BY = (rh - BH) / 2;
  const BCMID = BX + BW * 0.50;

  ctx.save();
  ctx.shadowColor = "rgba(230,115,0,0.28)";
  ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
  ctx.fillStyle = PAL.laranja;
  ctx.beginPath();
  ctx.moveTo(BX,             BY);
  ctx.lineTo(BX + BW * 0.50, BY + BH * 0.35);
  ctx.lineTo(BX + BW,        BY);
  ctx.lineTo(BX + BW,        BY + BH * 0.65);
  ctx.lineTo(BX + BW * 0.50, BY + BH);
  ctx.lineTo(BX,             BY + BH * 0.65);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 15px ${FONT}`;
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  const numStr = String(index + 1);
  const m = ctx.measureText(numStr);
  const glyphMid = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  ctx.fillText(numStr, BCMID, BY + BH * 0.35 + (BH * 0.30) / 2 + 5 + glyphMid);

  const titulo = hasTitulo ? step.substring(0, colon).trim() : null;
  ctx.font = `400 22px ${FONT}`;
  const allBodyLines = wrapText(ctx, corpo, TEXT_W);
  const totalTextH = (titulo ? LINE_H_TITLE : 0) + allBodyLines.length * LINE_H_BODY;
  let textY = (rh - totalTextH) / 2;
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  if (titulo) {
    ctx.font = `700 22px ${FONT}`; ctx.fillStyle = PAL.azulMedio;
    ctx.fillText(titulo + ":", TEXT_X, textY); textY += LINE_H_TITLE;
  }
  ctx.font = `400 22px ${FONT}`; ctx.fillStyle = PAL.escuro;
  allBodyLines.forEach(l => { ctx.fillText(l, TEXT_X, textY); textY += LINE_H_BODY; });

  if (hasArrow) {
    const mid = rh + ARROW_H / 2;
    ctx.setLineDash([4, 4]); ctx.strokeStyle = "#D0D8E8"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(16, mid); ctx.lineTo(W - 16, mid); ctx.stroke();
    ctx.setLineDash([]);
    const chevW = 18, chevH = 10, chevGap = 6;
    [-chevGap / 2 - chevH / 2, chevGap / 2 + chevH / 2 - chevH].forEach((offset, ci) => {
      const ty = mid + offset - (ci === 0 ? 3 : -3);
      ctx.strokeStyle = PAL.laranja; ctx.lineWidth = ci === 0 ? 3 : 2.5;
      ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.globalAlpha = ci === 0 ? 1 : 0.55;
      ctx.beginPath(); ctx.moveTo(BCMID - chevW / 2, ty); ctx.lineTo(BCMID, ty + chevH); ctx.lineTo(BCMID + chevW / 2, ty); ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }

  // fundo branco explícito antes de exportar como JPEG (sem transparência)
  const out = document.createElement("canvas");
  out.width = canvas.width; out.height = canvas.height;
  const octx = out.getContext("2d")!;
  octx.fillStyle = "#FFFFFF"; octx.fillRect(0, 0, out.width, out.height);
  octx.drawImage(canvas, 0, 0);
  return { url: out.toDataURL("image/jpeg", 0.88), canvasW: W, canvasH: totalH };
}

// ── Canvas: render das etapas → { url, canvasW, canvasH } ────────────────
function renderEtapasCanvas(steps: string[]): { url: string; canvasW: number; canvasH: number } {
  const DPR = 3;
  const W = 1100;
  const FONT = "Inter, system-ui, Arial, sans-serif";

  // dimensões internas
  const BADGE_R = 26;
  const BADGE_CX = 46;
  const TEXT_X = BADGE_CX + BADGE_R + 22;
  const TEXT_W = W - TEXT_X - 24;
  const LINE_H_TITLE = 34;
  const LINE_H_BODY = 30;
  const ROW_V_PAD = 18;
  const ARROW_H = 28; // altura da área de seta entre etapas

  // pré-calcular alturas
  const tmp = document.createElement("canvas");
  const tctx = tmp.getContext("2d")!;

  const BADGE_H = 68; // altura fixa do chevron — independe do texto
  const rowHeights = steps.map(s => {
    const colon = s.indexOf(":");
    const hasTitulo = colon > 0 && colon < 50;
    const corpo = hasTitulo ? s.substring(colon + 1).trim() : s;
    tctx.font = `400 22px ${FONT}`;
    const bodyLines = wrapText(tctx, corpo, TEXT_W);
    const titleH = hasTitulo ? LINE_H_TITLE : 0;
    return Math.max(titleH + bodyLines.length * LINE_H_BODY + ROW_V_PAD * 2, BADGE_H + ROW_V_PAD * 2);
  });

  // total inclui área de seta entre etapas (exceto após a última)
  const totalH = rowHeights.reduce((a, b) => a + b, 0) + ARROW_H * (steps.length - 1);

  const canvas = document.createElement("canvas");
  canvas.width = W * DPR;
  canvas.height = totalH * DPR;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(DPR, DPR);

  // fundo geral transparente
  ctx.clearRect(0, 0, W, totalH);

  let cy = 0;
  steps.forEach((step, i) => {
    const rh = rowHeights[i];
    const ry = cy;

    // fundo alternado
    ctx.fillStyle = i % 2 === 0 ? "#FFFFFF" : "#F4F7FB";
    ctx.beginPath(); ctx.rect(0, ry, W, rh); ctx.fill();

    // borda laranja esquerda
    ctx.fillStyle = PAL.laranja;
    ctx.fillRect(0, ry, 6, rh);

    // badge: chevron de altura fixa, centrado verticalmente na linha
    const BW = 56, BH = BADGE_H;
    const BX = 30, BY = ry + (rh - BH) / 2;
    const BCMID = BX + BW * 0.50;

    const chevronPath = () => {
      ctx.beginPath();
      ctx.moveTo(BX,             BY);              // 1: topo-esquerdo
      ctx.lineTo(BX + BW * 0.50, BY + BH * 0.35); // 2: notch (V profundo)
      ctx.lineTo(BX + BW,        BY);              // 3: topo-direito
      ctx.lineTo(BX + BW,        BY + BH * 0.65); // 4: base-direita
      ctx.lineTo(BX + BW * 0.50, BY + BH);        // 5: ponta inferior
      ctx.lineTo(BX,             BY + BH * 0.65); // 6: base-esquerda
      ctx.closePath();
    };

    ctx.save();
    ctx.shadowColor = "rgba(230,115,0,0.28)";
    ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    ctx.fillStyle = PAL.laranja;
    chevronPath(); ctx.fill();
    ctx.restore();

    ctx.fillStyle = "#FFFFFF";
    ctx.font = `700 15px ${FONT}`;
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    const numStr = String(i + 1);
    const m = ctx.measureText(numStr);
    const glyphMid = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    // número: centralizado no meio do corpo do chevron (entre 35% e 65%)
    const chevBodyCenterY = BY + BH * 0.35 + (BH * 0.30) / 2 + 5;
    ctx.fillText(numStr, BCMID, chevBodyCenterY + glyphMid);

    // texto da direita: calcular altura total do bloco para centralizar verticalmente
    const colon = step.indexOf(":");
    const hasTitulo = colon > 0 && colon < 50;
    const titulo = hasTitulo ? step.substring(0, colon).trim() : null;
    const corpo = hasTitulo ? step.substring(colon + 1).trim() : step;

    ctx.font = `400 22px ${FONT}`;
    const bodyLines = wrapText(ctx, corpo, TEXT_W);
    const totalTextH = (titulo ? LINE_H_TITLE : 0) + bodyLines.length * LINE_H_BODY;
    // início do bloco de texto centrado verticalmente na linha
    let textY = ry + (rh - totalTextH) / 2;

    ctx.textAlign = "left"; ctx.textBaseline = "top";
    if (titulo) {
      ctx.font = `700 22px ${FONT}`;
      ctx.fillStyle = PAL.azulMedio;
      ctx.fillText(titulo + ":", TEXT_X, textY);
      textY += LINE_H_TITLE;
    }
    ctx.font = `400 22px ${FONT}`;
    ctx.fillStyle = PAL.escuro;
    bodyLines.forEach(l => { ctx.fillText(l, TEXT_X, textY); textY += LINE_H_BODY; });

    // seta chevron laranja entre etapas (exceto após a última)
    if (i < steps.length - 1) {
      const ax = BCMID;           // centro X alinhado ao centro geométrico do chevron
      const ay = ry + rh;         // topo da área de seta
      const ah = ARROW_H;
      const mid = ay + ah / 2;

      // linha pontilhada de fundo
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "#D0D8E8";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(16, mid); ctx.lineTo(W - 16, mid);
      ctx.stroke();
      ctx.setLineDash([]);

      // chevron duplo laranja centrado no badge
      const chevW = 18, chevH = 10, chevGap = 6;
      [-chevGap / 2 - chevH / 2, chevGap / 2 + chevH / 2 - chevH].forEach((offset, ci) => {
        const ty = mid + offset - (ci === 0 ? 3 : -3);
        ctx.strokeStyle = PAL.laranja;
        ctx.lineWidth = ci === 0 ? 3 : 2.5;
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.globalAlpha = ci === 0 ? 1 : 0.55;
        ctx.beginPath();
        ctx.moveTo(ax - chevW / 2, ty);
        ctx.lineTo(ax, ty + chevH);
        ctx.lineTo(ax + chevW / 2, ty);
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
    }

    cy += rh + (i < steps.length - 1 ? ARROW_H : 0);
  });

  // borda externa arredondada + sombra do bloco inteiro
  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.shadowColor = "rgba(0,0,0,0.08)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.roundRect(0, 0, W, totalH, 10);
  ctx.fill();
  ctx.restore();

  // borda direita e inferior de contraste
  ctx.strokeStyle = "#D2D7E1";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(0, 0, W, totalH, 10);
  ctx.stroke();

  return { url: canvas.toDataURL("image/png"), canvasW: W, canvasH: totalH };
}

// ── Canvas: render do fluxograma → { url, w, h } ─────────────────────────
interface FluxoNo { label: string; sub: string; tipo: "inicio" | "meio" | "fim"; }

function renderFluxogramaCanvas(nos: FluxoNo[]): { url: string; canvasW: number; canvasH: number } {
  const DPR = 3;
  const FONT = "Inter, system-ui, Arial, sans-serif";
  const COLS = Math.min(nos.length, 5);
  const ROWS = Math.ceil(nos.length / COLS);

  const TOTAL_W = 1100;
  const ARROW_W = 44;
  const ROW_GAP = 48;
  const V_PAD = 16;
  const BOX_W = (TOTAL_W - (COLS - 1) * ARROW_W) / COLS;
  const BOX_H = 36 + 14 + 22 * 2 + 18 + V_PAD * 2;
  const TOTAL_H = ROWS * BOX_H + (ROWS - 1) * ROW_GAP + V_PAD * 2;

  const canvas = document.createElement("canvas");
  canvas.width = TOTAL_W * DPR;
  canvas.height = TOTAL_H * DPR;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(DPR, DPR);

  ctx.fillStyle = PAL.branco;
  ctx.fillRect(0, 0, TOTAL_W, TOTAL_H);

  const drawIconPlay = (cx: number, cy: number) => {
    ctx.fillStyle = PAL.azulMedio;
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy - 16); ctx.lineTo(cx - 14, cy + 16); ctx.lineTo(cx + 16, cy);
    ctx.closePath(); ctx.fill();
  };
  const drawIconDoc = (cx: number, cy: number) => {
    const w = 28, h = 34, fold = 8;
    const x = cx - w / 2, y = cy - h / 2;
    ctx.fillStyle = PAL.azulMedio;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + w - fold, y); ctx.lineTo(x + w, y + fold);
    ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#EBF0F8";
    ctx.beginPath();
    ctx.moveTo(x + w - fold, y); ctx.lineTo(x + w - fold, y + fold); ctx.lineTo(x + w, y + fold);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.65)"; ctx.lineWidth = 2;
    [y + fold + 6, y + fold + 12, y + fold + 18].forEach(ly => {
      ctx.beginPath(); ctx.moveTo(x + 5, ly); ctx.lineTo(x + w - 6, ly); ctx.stroke();
    });
  };
  const drawIconCheck = (cx: number, cy: number) => {
    ctx.fillStyle = PAL.azulMedio;
    ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PAL.branco; ctx.lineWidth = 3.5;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy + 1); ctx.lineTo(cx - 2, cy + 7); ctx.lineTo(cx + 9, cy - 7);
    ctx.stroke();
  };
  const drawArrow = (fromX: number, midY: number, reversed = false) => {
    const gap = ARROW_W;
    ctx.strokeStyle = "#B0BBC8"; ctx.lineWidth = 2;
    if (reversed) {
      // seta ←: começa em fromX e vai para a esquerda (gap)
      ctx.beginPath(); ctx.moveTo(fromX - 3, midY); ctx.lineTo(fromX - gap + 9, midY); ctx.stroke();
      ctx.fillStyle = "#B0BBC8";
      ctx.beginPath();
      ctx.moveTo(fromX - gap + 11, midY - 6);
      ctx.lineTo(fromX - gap + 11, midY + 6);
      ctx.lineTo(fromX - gap + 1, midY);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(fromX + 3, midY); ctx.lineTo(fromX + gap - 9, midY); ctx.stroke();
      ctx.fillStyle = "#B0BBC8";
      ctx.beginPath();
      ctx.moveTo(fromX + gap - 11, midY - 6);
      ctx.lineTo(fromX + gap - 11, midY + 6);
      ctx.lineTo(fromX + gap - 1, midY);
      ctx.closePath(); ctx.fill();
    }
  };
  const drawArrowDown = (midX: number, fromY: number) => {
    ctx.strokeStyle = "#B0BBC8"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(midX, fromY + 3); ctx.lineTo(midX, fromY + ROW_GAP - 9); ctx.stroke();
    ctx.fillStyle = "#B0BBC8";
    ctx.beginPath();
    ctx.moveTo(midX - 6, fromY + ROW_GAP - 11);
    ctx.lineTo(midX + 6, fromY + ROW_GAP - 11);
    ctx.lineTo(midX, fromY + ROW_GAP - 1);
    ctx.closePath(); ctx.fill();
  };

  nos.forEach((no, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const isOddRow = row % 2 === 1;

    // em linhas ímpares os itens vão da direita para a esquerda (snake)
    const visualCol = isOddRow ? (COLS - 1 - col) : col;
    const bx = visualCol * (BOX_W + ARROW_W);
    const by = V_PAD + row * (BOX_H + ROW_GAP);
    const cx = bx + BOX_W / 2;
    const isLastInRow = col === COLS - 1 || i === nos.length - 1;
    const hasNextRow = row < ROWS - 1 && i < nos.length - 1;

    // sombra
    ctx.save();
    ctx.shadowColor = "rgba(18,52,96,0.12)";
    ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
    ctx.fillStyle = PAL.branco;
    ctx.beginPath(); ctx.roundRect(bx, by, BOX_W, BOX_H, 12); ctx.fill();
    ctx.restore();

    // borda azul
    ctx.strokeStyle = PAL.azulMedio; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(bx, by, BOX_W, BOX_H, 12); ctx.stroke();

    const iconY = by + V_PAD + 18;
    if (no.tipo === "inicio") drawIconPlay(cx, iconY);
    else if (no.tipo === "fim") drawIconCheck(cx, iconY);
    else drawIconDoc(cx, iconY);

    ctx.font = `700 20px ${FONT}`;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillStyle = PAL.azulEscuro;
    const labelLines = wrapText(ctx, no.label, BOX_W - 18);
    const labelY = iconY + 24;
    labelLines.slice(0, 2).forEach((l, li) => ctx.fillText(l, cx, labelY + li * 23));

    if (no.sub) {
      ctx.font = `400 16px ${FONT}`;
      ctx.fillStyle = PAL.cinzaTxt;
      ctx.fillText(`(${no.sub})`, cx, labelY + Math.min(labelLines.length, 2) * 23 + 2);
    }

    // seta entre caixas na mesma linha
    if (!isLastInRow) {
      if (isOddRow) {
        // linha ímpar: seta ← da borda esquerda da caixa atual para a caixa à esquerda
        drawArrow(bx, by + BOX_H / 2, true);
      } else {
        // linha par: seta → da borda direita da caixa atual para a caixa à direita
        drawArrow(bx + BOX_W, by + BOX_H / 2, false);
      }
    }

    // seta de descida ao fim da linha (último item da linha, se há próxima)
    if (isLastInRow && hasNextRow) {
      // a seta desce da extremidade onde terminou a linha
      drawArrowDown(cx, by + BOX_H);
    }
  });

  return { url: canvas.toDataURL("image/png"), canvasW: TOTAL_W, canvasH: TOTAL_H };
}

// ── PDF ────────────────────────────────────────────────────────────────────
async function gerarPDF(item: PopItem, content: POPContent, opts: { elaborador: string; aprovador: string }): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, M = 14, CW = W - M * 2;

  type RGB = [number, number, number];
  const C: Record<string, RGB> = {
    azulEscuro: [10, 30, 60], azulMedio: [18, 52, 96], azulClaro: [235, 240, 248],
    laranja: [230, 115, 0], branco: [255, 255, 255], cinzaBorda: [210, 215, 225],
    cinzaTexto: [90, 100, 115], escuro: [20, 30, 50],
    verdeClaro: [220, 240, 225], vermClaro: [255, 235, 235],
  };

  let y = 0;

  const fillRect = (x: number, ry: number, w: number, h: number, cor: RGB) => {
    doc.setFillColor(...cor); doc.rect(x, ry, w, h, "F");
  };
  const strokeRect = (x: number, ry: number, w: number, h: number, cor: RGB, lw = 0.3) => {
    doc.setDrawColor(...cor); doc.setLineWidth(lw); doc.rect(x, ry, w, h, "D");
  };
  const txt = (text: string, x: number, ty: number, size: number, cor: RGB, style: "normal" | "bold" = "normal", align: "left" | "center" | "right" = "left") => {
    doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...cor);
    doc.text(text, x, ty, { align });
  };
  const sectionBar = (titulo: string) => {
    fillRect(M, y, CW, 8, C.azulMedio);
    txt(titulo, M + 4, y + 5.6, 8.5, C.branco, "bold");
    y += 8;
  };
  const hLine = (lx: number, rx: number, ly: number, cor = C.cinzaBorda) => {
    doc.setDrawColor(...cor); doc.setLineWidth(0.25); doc.line(lx, ly, rx, ly);
  };
  const vLine = (lx: number, ty: number, by: number, cor = C.cinzaBorda) => {
    doc.setDrawColor(...cor); doc.setLineWidth(0.25); doc.line(lx, ty, lx, by);
  };

  // ── CABEÇALHO ──────────────────────────────────────────────────────────
  fillRect(0, 0, W, 50, C.azulEscuro);
  fillRect(0, 0, W, 3, C.laranja);

  doc.setFont("helvetica", "bold"); doc.setFontSize(12.5); doc.setTextColor(...C.branco);
  const tLines = doc.splitTextToSize(`PROCEDIMENTO INTERNO: ${item.atividade.toUpperCase()}`, CW - 10);
  doc.text(tLines, W / 2, 14, { align: "center" });

  const subY = 14 + tLines.length * 6.5;
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...C.laranja);
  doc.text((item.processo || item.area).toUpperCase(), W / 2, subY, { align: "center" });

  doc.setFont("helvetica", "bold"); doc.setFontSize(7);
  const bw = doc.getTextWidth(item.id) + 10;
  const bx = W / 2 - bw / 2, by = subY + 3.5;
  fillRect(bx, by, bw, 6, C.laranja);
  doc.setTextColor(...C.branco); doc.text(item.id, W / 2, by + 4.2, { align: "center" });

  y = 54;

  // ── SEÇÃO 1: INFORMAÇÕES GERAIS ────────────────────────────────────────
  sectionBar("1. INFORMAÇÕES GERAIS DO PROCESSO");

  const gridData: [string, string][][] = [
    [["ATIVIDADE", item.atividade], ["ÁREA / DIRETORIA", item.area], ["SETOR EXECUTOR", item.setor]],
    [["RESPONSÁVEL PRINCIPAL", item.responsavel], ["BACKUP / SUBSTITUTO", item.backup || "—"], ["PERIODICIDADE", item.periodicidade || "—"]],
    [["CLASSIFICAÇÃO", item.classificacao || "—"], ["CRITICIDADE", item.criticidade || "—"], ["TEMPO DE EXECUÇÃO", item.tempoExec || "—"]],
    [["TIPO", item.tipo], ["DATA DE EMISSÃO", new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })], ["CÓDIGO", item.id]],
  ];

  const rowH = 13, colW = CW / 3;
  const gridH = gridData.length * rowH;
  fillRect(M, y, CW, gridH, C.branco);
  strokeRect(M, y, CW, gridH, C.cinzaBorda);

  gridData.forEach((row, ri) => {
    const ry = y + ri * rowH;
    if (ri > 0) hLine(M, M + CW, ry);
    row.forEach(([label, value], ci) => {
      const cx = M + ci * colW;
      if (ci > 0) vLine(cx, ry, ry + rowH);
      txt(label, cx + 3, ry + 4.5, 6, C.cinzaTexto, "bold");
      txt(doc.splitTextToSize(value || "—", colW - 6)[0], cx + 3, ry + 9.5, 8, C.escuro, "bold");
    });
  });

  y += gridH + 6;

  // ── SEÇÃO 2: RECURSOS E DEPENDÊNCIAS ──────────────────────────────────
  if (item.recurso || item.depProcesso || item.depArea) {
    sectionBar("2. RECURSOS E DEPENDÊNCIAS");
    const res: [string, string][] = [
      ["SISTEMAS / RECURSOS", item.recurso || "—"],
      ["DEPENDÊNCIA DE PROCESSO", item.depProcesso || "—"],
      ["DEPENDÊNCIA DE ÁREA", item.depArea || "—"],
    ];
    const resRowH = 12;
    fillRect(M, y, CW, res.length * resRowH, C.branco);
    strokeRect(M, y, CW, res.length * resRowH, C.cinzaBorda);
    res.forEach(([label, value], ri) => {
      const ry = y + ri * resRowH;
      if (ri > 0) hLine(M, M + CW, ry);
      fillRect(M, ry, 52, resRowH, C.azulClaro);
      vLine(M + 52, ry, ry + resRowH);
      txt(label, M + 3, ry + 4.5, 6.5, C.azulMedio, "bold");
      txt(doc.splitTextToSize(value, CW - 58)[0], M + 56, ry + 7.5, 8, C.escuro, "normal");
    });
    y += res.length * resRowH + 6;
  }

  // ── SEÇÃO 3: OBJETIVO ─────────────────────────────────────────────────
  const secNum = item.recurso || item.depProcesso || item.depArea ? "3" : "2";
  sectionBar(`${secNum}. OBJETIVO DO PROCEDIMENTO`);

  const objLines = doc.splitTextToSize(content.objetivo, CW - 10);
  const objH = objLines.length * 5 + 10;
  fillRect(M, y, CW, objH, C.branco);
  strokeRect(M, y, CW, objH, C.cinzaBorda);
  fillRect(M, y, 3, objH, C.laranja);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...C.escuro);
  doc.text(objLines, M + 7, y + 6);
  y += objH + 6;

  // ── SEÇÃO 4: ETAPAS via Canvas ────────────────────────────────────────
  const secNum2 = Number(secNum) + 1;
  sectionBar(`${secNum2}. PASSO A PASSO SEQUENCIAL`);

  const steps = content.procedimento;

  if (steps.length === 0) {
    fillRect(M, y, CW, 12, C.azulClaro);
    txt("Nenhuma etapa definida.", M + 6, y + 8, 8.5, C.cinzaTexto);
    y += 16;
  } else {
    // cada etapa é um canvas independente → permite quebra de página entre etapas
    for (let si = 0; si < steps.length; si++) {
      const { url: png, canvasW: eW, canvasH: eH } = renderEtapaCanvas(steps[si], si, steps.length);
      const h = CW * eH / eW;
      if (y + h > 272) { doc.addPage(); y = 14; }
      doc.addImage(png, "JPEG", M, y, CW, h);
      y += h;
    }
    y += 5;
  }

  // ── SEÇÃO 5: FLUXOGRAMA via Canvas ────────────────────────────────────
  const secNum3 = secNum2 + 1;
  if (y > 215) { doc.addPage(); y = 14; }
  sectionBar(`${secNum3}. DIAGRAMA DE FLUXO`);

  if (item.fluxogramaImg) {
    try {
      fillRect(M, y, CW, 62, C.branco);
      doc.addImage(item.fluxogramaImg, "JPEG", M + 3, y + 3, CW - 6, 56);
      y += 66;
    } catch { /* fallback gerado */ }
  }

  if (!item.fluxogramaImg) {
    const nosFluxo: FluxoNo[] = [
      { label: "INÍCIO", sub: item.setor || item.area, tipo: "inicio" },
      ...steps.map((s, si) => {
        const nomeCustom = (item.nomesFluxo ?? [])[si]?.trim();
        let label: string;
        if (nomeCustom) {
          label = nomeCustom.toUpperCase();
        } else {
          const colon = s.indexOf(":");
          label = colon > 0 && colon < 45
            ? s.substring(0, colon).trim().toUpperCase()
            : s.split(" ").slice(0, 4).join(" ").toUpperCase();
        }
        return { label, sub: item.responsavel || `Etapa ${si + 1}`, tipo: "meio" as const };
      }),
      { label: "CONCLUÍDO", sub: "Processo finalizado", tipo: "fim" },
    ];

    const { url: fluxPng, canvasW: fW, canvasH: fH } = renderFluxogramaCanvas(nosFluxo);
    // altura proporcional exata — sem distorção
    const fluxH = CW * fH / fW;
    if (y + fluxH > 272) { doc.addPage(); y = 14; }
    doc.addImage(fluxPng, "PNG", M, y, CW, fluxH);
    y += fluxH + 4;
  }

  // ── SEÇÃO 6: CONTROLE DE QUALIDADE ────────────────────────────────────
  if (item.criterioExito || item.acaoInconsistencia) {
    const secNum4 = secNum3 + 1;
    if (y > 235) { doc.addPage(); y = 14; }
    sectionBar(`${secNum4}. CONTROLE DE QUALIDADE`);

    const cqRows: [string, string, RGB][] = [
      ["CRITÉRIO DE ÊXITO", item.criterioExito || "—", C.verdeClaro],
      ["AÇÕES EM CASO DE INCONSISTÊNCIA", item.acaoInconsistencia || "—", C.vermClaro],
    ];
    cqRows.forEach(([label, value, bg]) => {
      const vl = doc.splitTextToSize(value, CW - 58);
      const rh = Math.max(vl.length * 5 + 8, 14);
      fillRect(M, y, CW, rh, C.branco);
      strokeRect(M, y, CW, rh, C.cinzaBorda);
      fillRect(M, y, 52, rh, bg);
      vLine(M + 52, y, y + rh);
      txt(label, M + 3, y + 5, 6.5, C.azulMedio, "bold");
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...C.escuro);
      doc.text(vl, M + 56, y + 6);
      y += rh + 3;
    });
    y += 3;
  }

  // ── RODAPÉ ────────────────────────────────────────────────────────────
  const FY = 272;
  doc.setDrawColor(...C.cinzaTexto); doc.setLineWidth(0.25);
  doc.line(M, FY, M + 60, FY);
  doc.line(W - M - 60, FY, W - M, FY);
  txt("ELABORADOR", M + 30, FY + 4, 7, C.cinzaTexto, "bold", "center");
  txt(opts.elaborador, M + 30, FY + 8.5, 7.5, C.cinzaTexto, "normal", "center");
  txt("APROVADOR", W - M - 30, FY + 4, 7, C.cinzaTexto, "bold", "center");
  txt(opts.aprovador, W - M - 30, FY + 8.5, 7.5, C.cinzaTexto, "normal", "center");

  fillRect(0, 283, W, 2, C.laranja);
  fillRect(0, 285, W, 12, C.azulEscuro);
  txt("GRUPO NASCIMENTO", W / 2, 291, 8, C.branco, "bold", "center");
  txt("Documento gerado e controlado por Controladoria Interna", W / 2, 294.5, 6, C.cinzaBorda, "normal", "center");

  return doc;
}

// ── parser Excel ───────────────────────────────────────────────────────────
function parseExcel(file: File): Promise<PopItem[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        const items: PopItem[] = rows.slice(2).filter((r) => r[1]).map((r) => ({
          seq: String(r[0] || ""), area: String(r[1] || ""), setor: String(r[2] || ""),
          atividade: String(r[3] || ""), periodicidade: String(r[4] || ""),
          responsavel: String(r[5] || ""), classificacao: String(r[6] || ""),
          backup: String(r[8] || ""), recurso: String(r[9] || ""),
          criticidade: String(r[10] || ""), depProcesso: String(r[12] || ""),
          depArea: String(r[13] || ""), tempoExec: (() => {
            const v = r[14];
            if (typeof v === "number" && v > 0 && v < 1) {
              const totalMin = Math.round(v * 24 * 60);
              const h = Math.floor(totalMin / 60);
              const m = totalMin % 60;
              return `${h}:${String(m).padStart(2, "0")}`;
            }
            return String(v || "");
          })(),
          descDetalhada: String(r[15] || ""), processo: String(r[16] || ""),
          id: gerarId(String(r[1] || ""), String(r[2] || "")),
          gerado: false, selected: false, tipo: "PRÉVIA", nomesFluxo: [],
          etapas: null, criterioExito: "", acaoInconsistencia: "",
        }));
        resolve(items);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsBinaryString(file);
  });
}

// ── Modal Etapas ───────────────────────────────────────────────────────────
function ModalEtapas({ item, onSalvar, onClose }: {
  item: PopItem;
  onSalvar: (etapas: string[], nomesFluxo: string[], criterioExito: string, acaoInconsistencia: string) => void;
  onClose: () => void;
}) {
  const [etapas, setEtapas] = useState<string[]>(item.etapas ?? [""]);
  const etapaCount = (item.etapas ?? [""]).length;
  const [nomesFluxo, setNomesFluxo] = useState<string[]>(
    () => Array.from({ length: etapaCount }, (_, i) => (item.nomesFluxo ?? [])[i] ?? "")
  );
  const [criterio, setCriterio] = useState(item.criterioExito);
  const [acao, setAcao] = useState(item.acaoInconsistencia);

  const addEtapa = () => { setEtapas(p => [...p, ""]); setNomesFluxo(p => [...p, ""]); };
  const removeEtapa = (i: number) => {
    setEtapas(p => p.filter((_, j) => j !== i));
    setNomesFluxo(p => p.filter((_, j) => j !== i));
  };
  const updateEtapa = (i: number, v: string) => setEtapas(p => p.map((e, j) => j === i ? v : e));
  const updateNomeFluxo = (i: number, v: string) => setNomesFluxo(p => {
    const arr = Array.from({ length: Math.max(p.length, i + 1) }, (_, j) => p[j] ?? "");
    arr[i] = v;
    return arr;
  });
  const validas = etapas.filter(e => e.trim().length > 0);

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="text-base">
            Definir Etapas —{" "}
            <span className="font-normal text-muted-foreground">{item.atividade}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden min-h-0">
          <div className="w-1/2 border-r border-border flex flex-col overflow-hidden">
            <div className="px-4 py-2 bg-muted/40 border-b border-border shrink-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Descrição Detalhada (referência)
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                {item.descDetalhada || <span className="text-muted-foreground italic">Sem descrição.</span>}
              </p>
            </div>
          </div>

          <div className="w-1/2 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto">
              <div className="px-4 py-2 bg-muted/40 border-b border-border">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                  Etapas do POP
                  <span className="normal-case font-normal">{validas.length} definida{validas.length !== 1 ? "s" : ""}</span>
                </p>
              </div>

              <div className="p-4 space-y-3">
                {etapas.map((etapa, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
                      {i + 1}
                    </div>
                    <div className="flex-1 space-y-1">
                      <Textarea value={etapa} onChange={e => updateEtapa(i, e.target.value)}
                        placeholder={`Etapa ${i + 1}…`} className="min-h-[56px] w-full resize-none text-sm" rows={2} />
                      <input
                        type="text"
                        value={nomesFluxo[i] ?? ""}
                        onChange={e => updateNomeFluxo(i, e.target.value)}
                        placeholder="Nome no fluxograma (ex: ADMINISTRAÇÃO)"
                        className="w-full rounded border border-border bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <Button variant="ghost" size="icon"
                      className="mt-1.5 h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeEtapa(i)} disabled={etapas.length === 1}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addEtapa} className="w-full gap-2 text-muted-foreground">
                  <Plus className="h-3.5 w-3.5" /> Adicionar etapa
                </Button>
              </div>

              <div className="px-4 py-2 bg-muted/40 border-y border-border">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Controle de Qualidade <span className="normal-case font-normal text-muted-foreground/70">(opcional)</span>
                </p>
              </div>

              <div className="p-4 space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-green-700">Critério de Êxito</Label>
                  <Textarea value={criterio} onChange={e => setCriterio(e.target.value)}
                    placeholder="O que define que a tarefa foi concluída com sucesso?"
                    className="min-h-[60px] resize-none text-sm border-green-200 focus:border-green-400" rows={2} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-red-700">Ações em caso de Inconsistência</Label>
                  <Textarea value={acao} onChange={e => setAcao(e.target.value)}
                    placeholder="O que fazer se algo der errado?"
                    className="min-h-[60px] resize-none text-sm border-red-200 focus:border-red-400" rows={2} />
                </div>
              </div>
            </div>

            {validas.length === 0 && (
              <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" /> Defina ao menos uma etapa.
              </div>
            )}

            <div className="border-t border-border px-4 py-3 flex justify-end gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
              <Button size="sm" className="btn-relief gap-2" disabled={validas.length === 0}
                onClick={() => { onSalvar(validas, nomesFluxo, criterio, acao); onClose(); }}>
                <CheckCircle2 className="h-4 w-4" /> Confirmar
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── componente principal ───────────────────────────────────────────────────
export default function GeradorPops() {
  const { toast } = useToast();
  const [items, setItems] = useState<PopItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [editandoIdx, setEditandoIdx] = useState<number | null>(null);
  const [previewState, setPreviewState] = useState<{ item: PopItem; content: POPContent; url: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ELABORADOR = "Controladoria Interna";
  const APROVADOR  = "Diretoria Executiva";

  const allSelected   = items.length > 0 && items.every(i => i.selected);
  const someSelected  = items.some(i => i.selected);
  const selectedCount = items.filter(i => i.selected).length;
  const semEtapas     = items.filter(i => i.selected && !i.etapas).length;

  const handleUpload = async (file: File) => {
    try {
      const parsed = await parseExcel(file);
      setItems(parsed);
      toast({ title: `${parsed.length} atividades carregadas`, description: file.name });
    } catch {
      toast({ title: "Erro ao ler o arquivo", description: "Verifique se é um .xlsx válido.", variant: "destructive" });
    }
  };

  const toggleAll  = () => setItems(p => p.map(i => ({ ...i, selected: !allSelected })));
  const toggleItem = (idx: number) => setItems(p => p.map((it, i) => i === idx ? { ...it, selected: !it.selected } : it));
  const setTipo    = (idx: number, tipo: "PRÉVIA" | "PUBLICAÇÃO") =>
    setItems(p => p.map((it, i) => i === idx ? { ...it, tipo } : it));
  const salvarEtapas = (idx: number, etapas: string[], nomesFluxo: string[], criterioExito: string, acaoInconsistencia: string) =>
    setItems(p => p.map((it, i) => i === idx ? { ...it, etapas, nomesFluxo, criterioExito, acaoInconsistencia } : it));
  const setFluxograma = useCallback((idx: number, file: File) => {
    const reader = new FileReader();
    reader.onload = e => setItems(p => p.map((it, i) =>
      i === idx ? { ...it, fluxogramaImg: e.target?.result as string, fluxogramaFileName: file.name } : it));
    reader.readAsDataURL(file);
  }, []);

  const openPreview = async (item: PopItem) => {
    if (!item.etapas) { toast({ title: "Defina as etapas primeiro", variant: "destructive" }); return; }
    const content = montarConteudo(item);
    const doc = await gerarPDF(item, content, { elaborador: ELABORADOR, aprovador: APROVADOR });
    const url = URL.createObjectURL(doc.output("blob"));
    if (previewState) URL.revokeObjectURL(previewState.url);
    setPreviewState({ item, content, url });
  };

  const gerarSelecionados = async () => {
    if (semEtapas > 0) {
      toast({ title: `${semEtapas} atividade${semEtapas > 1 ? "s" : ""} sem etapas`, description: "Defina as etapas antes de gerar.", variant: "destructive" });
      return;
    }
    const sel = items.filter(i => i.selected);
    setProcessing(true);
    setProgress({ current: 0, total: sel.length });
    for (let k = 0; k < sel.length; k++) {
      const item = sel[k];
      setProgress({ current: k + 1, total: sel.length });
      try {
        const content = montarConteudo(item);
        const doc = await gerarPDF(item, content, { elaborador: ELABORADOR, aprovador: APROVADOR });
        doc.save(`POP_${item.id}.pdf`);
        setItems(p => p.map(it => it.id === item.id ? { ...it, gerado: true, selected: false } : it));
      } catch (e: any) {
        toast({ title: `Erro: ${item.atividade}`, description: e.message, variant: "destructive" });
      }
    }
    setProgress(null);
    setProcessing(false);
    toast({ title: "POPs gerados com sucesso!" });
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader title="Gerador de POPs" subtitle="Importe a planilha, defina as etapas e gere os PDFs."
        module="Controladoria & Orçamento" breadcrumb={["Ferramentas", "Gerador de POPs"]} />

      {items.length === 0 && (
        <div
          className="card-elevated flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border py-16 text-center cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}>
          <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
          <FileSpreadsheet className="h-12 w-12 text-primary/60" />
          <div>
            <p className="font-semibold text-foreground">Carregar planilha de mapeamento</p>
            <p className="text-sm text-muted-foreground mt-1">Arraste ou clique para selecionar o arquivo .xlsx</p>
          </div>
          <Button variant="outline" size="sm" onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}>
            Selecionar arquivo
          </Button>
        </div>
      )}

      {items.length > 0 && (
        <div className="card-elevated overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-3">
              <Checkbox checked={allSelected} onCheckedChange={toggleAll}
                className="data-[state=checked]:bg-primary data-[state=checked]:border-primary" />
              <span className="text-sm text-muted-foreground">
                {selectedCount > 0 ? `${selectedCount} selecionada${selectedCount > 1 ? "s" : ""}` : `${items.length} atividades`}
              </span>
              {semEtapas > 0 && someSelected && (
                <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                  <AlertCircle className="h-3.5 w-3.5" />{semEtapas} sem etapas
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setItems([])}>Trocar planilha</Button>
              <Button size="sm" disabled={!someSelected || processing} onClick={gerarSelecionados} className="btn-relief gap-2">
                {processing
                  ? <><RefreshCw className="h-4 w-4 animate-spin" />{progress ? `Gerando ${progress.current}/${progress.total}…` : "Processando…"}</>
                  : <><Download className="h-4 w-4" />Gerar PDFs</>}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-2 bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <div className="col-span-1" />
            <div className="col-span-2">Área / Setor</div>
            <div className="col-span-2">Processo</div>
            <div className="col-span-3">Atividade</div>
            <div className="col-span-1 text-center">Criticidade</div>
            <div className="col-span-3 text-right">Ações</div>
          </div>

          <div className="divide-y divide-border/60">
            {items.map((item, idx) => (
              <div key={item.id}
                className={`grid grid-cols-12 gap-2 items-center px-4 py-3 transition-colors ${item.selected ? "bg-primary/5" : "hover:bg-muted/30"} ${item.gerado ? "opacity-50" : ""}`}>
                <div className="col-span-1 flex items-center gap-2">
                  <Checkbox checked={item.selected} disabled={item.gerado} onCheckedChange={() => toggleItem(idx)}
                    className="data-[state=checked]:bg-primary data-[state=checked]:border-primary" />
                  {item.gerado && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                </div>
                <div className="col-span-2 min-w-0">
                  <p className="font-semibold text-sm truncate">{item.area}</p>
                  <p className="text-xs text-muted-foreground truncate">{item.setor}</p>
                </div>
                <div className="col-span-2 min-w-0">
                  <p className="text-xs text-muted-foreground truncate">{item.processo || "—"}</p>
                </div>
                <div className="col-span-3 min-w-0">
                  <p className="text-sm font-medium leading-snug line-clamp-2">{item.atividade}</p>
                </div>
                <div className="col-span-1 flex justify-center">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${criticidadeBadge(item.criticidade)}`}>
                    {item.criticidade || "—"}
                  </span>
                </div>
                <div className="col-span-3 flex items-center gap-1.5 justify-end flex-wrap">
                  <Button variant={item.etapas ? "outline" : "default"} size="sm"
                    className={`h-7 gap-1 text-[11px] px-2 ${item.etapas ? "text-green-700 border-green-300 bg-green-50 hover:bg-green-100" : "btn-relief"}`}
                    onClick={() => setEditandoIdx(idx)} disabled={item.gerado}>
                    <ListChecks className="h-3 w-3" />
                    {item.etapas ? `${item.etapas.length} etapas` : "Definir Etapas"}
                  </Button>

                  <Select value={item.tipo} onValueChange={v => setTipo(idx, v as any)} disabled={item.gerado}>
                    <SelectTrigger className="h-7 w-24 text-[11px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PRÉVIA">PRÉVIA</SelectItem>
                      <SelectItem value="PUBLICAÇÃO">PUBLICAÇÃO</SelectItem>
                    </SelectContent>
                  </Select>

                  <label className="cursor-pointer flex items-center gap-1 rounded border border-border px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted transition-colors" title="Anexar fluxograma">
                    <Paperclip className="h-3 w-3" />{item.fluxogramaFileName ? "✓" : ""}
                    <input type="file" accept="image/*" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) setFluxograma(idx, f); }} />
                  </label>

                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Pré-visualizar"
                    onClick={() => openPreview(item)} disabled={processing || !item.etapas}>
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-border bg-muted/20 px-4 py-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{items.filter(i => i.gerado).length} de {items.length} gerados</span>
            {progress && (
              <span className="flex items-center gap-1.5 text-primary font-medium">
                <RefreshCw className="h-3 w-3 animate-spin" />Gerando PDFs…
              </span>
            )}
          </div>
        </div>
      )}

      {editandoIdx !== null && (
        <ModalEtapas item={items[editandoIdx]}
          onSalvar={(etapas, nomesFluxo, criterio, acao) => salvarEtapas(editandoIdx, etapas, nomesFluxo, criterio, acao)}
          onClose={() => setEditandoIdx(null)} />
      )}

      <Dialog open={!!previewState} onOpenChange={o => {
        if (!o && previewState) { URL.revokeObjectURL(previewState.url); setPreviewState(null); }
      }}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <div className="flex items-center justify-between pr-8">
              <DialogTitle>Prévia — {previewState?.item.atividade}</DialogTitle>
              <Button size="sm" className="btn-relief gap-2" onClick={async () => {
                if (!previewState) return;
                const doc = await gerarPDF(previewState.item, previewState.content, { elaborador: ELABORADOR, aprovador: APROVADOR });
                doc.save(`POP_${previewState.item.id}.pdf`);
                setItems(p => p.map(it => it.id === previewState.item.id ? { ...it, gerado: true } : it));
                setPreviewState(null);
              }}>
                <Download className="h-4 w-4" />Baixar PDF
              </Button>
            </div>
          </DialogHeader>
          {previewState && <iframe src={previewState.url} className="flex-1 w-full rounded-b-lg" title="Prévia do POP" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
