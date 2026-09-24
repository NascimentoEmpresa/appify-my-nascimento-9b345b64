// =====================================================================
// NASCIMENTO FORMULÁRIOS — exportar respostas em PDF (24/09/2026).
//
// Pedido: "exportar os formulários em PDF individualmente ou por algum filtro
// ou resposta de todos". A tela (FormularioRespostas) resolve quem respondeu,
// nomes vinculados e anonimato — este módulo só recebe o que já vai impresso
// e desenha: capa com o formulário e o recorte, depois UMA RESPOSTA POR
// PÁGINA (pergunta em cima, resposta embaixo, igual à aba Individuais).
//
// Helvetica do jsPDF só tem Latin-1: acento e ç saem; emoji e "★" não —
// por isso a nota da pergunta "colegas" chega como texto ("nota 4").
// =====================================================================
import jsPDF from "jspdf";

export interface BlocoPdf {
  pergunta: string;
  /** Uma linha por item (caixas de seleção, colegas); texto simples = 1 item. */
  itens: string[];
  anexo?: string | null;
  /** Pergunta que foi apagada do formulário depois da resposta. */
  removida?: boolean;
}

export interface RespostaPdf {
  quem: string;
  email?: string | null;
  enviadoEm: string;
  setor?: string | null;
  anonima?: boolean;
  duracao?: string | null;
  blocos: BlocoPdf[];
}

export interface EntradaPdf {
  formulario: string;
  descricao?: string | null;
  /** Ex.: "Setor: RH · De 01/09/2026 até 24/09/2026" ou "Todas as respostas". */
  recorte: string;
  respostas: RespostaPdf[];
  nomeArquivo: string;
}

const NAVY: [number, number, number] = [15, 49, 113];
const CINZA: [number, number, number] = [100, 116, 139];
const CINZA_CLARO: [number, number, number] = [148, 163, 184];
const TEXTO: [number, number, number] = [15, 23, 42];
const X0 = 15;
const X1 = 195;
const LARG = X1 - X0;
const TOPO = 30;
const FIM = 280;

/** DD/MM/AAAA HH:MM no horário local. */
export function dataHoraBr(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(+d)) return String(iso);
  return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

// Tira o que a Helvetica não desenha (emoji, símbolos fora do Latin-1),
// senão o jsPDF imprime lixo no lugar.
const limpo = (s: string) => String(s ?? "").replace(/[^\u0009\u000A\u000D -ÿ–—‘’“”•…]/g, "").trim();

/** Monta o documento (separado do download para dar para testar). */
export function montarPdfRespostas(e: EntradaPdf): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const geradoEm = dataHoraBr(new Date().toISOString());
  let y = TOPO;

  const cabecalho = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...NAVY);
    doc.text(doc.splitTextToSize(limpo(e.formulario), LARG - 60)[0] ?? "", X0, 15);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...CINZA_CLARO);
    doc.text(`Gerado em ${geradoEm}`, X1, 15, { align: "right" });
    doc.setDrawColor(...NAVY);
    doc.setLineWidth(0.6);
    doc.line(X0, 19, X1, 19);
  };
  const novaPagina = () => { doc.addPage(); cabecalho(); y = TOPO; };
  const espaco = (mm: number) => { if (y + mm > FIM) novaPagina(); };

  /** Texto com quebra de linha e de página. */
  const escrever = (texto: string, o: { tam?: number; negrito?: boolean; italico?: boolean; cor?: [number, number, number]; x?: number; larg?: number; entre?: number } = {}) => {
    const tam = o.tam ?? 10;
    doc.setFont("helvetica", o.negrito ? "bold" : o.italico ? "italic" : "normal");
    doc.setFontSize(tam);
    doc.setTextColor(...(o.cor ?? TEXTO));
    const alt = tam * 0.42;
    for (const linha of doc.splitTextToSize(limpo(texto) || "-", o.larg ?? LARG) as string[]) {
      espaco(alt);
      doc.text(linha, o.x ?? X0, y);
      y += alt;
    }
    y += o.entre ?? 0;
  };

  // ── Capa ──
  cabecalho();
  y = 45;
  escrever(e.formulario, { tam: 18, negrito: true, cor: NAVY, entre: 3 });
  if (e.descricao?.trim()) escrever(e.descricao, { tam: 9.5, cor: CINZA, entre: 6 });
  const linhaCapa = (rotulo: string, valor: string) => {
    escrever(rotulo.toUpperCase(), { tam: 7.5, negrito: true, cor: CINZA_CLARO, entre: 0.5 });
    escrever(valor, { tam: 11, entre: 4 });
  };
  linhaCapa("Recorte", e.recorte);
  linhaCapa("Respostas neste PDF", String(e.respostas.length));
  if (e.respostas.length) {
    const datas = e.respostas.map((r) => new Date(r.enviadoEm).getTime()).filter((t) => !isNaN(t));
    if (datas.length) {
      const de = new Date(Math.min(...datas)).toLocaleDateString("pt-BR");
      const ate = new Date(Math.max(...datas)).toLocaleDateString("pt-BR");
      linhaCapa("Período das respostas", de === ate ? de : `${de} a ${ate}`);
    }
  }

  // ── Uma resposta por página ──
  e.respostas.forEach((r, i) => {
    novaPagina();
    // Faixa de identificação da resposta
    doc.setFillColor(238, 244, 255);
    doc.roundedRect(X0, y - 5, LARG, 16, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...NAVY);
    doc.text(doc.splitTextToSize(limpo(r.quem) || "-", LARG - 45)[0] ?? "", X0 + 4, y + 1);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...CINZA);
    doc.text(`Resposta ${i + 1} de ${e.respostas.length}`, X1 - 4, y + 1, { align: "right" });
    const meta = [
      `Enviada em ${dataHoraBr(r.enviadoEm)}`,
      r.anonima ? "Anônima" : "",
      !r.anonima && r.email ? r.email : "",
      !r.anonima && r.setor ? `Setor: ${r.setor}` : "",
      r.duracao ? `Tempo: ${r.duracao}` : "",
    ].filter(Boolean).join("  ·  ");
    doc.text(doc.splitTextToSize(limpo(meta), LARG - 8)[0] ?? "", X0 + 4, y + 7);
    y += 18;

    for (const b of r.blocos) {
      espaco(12);
      escrever(b.removida ? `Pergunta removida do formulário` : b.pergunta, { tam: 8.5, negrito: true, cor: b.removida ? [180, 83, 9] : CINZA, entre: 1.2 });
      const itens = b.itens.filter((t) => String(t ?? "").trim());
      if (itens.length > 1) {
        for (const t of itens) escrever(`•  ${t}`, { tam: 10, x: X0 + 3, larg: LARG - 3, entre: 0.8 });
      } else {
        escrever(itens[0] ?? "-", { tam: 10, entre: 0 });
      }
      if (b.anexo) escrever(`Anexo: ${b.anexo}`, { tam: 8, cor: [3, 105, 161], entre: 0 });
      y += 3;
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.2);
      espaco(2);
      doc.line(X0, y - 1.5, X1, y - 1.5);
      y += 1.5;
    }
  });

  // ── Rodapé: página N de M ──
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...CINZA_CLARO);
    doc.text(`Página ${p} de ${total}`, X1, 290, { align: "right" });
    doc.text("Nascimento Formulários", X0, 290);
  }

  return doc;
}

export function gerarPdfRespostas(e: EntradaPdf): void {
  montarPdfRespostas(e).save(e.nomeArquivo);
}
