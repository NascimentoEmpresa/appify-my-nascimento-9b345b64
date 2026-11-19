// =====================================================================
// MINUTAS DA INVESTIGAÇÃO — o que a I.A redige para o relator
// (19/11/2026, pedido do Comitê de Ética)
//
// Três minutas, todas a partir do dossiê do caso (o mesmo do parecer I.A)
// MAIS o texto lido dos anexos:
//   · Termo de Abertura do Procedimento Investigativo;
//   · Roteiro de entrevistas (denunciante/testemunhas/denunciado);
//   · Parecer Conclusivo.
// A I.A só devolve texto. Quem salva é o relator, no editor da aba; a
// versão final é um segundo clique dele (CANAL_DENUNCIA_DOCUMENTO).
//
// Lógica pura, sem Deno nem React: a Edge denuncia-parecer-ia (modo
// "minuta") usa daqui o pedido, a escolha de quais anexos ler e a
// conferência da resposta; a tela usa a lista de minutas; e
// src/test/denuncia-minuta-ia.test.ts testa as regras.
//
// SIGILO: anexo marcado sensível NUNCA é lido para a I.A (nem para quem
// tem a capacidade de sigilo) — o mesmo critério do parecer I.A, que só
// cita "existe um anexo sigiloso". A identidade do denunciante também não
// vai: o dossiê já sai sem ela.
// =====================================================================

export type IdMinuta = "termo_abertura" | "roteiro_entrevista" | "parecer_conclusivo";

export interface Minuta {
  id: IdMinuta;
  rotulo: string;
  /** Aba onde o texto pode ser usado. O roteiro não tem aba própria: entra
   *  como anexo do termo de abertura, se o relator quiser. */
  aba: "termo_abertura" | "parecer_conclusivo";
  estrutura: string;
  min: number;
  max: number;
}

export const MINUTAS: Minuta[] = [
  {
    id: "termo_abertura",
    rotulo: "Termo de Abertura",
    aba: "termo_abertura",
    min: 400,
    max: 12000,
    estrutura: `Redija a MINUTA do TERMO DE ABERTURA DO PROCEDIMENTO INVESTIGATIVO, com estas seções (títulos em CAIXA ALTA, uma por linha):
TERMO DE ABERTURA DO PROCEDIMENTO INVESTIGATIVO
1. IDENTIFICAÇÃO DO PROCEDIMENTO (protocolo, data de recebimento, empresa, origem, classificação e gravidade)
2. DOS FATOS RELATADOS (narrativa objetiva do relato, sem juízo de valor, citando quando e onde)
3. DO OBJETO DA APURAÇÃO (o que precisa ser esclarecido, em itens)
4. DAS DILIGÊNCIAS PREVISTAS (entrevistas, documentos a requisitar, análises — em itens)
5. DAS GARANTIAS (sigilo, não retaliação, direito de manifestação do denunciado, imparcialidade)
6. DO PRAZO (o prazo do caso que consta no dossiê)
Local e data: [cidade], [data]
Relator(a): [nome do relator]
Use "[a preencher]" onde faltar dado.`,
  },
  {
    id: "roteiro_entrevista",
    rotulo: "Roteiro de entrevistas",
    aba: "termo_abertura",
    min: 300,
    max: 10000,
    estrutura: `Redija a MINUTA do ROTEIRO DE ENTREVISTAS do procedimento, com:
ROTEIRO DE ENTREVISTAS
- Orientações ao entrevistador (abertura, sigilo, não retaliação, registro em ata)
- ENTREVISTA COM O(A) DENUNCIANTE (se o canal permitir contato) — perguntas numeradas
- ENTREVISTA COM TESTEMUNHAS — perguntas numeradas
- ENTREVISTA COM O(A) DENUNCIADO(A) — perguntas numeradas, garantindo o direito de apresentar a versão dele(a)
- ENCERRAMENTO
Perguntas abertas, neutras, sem induzir resposta e sem revelar quem denunciou.`,
  },
  {
    id: "parecer_conclusivo",
    rotulo: "Parecer Conclusivo",
    aba: "parecer_conclusivo",
    min: 500,
    max: 15000,
    estrutura: `Redija a MINUTA do PARECER CONCLUSIVO do procedimento, com estas seções (títulos em CAIXA ALTA, uma por linha):
PARECER CONCLUSIVO
1. IDENTIFICAÇÃO DO PROCEDIMENTO
2. SÍNTESE DOS FATOS
3. DAS DILIGÊNCIAS REALIZADAS (providências, entrevistas, documentos analisados)
4. DA ANÁLISE DAS EVIDÊNCIAS (o que cada evidência mostra ou não mostra)
5. DA CONCLUSÃO (procedente, parcialmente procedente, improcedente ou inconclusiva — SÓ o que o dossiê sustenta; se a apuração ainda não permite concluir, diga isso)
6. DAS RECOMENDAÇÕES (medidas e ações corretivas/preventivas)
Local e data: [cidade], [data]
Relator(a): [nome do relator]
Use "[a preencher]" onde faltar dado.`,
  },
];

export const minutaPorId = (id: unknown): Minuta | undefined =>
  MINUTAS.find((m) => m.id === id);

