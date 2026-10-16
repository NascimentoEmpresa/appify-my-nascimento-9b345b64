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

interface ItemTexto {
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
      .map((it: any) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width ?? 0 }));
    linhas.push(...montarLinhas(itens));
  }
  if (!linhas.some((l) => l.trim())) {
    throw new Error("PDF sem texto (provavelmente escaneado) — não dá para ler. Mande um PDF gerado pelo sistema de origem.");
  }
  return linhas;
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
