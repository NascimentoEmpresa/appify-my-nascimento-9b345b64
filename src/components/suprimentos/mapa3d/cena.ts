/**
 * Paleta e medidas do galpão, tiradas dos dois vídeos gravados em 21/09/2026
 * (SIS-2026-0442). Não são cores "de design": são o que aparece no vídeo, e é
 * por isso que elas moram todas aqui em vez de espalhadas pelos componentes —
 * quando o estoque for pintado de outra cor, muda-se um arquivo.
 *
 * O que o vídeo mostra:
 *   - estantes de madeira pintada de branco levemente amarelado, foscas,
 *     com montante vertical entre cada vão e uma travessa horizontal na
 *     frente de cada nível, onde ficam as plaquinhas de identificação;
 *   - piso de porcelanato claro, bem polido — reflete as estantes;
 *   - forro branco com lâmpadas tubulares corridas no meio do corredor;
 *   - conteúdo: roupa dobrada (azul, cinza, branco), caixas de papelão,
 *     material colorido avulso.
 */

export const CORES = {
  /** Madeira pintada da estante — branco quente, não branco de tela. */
  estante: "#efe9dd",
  estanteEscura: "#ded6c6",
  /** A travessa da frente pega mais luz que o fundo do vão. */
  travessa: "#f5f0e6",
  /** Fundo do caixote: mesma tinta, mas na sombra. */
  fundoCaixote: "#cfc7b6",
  /** Plaquinha branca de identificação presa na travessa. */
  plaquinha: "#fbfaf7",

  piso: "#c4bdaf",
  parede: "#f4f2ee",
  forro: "#eceae5",
  luminaria: "#ffffff",

  /** Destaque do item procurado — o caixote que a busca acende. */
  destaque: "#f59e0b",
  destaqueForte: "#fbbf24",
  /** Caixote com material abaixo do estoque mínimo. */
  falta: "#ef4444",
  /** Caixote ocupado, em repouso. */
  ocupado: "#64748b",
  /** Seleção do editor. */
  edicao: "#22d3ee",
} as const;

/** Medidas do mobiliário que não vêm do banco. */
export const MEDIDAS = {
  /** Espessura das tábuas da estante. */
  tabua: 0.035,
  /** Altura da travessa da frente, onde as plaquinhas são presas. */
  travessa: 0.11,
  /** Plaquinha de identificação. */
  plaquinhaLargura: 0.135,
  plaquinhaAltura: 0.055,
  /** Bancada de trabalho (a do segundo vídeo, com os monitores). */
  mesaLargura: 3.2,
  mesaProfundidade: 0.75,
  mesaAltura: 0.74,
  /** Altura do olho de quem está sentado na bancada — início do voo. */
  olhoSentado: 1.18,
} as const;

/**
 * Cor estável por material: o mesmo item sempre sai da mesma cor, em toda
 * sessão e em todo computador. Serve para o caixote ter cara de "tem coisa
 * diferente dentro" sem inventar dado nenhum.
 */
export function corDoMaterial(chave: string): string {
  let h = 0;
  for (let i = 0; i < chave.length; i++) h = (h * 31 + chave.charCodeAt(i)) | 0;
  // Tons têxteis: azul, cinza, bege, verde-acinzentado — o que o vídeo mostra.
  const paleta = [
    "#54607a", "#6b7689", "#8b93a3", "#9aa3ae",
    "#3f4d63", "#7d7466", "#a39684", "#5d6b62",
    "#47566e", "#cbc3b4", "#8a7f6d", "#6e7f86",
  ];
  return paleta[Math.abs(h) % paleta.length];
}

/** Quantas "pilhas" desenhar dentro do caixote, pelo que há de físico nele. */
export function pilhasDoCaixote(fisico: number): number {
  if (fisico <= 0) return 0;
  if (fisico <= 3) return 1;
  if (fisico <= 12) return 2;
  return 3;
}