export const REGRAS_MINUTA = `Você está redigindo um documento formal de um procedimento investigativo do Comitê de Ética.
- Escreva em português do Brasil, linguagem formal e impessoal, em TEXTO SIMPLES (sem Markdown: sem #, sem **, sem tabelas).
- Use SÓ o que está no dossiê e no conteúdo dos anexos. Não invente fatos, nomes, datas, cargos nem documentos.
- Não presuma culpa: "relato", "indícios", "fato apurado", conforme o que as provas sustentam.
- Não identifique nem tente deduzir quem denunciou.
- Ao citar um anexo, cite pelo número entre colchetes (ex.: [Anexo 2]).
- É uma MINUTA: o relator vai revisar. Não assine em nome de ninguém.`;

// ------------------------------------------------------------ anexos

export type LeituraAnexo = "pdf" | "docx" | "texto" | "imagem" | "nenhuma";

/** Quanto ler, no máximo. Acima disso o arquivo fica só listado. */
export const LIMITES_ANEXO = {
  maxArquivos: 10,
  maxBytesDocumento: 15 * 1024 * 1024,
  maxBytesImagem: 4 * 1024 * 1024,
  maxImagens: 4,
  maxCaracteresPorArquivo: 12000,
  maxCaracteresTotal: 45000,
};

const ext = (nome: string) => (nome.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "");

/** Como ler um anexo, pelo tipo/extensão. Sensível nunca é lido. */
export function leituraDoAnexo(a: { nome_arquivo?: string | null; mime_type?: string | null; sensivel?: boolean | null }): LeituraAnexo {
  if (a.sensivel) return "nenhuma";
  const mime = (a.mime_type ?? "").toLowerCase();
  const e = ext(a.nome_arquivo ?? "");
  if (mime === "application/pdf" || e === "pdf") return "pdf";
  if (mime.includes("wordprocessingml") || e === "docx") return "docx";
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif"].includes(e)) {
    // HEIC/TIFF/BMP: o provedor não aceita; fica só listado.
    return ["heic", "heif", "tif", "tiff", "bmp"].includes(e) || /heic|heif|tiff|bmp/.test(mime) ? "nenhuma" : "imagem";
  }
  if (mime.startsWith("text/") || ["txt", "csv", "md", "eml", "json", "xml", "html", "htm"].includes(e)) return "texto";
  return "nenhuma";
}

/** Texto do document.xml de um .docx → texto corrido (parágrafos viram linhas). */
export function textoDeDocxXml(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Corta o texto de cada anexo respeitando o teto total. Devolve na mesma ordem. */
export function distribuirOrcamento(textos: string[], porArquivo = LIMITES_ANEXO.maxCaracteresPorArquivo, total = LIMITES_ANEXO.maxCaracteresTotal): string[] {
  let resta = total;
  return textos.map((t) => {
    const limpo = (t ?? "").replace(/\s+\n/g, "\n").trim();
    const cabe = Math.max(0, Math.min(porArquivo, resta));
    const saida = limpo.length > cabe ? `${limpo.slice(0, cabe)}… [cortado]` : limpo;
    resta -= Math.min(limpo.length, cabe);
    return cabe > 0 ? saida : "";
  });
}

export interface AnexoLido {
  numero: number;
  nome: string;
  categoria: string;
  leitura: LeituraAnexo;
  texto?: string;
  /** Motivo de não ter lido (sigiloso, grande, formato). */
  aviso?: string;
}

/** Bloco "conteúdo dos anexos" que vai no pedido à I.A. */
export function blocoAnexos(lidos: AnexoLido[]): string {
  if (!lidos.length) return "## Conteúdo dos anexos\n- Nenhum anexo.";
  const linhas = ["## Conteúdo dos anexos (lido do arquivo)"];
  for (const a of lidos) {
    linhas.push(`\n### [Anexo ${a.numero}] ${a.nome} (${a.categoria.replace(/_/g, " ")})`);
    if (a.aviso) linhas.push(`(conteúdo não lido: ${a.aviso})`);
    else if (a.leitura === "imagem") linhas.push("(imagem enviada junto — descreva só o que se vê nela)");
    else linhas.push(a.texto?.trim() ? a.texto : "(arquivo sem texto legível)");
  }
  return linhas.join("\n");
}

// ------------------------------------------------------------ pedido e conferência

export function montarPedidoMinuta(m: Minuta, extra?: string): string {
  const orientacao = (extra ?? "").trim().slice(0, 1500);
  return `${m.estrutura}${orientacao ? `\n\nOrientação do relator para esta minuta: ${orientacao}` : ""}\n\nResponda só com o texto do documento.`;
}

/** Limpa a resposta (cercas de código, Markdown leve) e confere o tamanho. */
export function conferirMinuta(texto: string, m: Minuta): { ok: true; texto: string } | { ok: false; erro: string } {
  const limpo = String(texto ?? "")
    .replace(/^```[a-z]*\s*\n?/i, "").replace(/\n?```\s*$/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
  if (limpo.length < m.min) return { ok: false, erro: `A minuta saiu curta demais (${limpo.length} caracteres). Escreva o documento completo, com todas as seções.` };
  if (limpo.length > m.max) return { ok: true, texto: `${limpo.slice(0, m.max)}\n[minuta cortada no limite]` };
  return { ok: true, texto: limpo };
}
