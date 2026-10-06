import JSZip from "jszip";

// =====================================================================
// Controladoria › Reuniões com Encarregados — ler o arquivo NO NAVEGADOR
// (mig 20261006000005). Nada é enviado antes da pessoa conferir e salvar.
//   · TXT/MD/VTT/SRT: texto puro (UTF-8; cai para Windows-1252 se vier
//     com caractere inválido — transcrição exportada no Windows);
//   · DOCX: word/document.xml pelo JSZip (já é dependência do ERP);
//   · PDF: só com texto (escaneado não tem). O pdf.js vem do cdnjs na
//     hora — só o código da biblioteca é baixado, o arquivo não sobe.
// =====================================================================

export const EXTENSOES_ACEITAS = [".txt", ".md", ".docx", ".vtt", ".srt", ".pdf"];
export const LIMITE_ARQUIVO = 30 * 1024 * 1024; // 30 MB
export const LIMITE_LOTE = 40;

const extensao = (nome: string) => nome.slice(nome.lastIndexOf(".")).toLowerCase();

async function lerTexto(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf8;
}

async function lerDocx(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("DOCX sem conteúdo de texto.");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  return Array.from(doc.getElementsByTagNameNS(W, "p"))
    .map((p) => Array.from(p.getElementsByTagNameNS(W, "t")).map((t) => t.textContent ?? "").join(""))
    .join("\n");
}

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379";

async function lerPdf(file: File): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import(/* @vite-ignore */ `${PDFJS}/pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const paginas: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    paginas.push(c.items.map((it: any) => (it.str ?? "") + (it.hasEOL ? "\n" : " ")).join(""));
  }
  const texto = paginas.join("\n").trim();
  if (!texto) throw new Error("PDF sem texto (provavelmente escaneado) — não dá para ler.");
  return texto;
}

/** Lê um arquivo de transcrição; erro com mensagem pronta para a tela. */
export async function lerArquivo(file: File, permitirPdf: boolean): Promise<string> {
  if (file.size > LIMITE_ARQUIVO) throw new Error("Arquivo maior que 30 MB.");
  const ext = extensao(file.name);
  if (!EXTENSOES_ACEITAS.includes(ext)) throw new Error(`Formato ${ext} não suportado.`);
  if (ext === ".docx") return lerDocx(file);
  if (ext === ".pdf") {
    if (!permitirPdf) throw new Error("Leitor de PDF desligado — marque a opção para ler PDF.");
    return lerPdf(file);
  }
  return lerTexto(file);
}
