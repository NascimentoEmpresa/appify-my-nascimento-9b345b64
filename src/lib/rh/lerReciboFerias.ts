// =====================================================================
// RH › Gestão de Férias — extrai o TEXTO do recibo anexado (04/11/2026).
// A interpretação (valor, provas, de quem é) mora em reciboFerias.ts, que é
// puro e testado; aqui só o trabalho de navegador:
//   1. PDF com texto (o recibo exportado direto da Senior): pdf.js lê a
//      camada de texto, montada linha a linha pela posição vertical.
//   2. Sem texto, ou sem valor confiável nele (o recibo ESCANEADO depois de
//      assinado — o caso de hoje): cada página vira imagem (~300 dpi) e
//      passa por OCR (tesseract.js, português).
//   3. Imagem (JPG/PNG): direto no OCR.
// pdf.js e tesseract.js são importados só aqui, sob demanda — não pesam no
// carregamento do ERP. O tesseract baixa o motor e o idioma (~15 MB) da CDN
// na primeira leitura; o navegador guarda em cache para as próximas.
// =====================================================================
import { conferirValor, juntarLeituras, lerTextoRecibo, type LeituraRecibo } from "./reciboFerias";

export interface ResultadoLeitura {
  leitura: LeituraRecibo;
  texto: string;
  origem: "texto do PDF" | "OCR" | "texto do PDF + OCR";
}

const MAX_PAGINAS = 6;

type Progresso = (msg: string) => void;

async function abrirPdf(arquivo: File) {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
}

type DocPdf = Awaited<ReturnType<typeof abrirPdf>>;

/** Camada de texto do PDF, uma linha por posição vertical. */
async function textoDoPdf(doc: DocPdf): Promise<string> {
  const paginas: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGINAS); p++) {
    const pg = await doc.getPage(p);
    const tc = await pg.getTextContent();
    const linhas = new Map<number, { x: number; s: string }[]>();
    for (const it of tc.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 2) * 2; // tolera 1 pt de desalinhamento
      const lista = linhas.get(y) ?? [];
      lista.push({ x: it.transform[4], s: it.str });
      linhas.set(y, lista);
    }
    paginas.push([...linhas.keys()].sort((a, b) => b - a)
      .map((y) => linhas.get(y)!.sort((a, b) => a.x - b.x).map((o) => o.s).join(" ")).join("\n"));
  }
  return paginas.join("\n");
}

/** Cada página do PDF como imagem de ~2.400 px de largura (≈300 dpi no A4). */
async function paginasComoImagem(doc: DocPdf): Promise<HTMLCanvasElement[]> {
  const telas: HTMLCanvasElement[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGINAS); p++) {
    const pg = await doc.getPage(p);
    const base = pg.getViewport({ scale: 1 });
    const viewport = pg.getViewport({ scale: Math.min(4, 2400 / base.width) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("O navegador não deixou desenhar a página do PDF.");
    // intent "print": o pdf.js não agenda o desenho por requestAnimationFrame,
    // que não dispara com a aba em segundo plano — o RH que troca de aba
    // enquanto o recibo é lido não fica com a leitura parada (visto no teste).
    await pg.render({ canvasContext: ctx, viewport, intent: "print" }).promise;
    telas.push(canvas);
  }
  return telas;
}

async function ocr(imagens: (HTMLCanvasElement | File)[], progresso?: Progresso): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  progresso?.("Preparando a leitura da imagem (a primeira vez demora um pouco)…");
  const worker = await createWorker("por");
  try {
    const textos: string[] = [];
    for (let i = 0; i < imagens.length; i++) {
      progresso?.(`Lendo a página ${i + 1} de ${imagens.length}…`);
      const { data } = await worker.recognize(imagens[i]);
      textos.push(data.text);
    }
    return textos.join("\n");
  } finally {
    await worker.terminate();
  }
}

export async function lerReciboFerias(arquivo: File, progresso?: Progresso): Promise<ResultadoLeitura> {
  const ehPdf = arquivo.type === "application/pdf" || /\.pdf$/i.test(arquivo.name);
  if (!ehPdf) {
    const texto = await ocr([arquivo], progresso);
    return { leitura: lerTextoRecibo(texto), texto, origem: "OCR" };
  }

  progresso?.("Abrindo o PDF…");
  const doc = await abrirPdf(arquivo);
  try {
    const textoPdf = await textoDoPdf(doc);
    const leituraPdf = lerTextoRecibo(textoPdf);
    if (textoPdf.trim() && conferirValor(leituraPdf).confiavel) {
      return { leitura: leituraPdf, texto: textoPdf, origem: "texto do PDF" };
    }
    progresso?.("O PDF é escaneado — convertendo as páginas em imagem…");
    const textoOcr = await ocr(await paginasComoImagem(doc), progresso);
    const leituraOcr = lerTextoRecibo(textoOcr);
    if (!textoPdf.trim()) return { leitura: leituraOcr, texto: textoOcr, origem: "OCR" };
    return { leitura: juntarLeituras(leituraPdf, leituraOcr), texto: `${textoPdf}\n${textoOcr}`, origem: "texto do PDF + OCR" };
  } finally {
    void doc.destroy();
  }
}
