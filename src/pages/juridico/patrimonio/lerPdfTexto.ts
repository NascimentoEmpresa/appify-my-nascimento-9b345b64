// Texto de um PDF, uma linha por posição vertical (SIS-2026-0939).
// Mesmo método do recibo de férias (src/lib/rh/lerReciboFerias.ts): itens a
// até 3 pt de altura um do outro são a mesma linha, ordenados pelo x. O
// demonstrativo da CAIXA tem 15 páginas, então aqui lê TODAS (o de férias para
// em 6). pdf.js é importado sob demanda — não pesa no carregamento do ERP.
// A interpretação mora em demonstrativoCaixa.ts (pura e testada).

const MAX_PAGINAS = 80;

export async function lerTextoDoPdf(arquivo: File): Promise<{ texto: string; paginas: number }> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
  const paginas: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGINAS); p++) {
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
    paginas.push(linhas.map(l => l.itens.sort((a, b) => a.x - b.x).map(o => o.s).join(" ")).join("\n"));
  }
  return { texto: paginas.join("\n"), paginas: doc.numPages };
}
