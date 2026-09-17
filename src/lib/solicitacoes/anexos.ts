// Anexos de solicitações e da conversa (17/09/2026, mig 20260930000175).
//
// Um lugar só para: o bucket, o nome do arquivo no storage, o que conta como
// imagem (mostra inline no chat) e o tamanho legível. Usado pelo formulário
// de advertência, pelo card dos dois lados e pela ConversaSolicitacao.

export const BUCKET_ANEXOS = "solicitacoes-anexos";
/** 25 MB — o limite do bucket (file_size_limit). */
export const ANEXO_MAX_BYTES = 25 * 1024 * 1024;

export interface AnexoRef {
  nome: string;
  path: string;
  tipo?: string | null;
  tamanho?: number | null;
}

export interface AnexoSolicitacao extends AnexoRef {
  id: number;
  modulo: string;
  entidade_id: string;
  autor_nome?: string | null;
  autor_email?: string | null;
  autor_id?: string | null;
  created_at?: string;
}

/** Só letras, números, ponto e hífen — o storage não gosta de acento nem espaço. */
export const nomeSeguro = (nome: string): string =>
  nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(-120) || "arquivo";

/**
 * Caminho no bucket: <modulo>/<id>/<carimbo>_<nome>. O carimbo evita colisão
 * entre dois uploads do mesmo nome e torna o caminho impossível de chutar.
 */
export const caminhoAnexo = (modulo: string, entidadeId: number | string, nome: string, agora = Date.now()): string =>
  `${modulo}/${entidadeId}/${agora}_${nomeSeguro(nome)}`;

export const ehImagem = (tipo?: string | null, nome?: string | null): boolean =>
  /^image\//i.test(String(tipo ?? "")) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(String(nome ?? ""));

export const fmtTamanho = (n?: number | null): string => {
  if (n == null || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/** Imagem colada (Ctrl+V) chega sem nome: "image.png". Dá um nome com hora. */
export const nomeDeColagem = (file: File, agora = new Date()): string => {
  if (file.name && file.name !== "image.png" && file.name !== "image.jpeg") return file.name;
  const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
  const p = (n: number) => String(n).padStart(2, "0");
  return `colado-${agora.getFullYear()}${p(agora.getMonth() + 1)}${p(agora.getDate())}-${p(agora.getHours())}${p(agora.getMinutes())}${p(agora.getSeconds())}.${ext}`;
};

/** Arquivos de um evento de colar: só o que veio como arquivo (imagem da área de transferência). */
export const arquivosDaColagem = (items: DataTransferItemList | null | undefined): File[] => {
  const out: File[] = [];
  if (!items) return out;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === "file") { const f = it.getAsFile(); if (f) out.push(f); }
  }
  return out;
};

/** Recusa antes de subir: o bucket recusaria depois, com uma mensagem pior. */
export const erroDoAnexo = (file: File): string | null =>
  file.size > ANEXO_MAX_BYTES ? `"${file.name}" tem ${fmtTamanho(file.size)} — o limite é 25 MB.` : null;
