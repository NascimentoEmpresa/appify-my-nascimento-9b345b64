// =====================================================================
// RH › Rateio de Despesas — ler o PDF da despesa NO NAVEGADOR.
//
// Mesmo pdf.js do cdnjs de Controladoria › Reuniões (src/lib/controladoria/
// leitorArquivos.ts), mas remontando as LINHAS pela posição na página: as
// guias de FGTS, faturas de seguro/Bullla/BSF e relações da SEEAC são
// tabelas, e o texto corrido do pdf.js mistura colunas de linhas vizinhas.
// Só a biblioteca vem da internet; o arquivo não sai do navegador para ser
// lido (ele sobe para o bucket rh-rateio só ao salvar, como anexo).
// =====================================================================

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379";

export interface ItemTexto {
  str: string;
  x: number;
  y: number;
  w: number;
}

/** Devolve o texto do PDF, uma string por linha visual (todas as páginas). */
export async function lerLinhasPdf(file: File): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import(/* @vite-ignore */ `${PDFJS}/pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const linhas: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const c = await (await pdf.getPage(p)).getTextContent();
    const itens: ItemTexto[] = c.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((it: any) => typeof it.str === "string" && it.str.trim() !== "")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((it: any) => paraEixoDoTexto(it.str, it.transform, it.width ?? 0));
    linhas.push(...montarLinhas(itens));
  }
  if (!linhas.some((l) => l.trim())) throw new PdfSemTextoError();
  return linhas;
}

/**
 * OCR do PDF sem camada de texto, página a página, no navegador (o arquivo não
 * sai daqui). Criado para o BSF com listagem de trabalhadores (09/11/2026),
 * cujas letras são desenhos vetoriais. Página em ~2.400 px, como em Férias
 * (lerReciboFerias.ts). PSM 6 = "bloco único": no modo automático o tesseract
 * separa as colunas e a linha da pessoa se perde. Três workers em paralelo: um
 * só levava ~2 min em 9 páginas. Devolve as linhas na ordem das páginas.
 */
export async function lerLinhasPdfOcr(file: File, progresso?: (msg: string) => void): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import(/* @vite-ignore */ `${PDFJS}/pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const { createWorker, PSM } = await import("tesseract.js");
  const paginas: string[][] = Array.from({ length: pdf.numPages }, () => []);
  let proxima = 1;
  let prontas = 0;
  progresso?.("PDF sem texto — preparando o OCR (a primeira vez demora um pouco)…");
  const trabalhar = async () => {
    const worker = await createWorker("por");
    try {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" });
      while (proxima <= pdf.numPages) {
        const p = proxima++;
        const pg = await pdf.getPage(p);
        const viewport = pg.getViewport({ scale: 2400 / pg.getViewport({ scale: 1 }).width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("O navegador não deixou desenhar a página do PDF.");
        // intent "print": sem requestAnimationFrame, não para com a aba em segundo plano.
        await pg.render({ canvasContext: ctx, viewport, intent: "print" }).promise;
        const { data } = await worker.recognize(canvas);
        paginas[p - 1] = data.text.split("\n");
        progresso?.(`Lendo o PDF por OCR: ${++prontas} de ${pdf.numPages} página(s)…`);
      }
    } finally {
      await worker.terminate();
    }
  };
  try {
    await Promise.all([trabalhar(), trabalhar(), trabalhar()]);
  } finally {
    void pdf.destroy();
  }
  return paginas.flat();
}

/**
 * PDF escaneado (só imagem): pdf.js não acha texto nenhum. O BSF da SAMU de
 * 12/2025 veio assim. Erro com tipo próprio para a tela ainda tentar o
 * contrato pelo NOME DO ARQUIVO (contratoPeloNomeArquivo) em vez de parar.
 */
export class PdfSemTextoError extends Error {
  constructor() {
    super("PDF sem texto (escaneado, só imagem) — não dá para ler os valores. Digite o valor da despesa; o contrato pode vir do nome do arquivo.");
    this.name = "PdfSemTextoError";
  }
}

/**
 * Põe o item no eixo do TEXTO, não no da página: x = posição ao longo da
 * linha, y = qual linha (maior = mais acima). Numa página normal é o próprio
 * (x, y). O relatório do seguro (Prudential, "RELATÓRIO DE MOVIMENTAÇÃO",
 * out/2026) é paisagem desenhada numa página retrato girada 90°: a matriz
 * vem [0, s, -s, 0, e, f] — o texto corre no y da página e cada linha da
 * tabela é um x diferente. Sem isso, todos os CPFs de uma página saíam
 * colados numa linha só e nada era lido.
 */
export function paraEixoDoTexto(str: string, t: number[], w: number): ItemTexto {
  const n = Math.hypot(t[0], t[1]) || 1;
  const ux = t[0] / n;
  const uy = t[1] / n;
  return { str, x: t[4] * ux + t[5] * uy, y: -t[4] * uy + t[5] * ux, w };
}

/** Agrupa itens com o mesmo y (tolerância de 2,5 pt), da esquerda para a direita. */
export function montarLinhas(itens: ItemTexto[]): string[] {
  const ordenados = [...itens].sort((a, b) => b.y - a.y || a.x - b.x);
  const grupos: ItemTexto[][] = [];
  for (const it of ordenados) {
    const g = grupos[grupos.length - 1];
    if (g && Math.abs(g[0].y - it.y) <= 2.5) g.push(it);
    else grupos.push([it]);
  }
  return grupos.map((g) => {
    g.sort((a, b) => a.x - b.x);
    let s = "";
    let fim = -Infinity;
    for (const it of g) {
      // Espaço largo entre colunas vira dois espaços (facilita ler na conferência).
      if (s) s += it.x - fim > 8 ? "  " : it.x - fim > 1 ? " " : "";
      s += it.str;
      fim = it.x + it.w;
    }
    return s.trim();
  });
}

// ── TXT (Bullla — Demonstrativo Analítico, 10/11/2026) ─────────────────────
// Os TXT da Bullla vêm em Windows-1252 (acentos viram lixo em UTF-8): tenta
// UTF-8 estrito e, se não for, lê como Windows-1252.
export const ehArquivoTxt = (f: File) => /\.txt$/i.test(f.name) || f.type === "text/plain";

export async function lerLinhasTxt(file: File): Promise<string[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let texto: string;
  try { texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { texto = new TextDecoder("windows-1252").decode(bytes); }
  return texto.replace(/\r\n?/g, "\n").split("\n");
}

/** Vários TXT de uma vez (um por empresa) → um arquivo só, para ler e anexar junto. */
export async function juntarTxts(files: File[]): Promise<File> {
  if (files.length === 1) return files[0];
  const partes = await Promise.all(files.map((f) => f.arrayBuffer()));
  const quebra = new Uint8Array([13, 10]);
  const blobs: BlobPart[] = [];
  partes.forEach((p, i) => { if (i) blobs.push(quebra); blobs.push(p); });
  const nome = `${files.map((f) => f.name.replace(/\.txt$/i, "")).join("+")}.txt`;
  return new File(blobs, nome, { type: "text/plain" });
}
