// SIS-2026-0870: anexos no chat de justificativa dos contratos não faturados (Controle de Faturamento).
//
// Um lugar só para o bucket, o caminho do arquivo no storage, os limites e o texto que a tabela mostra quando a
// última mensagem só tem anexo. O banco confere tudo de novo (migration 20261112180000): o caminho precisa estar
// na pasta do contrato + competência e o arquivo precisa ter sido enviado por quem manda a mensagem.

import { fmtTamanho, nomeSeguro, type AnexoRef } from "@/lib/solicitacoes/anexos";

export const BUCKET_JUSTIFICATIVA = "faturamento-justificativa-anexos";
/** 25 MB por arquivo — o file_size_limit do bucket (documento: comprovante, autorização de faturamento). */
export const ANEXO_JUSTIFICATIVA_MAX_BYTES = 25 * 1024 * 1024;
/** Arquivos por mensagem — a RPC recusa acima disso. */
export const MAX_ANEXOS_POR_MENSAGEM = 10;

export type AnexoJustificativa = AnexoRef;

/** Pasta do chat: <contrato>/<competência YYYY-MM-01>/ — a RPC só aceita arquivo dentro dela. */
export const pastaDoChat = (contratoId: string, competencia: string): string => `${contratoId}/${competencia.slice(0, 10)}/`;

/** <contrato>/<competência>/<carimbo>-<i>_<nome>: o carimbo + índice evitam colisão no envio de vários de uma vez. */
export const caminhoAnexoJustificativa = (contratoId: string, competencia: string, nome: string, indice = 0, agora = Date.now()): string =>
  `${pastaDoChat(contratoId, competencia)}${agora}-${indice}_${nomeSeguro(nome)}`;

/**
 * Junta a seleção nova à que já está no campo: ignora o mesmo arquivo escolhido duas vezes (nome + tamanho),
 * recusa o que passa de 25 MB e corta no máximo por mensagem. Devolve os arquivos e os avisos para o toast.
 */
export function juntarSelecao(atuais: File[], novos: File[]): { arquivos: File[]; avisos: string[] } {
  const arquivos = [...atuais];
  const avisos: string[] = [];
  for (const f of novos) {
    if (arquivos.some((a) => a.name === f.name && a.size === f.size)) continue;
    if (f.size > ANEXO_JUSTIFICATIVA_MAX_BYTES) {
      avisos.push(`"${f.name}" tem ${fmtTamanho(f.size)} — o limite é 25 MB por arquivo.`);
      continue;
    }
    if (f.size === 0) {
      avisos.push(`"${f.name}" está vazio.`);
      continue;
    }
    if (arquivos.length >= MAX_ANEXOS_POR_MENSAGEM) {
      avisos.push(`No máximo ${MAX_ANEXOS_POR_MENSAGEM} arquivos por mensagem — "${f.name}" ficou de fora.`);
      continue;
    }
    arquivos.push(f);
  }
  return { arquivos, avisos };
}

/** Pode enviar: texto com 2+ caracteres, ou ao menos um anexo (aí o texto é opcional). */
export const podeEnviarMensagem = (texto: string, qtdAnexos: number): boolean => texto.trim().length >= 2 || qtdAnexos > 0;

/** O que a coluna da tabela mostra da última mensagem: o texto, ou "📎 2 anexos" quando ela só tem arquivo. */
export function textoDaMensagem(m: { texto: string; anexos?: AnexoJustificativa[] | null }): string {
  const qtd = m.anexos?.length ?? 0;
  if (m.texto.trim()) return qtd > 0 ? `📎 ${m.texto}` : m.texto;
  if (qtd === 0) return "";
  return qtd === 1 ? `📎 ${m.anexos![0].nome}` : `📎 ${qtd} anexos`;
}

/** PDF, imagem e texto abrem numa aba; o resto (Word, planilha, zip...) baixa com o nome original. */
export const abreNaAba = (a: Pick<AnexoJustificativa, "tipo" | "nome">): boolean =>
  /^(application\/pdf|image\/|text\/plain)/i.test(String(a.tipo ?? "")) || /\.(pdf|png|jpe?g|gif|webp|bmp|txt)$/i.test(a.nome);
