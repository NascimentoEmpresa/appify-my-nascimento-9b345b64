/**
 * Onde está a foto do crachá de um pedido de admissão.
 *
 * `sup_pedido.imagem_cracha_path` guarda DOIS formatos, e a tela precisa
 * distinguir os dois (medido em produção, 11/09/2026):
 *   • pedidos migrados do sistema antigo (501 de 505) têm a URL completa em
 *     `https://api.mustaches.com.br/uploads/crachas/...`, pública;
 *   • pedidos criados aqui (Solicitar Materiais e formulário público de
 *     enxoval) têm só o caminho dentro do bucket PRIVADO `sup-crachas`, que
 *     precisa de signed URL para abrir.
 */
export const BUCKET_CRACHAS = "sup-crachas";

export type OrigemFotoCracha =
  | { tipo: "url"; url: string }
  | { tipo: "bucket"; caminho: string };

export function origemFotoCracha(valor: string | null | undefined): OrigemFotoCracha | null {
  const v = valor?.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return { tipo: "url", url: v };
  return { tipo: "bucket", caminho: v.replace(/^\/+/, "") };
}

/** Nome do arquivo baixado: o protocolo identifica a pessoa no Supply. */
export function nomeArquivoCracha(protocolo: string, caminho: string): string {
  const ext = caminho.split("?")[0].split(".").pop()?.toLowerCase();
  const extensao = ext && /^[a-z0-9]{2,5}$/.test(ext) ? ext : "jpg";
  return `cracha-${protocolo}.${extensao}`;
}
