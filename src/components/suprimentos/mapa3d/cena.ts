/**
 * Paleta e medidas do galpão, tiradas dos vídeos e fotos gravados em
 * 21/09/2026 (SIS-2026-0442). Não são cores "de design": são o que aparece no
 * material, e é por isso que moram todas aqui em vez de espalhadas pelos
 * componentes — quando o estoque for pintado de outra cor, muda-se um arquivo.
 *
 * O QUE AS FOTOS DA SEGUNDA RODADA CORRIGIRAM
 *   - Os corredores são ESTREITOS (~1,10 m): na foto a escada de abrir quase
 *     encosta nos dois lados. A primeira versão tinha corredor de 2 m e por
 *     isso parecia um showroom, não um almoxarifado.
 *   - A travessa da frente é GROSSA — come cerca de um terço da altura da
 *     linha. É ela que faz o vão parecer mais largo que alto.
 *   - As pilhas não têm todas a mesma altura: há prateleira de 4 linhas
 *     encostada em outra de 7.
 *   - O piso é porcelanato grande e polido, com veio claro bem visível e
 *     junta aparente — não é um cinza liso.
 *   - O forro é de régua branca, com viga de concreto atravessando.
 */

export const CORES = {
  /** Madeira pintada da prateleira — branco quente, não branco de tela. */
  estante: "#efe9dd",
  estanteEscura: "#ddd5c4",
  /** A travessa da frente pega mais luz que o fundo do vão. */
  travessa: "#f6f1e7",
  /**
   * Fundo da prateleira. Nas fotos ele é BRANCO, igual ao resto — quem
   * escurece o vão é a sombra, não a tinta. Deixar este tom escuro fazia a
   * traseira de uma fileira virar um paredão marrom no meio do salão.
   */
  fundoCaixote: "#e7e1d4",
  /** Plaquinha branca de identificação presa na travessa. */
  plaquinha: "#fbfaf7",

  piso: "#c9c2b4",
  pisoJunta: "#b3aa9a",
  parede: "#f4f2ee",
  forro: "#eceae5",
  viga: "#e4e1da",
  luminaria: "#ffffff",

  /** Coluna de concreto do meio do salão. */
  pilar: "#e8e5de",
  /** Porta de chapa metálica cinza. */
  porta: "#9aa2a8",

  /** Destaque do item procurado — o caixote que a busca acende. */
  destaque: "#f59e0b",
  destaqueForte: "#fbbf24",
  /** Caixote com material abaixo do estoque mínimo. */
  falta: "#ef4444",
  /** Caixote ocupado, em repouso. */
  ocupado: "#64748b",
  /** Seleção do editor. */
  edicao: "#22d3ee",
  /** Pré-visualização da peça que vai ser criada (o "fantasma" do Minecraft). */
  fantasma: "#34d399",
} as const;

/** Medidas do que não vem do banco. */
export const MEDIDAS = {
  /** Espessura das tábuas da prateleira. */
  tabua: 0.035,
  /** Plaquinha de identificação, medida na proporção do vão. */
  plaquinhaLargura: 0.135,
  plaquinhaAltura: 0.05,
  /** Bancada de trabalho (a das fotos, com os monitores). */
  mesaProfundidade: 0.75,
  mesaAltura: 0.74,
  /** Altura do olho de quem está sentado na bancada — início do voo. */
  olhoSentado: 1.18,
  /** Altura do olho de quem está em pé, andando no corredor. */
  olhoEmPe: 1.62,
} as const;

/**
 * Cor estável por material: o mesmo item sempre sai da mesma cor, em toda
 * sessão e em todo computador. Serve para o caixote ter cara de "tem coisa
 * diferente dentro" sem inventar dado nenhum.
 */
export function corDoMaterial(chave: string): string {
  let h = 0;
  for (let i = 0; i < chave.length; i++) h = (h * 31 + chave.charCodeAt(i)) | 0;
  // Tons do que aparece nas fotos: uniforme azul e cinza, saco plástico
  // esverdeado, papelão, embalagem branca.
  const paleta = [
    "#54607a", "#6b7689", "#8b93a3", "#9aa3ae",
    "#3f4d63", "#7d7466", "#a39684", "#5d6b62",
    "#47566e", "#cbc3b4", "#8a7f6d", "#6e7f86",
    "#9fae9a", "#b9a98c",
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
