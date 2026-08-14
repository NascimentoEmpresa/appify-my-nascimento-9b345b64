import type { Anexo } from "./types";

// =====================================================================
// Funções puras da exportação do chamado (nomes de arquivo e formatação).
//
// Ficam fora de ExportarChamado.tsx por dois motivos: exportar função de um
// arquivo de componente quebra o fast refresh, e assim elas ficam testáveis
// sem arrastar React, Supabase e jsPDF para o teste.
// =====================================================================

/** Pasta do anexo dentro do zip, pela origem registrada em `campo`. */
export const pastaDe = (campo: string) =>
  campo === "abertura" ? "1-abertura"
  : campo === "chat" ? "2-conversa"
  : campo === "interno" ? "3-interno"
  : "2-conversa";           // 'resposta' (legado) e desconhecidos

/** Nome de arquivo seguro para dentro do zip, preservando a extensão. */
export function nomeSeguro(nome: string, indice: number): string {
  const limpo = (nome || `anexo-${indice}`)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // tira acento
    .replace(/[^\w.\- ]+/g, "_")
    .trim();
  return limpo || `anexo-${indice}`;
}

/**
 * Caminho definitivo do anexo dentro do zip, já resolvendo colisão.
 *
 * É a função que, errada, faz o pacote sair com menos arquivos do que o
 * chamado tem — e sem nenhum erro, porque `zip.file()` simplesmente
 * sobrescreve a entrada de mesmo nome.
 *
 * `usados` é mutado de propósito: quem chama percorre a lista uma vez só.
 */
export function nomeNoZip(
  ax: Pick<Anexo, "nome_arquivo" | "campo">, indice: number, usados: Set<string>,
): string {
  const base = `${pastaDe(ax.campo)}/${nomeSeguro(ax.nome_arquivo, indice + 1)}`;
  let nome = base;
  if (usados.has(nome)) {
    const ponto = base.lastIndexOf(".");
    // Compara com a barra: ponto que aparece só no nome da PASTA não é
    // extensão, e o sufixo iria parar no meio do caminho.
    nome = ponto > base.lastIndexOf("/")
      ? `${base.slice(0, ponto)} (${indice + 1})${base.slice(ponto)}`
      : `${base} (${indice + 1})`;
  }
  usados.add(nome);
  return nome;
}

export const bytesLegivel = (n?: number | null) => {
  if (!n || n <= 0) return "—";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
};
