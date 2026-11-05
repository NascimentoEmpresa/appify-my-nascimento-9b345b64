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

/**
 * Camada de texto de UMA página, uma linha por posição vertical. Itens a até
 * 3 pt de altura um do outro são a mesma linha: na relação bancária do lote
 * (05/11/2026) o valor sai 1,2 pt acima do nome — arredondando a altura de 2
 * em 2 pt, ele caía numa linha só dele e a linha da pessoa ficava sem valor.
 */
async function textoDaPagina(doc: DocPdf, p: number): Promise<string> {
  const pg = await doc.getPage(p);
  const tc = await pg.getTextContent();
  const itens: { x: number; y: number; s: string }[] = [];
  for (const it of tc.items) {
    if (!("str" in it) || !it.str.trim()) continue;
    itens.push({ x: it.transform[4], y: it.transform[5], s: it.str });
  }
  itens.sort((a, b) => b.y - a.y);
  const linhas: { y: number; itens: typeof itens }[] = [];
  for (const it of itens) {
    const ultima = linhas[linhas.length - 1];
    if (ultima && ultima.y - it.y <= 3) ultima.itens.push(it);
    else linhas.push({ y: it.y, itens: [it] });
  }
  return linhas.map((l) => l.itens.sort((a, b) => a.x - b.x).map((o) => o.s).join(" ")).join("\n");
}

async function textoDoPdf(doc: DocPdf): Promise<string> {
  const paginas: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGINAS); p++) paginas.push(await textoDaPagina(doc, p));
  return paginas.join("\n");
}

async function paginaComoImagem(doc: DocPdf, p: number): Promise<HTMLCanvasElement> {
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
  return canvas;
}

/** Cada página do PDF como imagem de ~2.400 px de largura (≈300 dpi no A4). */
async function paginasComoImagem(doc: DocPdf): Promise<HTMLCanvasElement[]> {
  const telas: HTMLCanvasElement[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGINAS); p++) telas.push(await paginaComoImagem(doc, p));
  return telas;
}

async function ocrPorPagina(imagens: (HTMLCanvasElement | File)[], progresso?: Progresso): Promise<string[]> {
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
    return textos;
  } finally {
    await worker.terminate();
  }
}

async function ocr(imagens: (HTMLCanvasElement | File)[], progresso?: Progresso): Promise<string> {
  return (await ocrPorPagina(imagens, progresso)).join("\n");
}

/** Lote (Malote em massa): até 80 páginas — relação bancária + um recibo por pessoa. */
const MAX_PAGINAS_LOTE = 80;

export interface PaginasLote {
  paginas: string[];
  /** Páginas que precisaram de OCR (1 = primeira). */
  paginasOcr: number[];
  totalPaginas: number;
}

/**
 * O texto de CADA página do arquivo do lote, na ordem (loteFerias.ts monta as
 * pessoas). Página com camada de texto vai direto; página sem texto (o lote
 * escaneado) passa por OCR. Imagem solta: uma página, por OCR.
 */
export async function lerPaginasLote(arquivo: File, progresso?: Progresso): Promise<PaginasLote> {
  const ehPdf = arquivo.type === "application/pdf" || /\.pdf$/i.test(arquivo.name);
  if (!ehPdf) {
    return { paginas: await ocrPorPagina([arquivo], progresso), paginasOcr: [1], totalPaginas: 1 };
  }
  progresso?.("Abrindo o PDF…");
  const doc = await abrirPdf(arquivo);
  try {
    if (doc.numPages > MAX_PAGINAS_LOTE) {
      throw new Error(`O arquivo tem ${doc.numPages} páginas; o limite do lote é ${MAX_PAGINAS_LOTE}. Divida o arquivo.`);
    }
    const paginas: string[] = [];
    const semTexto: number[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      progresso?.(`Lendo o texto da página ${p} de ${doc.numPages}…`);
      const t = await textoDaPagina(doc, p);
      paginas.push(t);
      if (t.replace(/\s/g, "").length < 40) semTexto.push(p);
    }
    if (semTexto.length) {
      progresso?.(`${semTexto.length} página(s) escaneada(s) — convertendo em imagem…`);
      const imagens: HTMLCanvasElement[] = [];
      for (const p of semTexto) imagens.push(await paginaComoImagem(doc, p));
      const textos = await ocrPorPagina(imagens, progresso);
      semTexto.forEach((p, i) => { paginas[p - 1] = textos[i]; });
    }
    return { paginas, paginasOcr: semTexto, totalPaginas: doc.numPages };
  } finally {
    void doc.destroy();
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
