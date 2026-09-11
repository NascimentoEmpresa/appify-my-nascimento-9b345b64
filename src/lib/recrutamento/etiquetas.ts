// Etiquetas da solicitação de vaga — o "post-it" de quem trabalha a fila.
//
// Pedido de 11/09/2026: na Gestão Recrutamento (e na mesma tela do analista)
// um botão para marcar cada solicitação com "confere", "visto", "ok",
// "revisar"... e poder filtrar por elas. É anotação de trabalho,
// não etapa do fluxo: o STATUS continua dizendo onde a vaga está; a etiqueta
// diz o que a pessoa que está olhando a fila quer lembrar dela.
//
// A lista vive aqui E na CHECK da coluna (migrations 20260930000090 e 091 —
// a 091 tirou "Digitar", no mesmo dia, a pedido). Para entrar ou sair uma
// etiqueta, mexe nos dois — a tela não deixa marcar o que
// não está aqui, e o banco não deixa gravar o que não está lá.
export interface EtiquetaRecrutamento {
  valor: string;
  /** Cor do chip: fundo, borda e texto. */
  cor: { bg: string; borda: string; texto: string };
}

export const ETIQUETAS_RECRUTAMENTO: EtiquetaRecrutamento[] = [
  { valor: "Confere",            cor: { bg: "#eef4ff", borda: "#c7d7f5", texto: "#0f3171" } },
  { valor: "Visto",              cor: { bg: "#f1f5f9", borda: "#cbd5e1", texto: "#475569" } },
  { valor: "OK",                 cor: { bg: "#dcfce7", borda: "#86efac", texto: "#166534" } },
  { valor: "Revisar",            cor: { bg: "#fef3c7", borda: "#fcd34d", texto: "#92400e" } },
  { valor: "Aguardando retorno", cor: { bg: "#ffedd5", borda: "#fdba74", texto: "#9a3412" } },
  { valor: "Pendência",          cor: { bg: "#fee2e2", borda: "#fca5a5", texto: "#991b1b" } },
];

export const VALORES_ETIQUETAS = ETIQUETAS_RECRUTAMENTO.map(e => e.valor);

const COR_DESCONHECIDA = { bg: "#f8fafc", borda: "#e2e8f0", texto: "#64748b" };

/** Cor de uma etiqueta. Valor fora do catálogo (banco mais novo que o build) sai cinza, não quebra. */
export const corDaEtiqueta = (valor: string) =>
  ETIQUETAS_RECRUTAMENTO.find(e => e.valor === valor)?.cor ?? COR_DESCONHECIDA;

/**
 * Liga/desliga uma etiqueta na lista, devolvendo a lista na ORDEM DO
 * CATÁLOGO — assim "OK · Revisar" e "Revisar · OK" são a mesma coisa na tela
 * e no filtro, independente da ordem em que foram clicadas.
 */
export function alternarEtiqueta(atuais: string[] | null | undefined, valor: string): string[] {
  const set = new Set(atuais ?? []);
  if (set.has(valor)) set.delete(valor); else set.add(valor);
  return VALORES_ETIQUETAS.filter(v => set.has(v));
}

/** Só o que está no catálogo, na ordem dele — para exibir o que veio do banco. */
export const etiquetasValidas = (lista: string[] | null | undefined): string[] =>
  VALORES_ETIQUETAS.filter(v => (lista ?? []).includes(v));
