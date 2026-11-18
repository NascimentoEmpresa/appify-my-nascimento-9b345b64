import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/integrations/supabase/env";

/**
 * Upload RETOMÁVEL (TUS) para o Storage, em pedaços de 6 MB, com progresso
 * e nova tentativa se a conexão oscilar. Para vídeo e arquivo grande: o
 * upload simples manda tudo numa requisição só, fica minutos sem sinal de
 * vida e morre na primeira queda de rede.
 *
 * O ENDEREÇO DOS PEDAÇOS É REESCRITO AQUI (18/11/2026). No cluster próprio o
 * storage-api monta o `Location` da criação com o que enxerga atrás do Kong:
 *   http://api.grpnascimento.com.br:8000/upload/resumable/<id>
 * — http, porta interna do Kong e sem o prefixo /storage/v1. O 1º pedaço ia
 * junto com a criação e passava; o 2º ia para esse endereço e morria sem
 * resposta ("failed to upload chunk at offset 6291456"). Ou seja: todo
 * arquivo acima de 6 MB enviado por TUS falhava desde a virada para o
 * cluster. O id do upload é o mesmo; só a base do endereço está errada, então
 * trocamos a base pela URL pública da API antes de cada requisição.
 */
const pilhaHttp = (() => {
  const padrao = new tus.DefaultHttpStack({});
  return {
    getName: () => "erp-endereco-corrigido",
    createRequest: (metodo: string, url: string) => {
      const i = url.indexOf("/upload/resumable/");
      const certo = i >= 0 ? `${SUPABASE_URL}/storage/v1${url.slice(i)}` : url;
      return padrao.createRequest(metodo, certo);
    },
  } as tus.HttpStack;
})();

export type Progresso = (pct: number, enviado: number, total: number) => void;

/** Tamanho legível em português (ex.: "123,4 MB"). */
export const formatarTamanho = (bytes: number) =>
  bytes >= 1024 * 1024 * 1024
    ? `${(bytes / (1024 * 1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`
    : `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;

/**
 * Traduz o erro do Storage/TUS para algo que a pessoa entende. O texto
 * cru ("Maximum size exceeded", "[object ProgressEvent]") não diz o que
 * fazer.
 */
export function mensagemErroUpload(e: unknown, limiteBytes?: number): string {
  const m = String((e as Error)?.message ?? e ?? "");
  if (/413|too large|Payload|Maximum size|exceeded the maximum/i.test(m)) {
    return limiteBytes
      ? `O servidor recusou o arquivo por tamanho (limite anunciado: ${formatarTamanho(limiteBytes)}). Avise o Sistemas — ou publique o vídeo no YouTube (não listado) e cole o link.`
      : "O servidor recusou o arquivo por tamanho. Avise o Sistemas.";
  }
  if (/401|403|row-level|Unauthorized|JWT/i.test(m)) {
    return "Sem permissão para enviar este arquivo (ou a sessão expirou — entre de novo).";
  }
  if (/ProgressEvent|Failed to fetch|NetworkError|response code: n\/a/i.test(m)) {
    return "A conexão caiu durante o envio e não voltou. Confira a internet e tente de novo.";
  }
  return "Não deu para enviar o arquivo: " + m.slice(0, 200);
}

/**
 * Sobe `file` para `bucket/path`. Até 6 MB vai no upload simples (uma
 * requisição); acima disso, por TUS. Lança Error com a mensagem já em
 * português (ver mensagemErroUpload).
 */
export async function enviarArquivo(
  bucket: string, path: string, file: File,
  opcoes: { contentType?: string; onProgresso?: Progresso; limiteBytes?: number } = {},
): Promise<void> {
  const tipo = opcoes.contentType || file.type || "application/octet-stream";
  if (file.size <= 6 * 1024 * 1024) {
    const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: tipo, upsert: false });
    if (error) throw new Error(mensagemErroUpload(error, opcoes.limiteBytes));
    opcoes.onProgresso?.(100, file.size, file.size);
    return;
  }
  const { data: sessao } = await supabase.auth.getSession();
  const token = sessao.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Entre de novo para enviar o arquivo.");
  await new Promise<void>((resolve, reject) => {
    const up = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      httpStack: pilhaHttp,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: { authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
      metadata: { bucketName: bucket, objectName: path, contentType: tipo, cacheControl: "3600" },
      onError: (e) => reject(new Error(mensagemErroUpload(e, opcoes.limiteBytes))),
      onProgress: (enviado, total) => opcoes.onProgresso?.(Math.round((enviado / total) * 100), enviado, total),
      onSuccess: () => resolve(),
    });
    up.start();
  });
}
