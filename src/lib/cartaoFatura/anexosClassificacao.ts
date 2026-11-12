// SIS-2026-0879: anexos (NF, prints) e observação no "Classificar item" do Cartão de Crédito.
//
// Um lugar só para o bucket, o caminho no storage e os limites. O banco confere tudo de novo
// (migration 20261112210000): o caminho tem que estar na pasta do item e o arquivo novo tem que
// ter sido enviado por quem salva.

import { fmtTamanho, nomeSeguro, type AnexoRef } from "@/lib/solicitacoes/anexos";

export const BUCKET_CLASSIFICACAO_CARTAO = "cartao-classificacao-anexos";
/** 25 MB por arquivo: o file_size_limit do bucket (NF em PDF, print). */
export const ANEXO_CLASSIFICACAO_MAX_BYTES = 25 * 1024 * 1024;
/** Arquivos por item: a RPC e a CHECK da tabela recusam acima disso. */
export const MAX_ANEXOS_POR_ITEM = 10;
/** Tamanho máximo da observação (CHECK da tabela). */
export const MAX_OBSERVACAO = 2000;

export type AnexoClassificacao = AnexoRef;

/** <item>/<carimbo>-<i>_<nome>: o carimbo + índice evitam colisão no envio de vários de uma vez. */
export const caminhoAnexoClassificacao = (itemId: string, nome: string, indice = 0, agora = Date.now()): string =>
  `${itemId}/${agora}-${indice}_${nomeSeguro(nome)}`;

/**
 * Junta a seleção nova à que está esperando para subir: ignora o mesmo arquivo escolhido duas vezes
 * (nome + tamanho), recusa vazio e o que passa de 25 MB e corta no máximo por item, contando os que
 * já estão salvos. Devolve os arquivos e os avisos para o toast.
 */
export function juntarArquivos(atuais: File[], novos: File[], jaSalvos: number): { arquivos: File[]; avisos: string[] } {
  const arquivos = [...atuais];
  const avisos: string[] = [];
  for (const f of novos) {
    if (arquivos.some((a) => a.name === f.name && a.size === f.size)) continue;
    if (f.size > ANEXO_CLASSIFICACAO_MAX_BYTES) {
      avisos.push(`"${f.name}" tem ${fmtTamanho(f.size)} — o limite é 25 MB por arquivo.`);
      continue;
    }
    if (f.size === 0) {
      avisos.push(`"${f.name}" está vazio.`);
      continue;
    }
    if (jaSalvos + arquivos.length >= MAX_ANEXOS_POR_ITEM) {
      avisos.push(`No máximo ${MAX_ANEXOS_POR_ITEM} arquivos por item — "${f.name}" ficou de fora.`);
      continue;
    }
    arquivos.push(f);
  }
  return { arquivos, avisos };
}

/** Mudou algo no complemento? Sem mudança a tela nem chama a RPC (e segue funcionando antes da migration rodar). */
export function complementoMudou(i: { observacaoSalva: string; observacao: string; removidos: number; novos: number }): boolean {
  return i.observacao.trim() !== i.observacaoSalva.trim() || i.removidos > 0 || i.novos > 0;
}

/** PDF, imagem e texto abrem numa aba; o resto (XML da NF, planilha...) baixa com o nome original. */
export const abreNaAba = (a: Pick<AnexoClassificacao, "tipo" | "nome">): boolean =>
  /^(application\/pdf|image\/|text\/plain)/i.test(String(a.tipo ?? "")) || /\.(pdf|png|jpe?g|gif|webp|bmp|txt)$/i.test(a.nome);
