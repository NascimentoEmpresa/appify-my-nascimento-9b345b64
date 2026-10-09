// =====================================================================
// Versículos — a mesma lista da tela Início e da tela padrão das TVs.
//
// Gira sozinho pelo dia do ano: a mensagem muda de manhã sem ninguém
// publicar nada. Saiu de src/pages/Inicio.tsx em 08/10/2026 para a TV
// (tela padrão, sem playlist) mostrar a mesma palavra do dia.
// =====================================================================

export interface Versiculo { frase: string; texto: string; ref: string }

export const VERSICULOS: Versiculo[] = [
  { frase: "Consagre o seu trabalho.",   texto: "Consagre ao Senhor tudo o que você faz, e os seus planos serão bem-sucedidos.", ref: "Provérbios 16:3" },
  { frase: "Tudo posso naquele que me fortalece.", texto: "Posso todas as coisas naquele que me fortalece.", ref: "Filipenses 4:13" },
  { frase: "Faça de todo o coração.",    texto: "Tudo o que fizerem, façam de todo o coração, como para o Senhor, e não para os homens.", ref: "Colossenses 3:23" },
  { frase: "Seja forte e corajoso.",     texto: "Não se apavore nem desanime, pois o Senhor, o seu Deus, estará com você por onde você andar.", ref: "Josué 1:9" },
  { frase: "Entregue o seu caminho.",    texto: "Entregue o seu caminho ao Senhor; confie nele, e ele agirá.", ref: "Salmos 37:5" },
  { frase: "Planeje com sabedoria.",     texto: "Os planos bem elaborados levam à fartura; mas o apressado sempre acaba na pobreza.", ref: "Provérbios 21:5" },
  { frase: "Trabalho feito com esmero.", texto: "Você já observou o homem habilidoso em seu trabalho? Será promovido ao serviço real.", ref: "Provérbios 22:29" },
];

/** Índice do versículo do dia (dia do ano). */
export function indiceDoDia(hoje: Date): number {
  const inicio = new Date(hoje.getFullYear(), 0, 0);
  const dia = Math.floor((hoje.getTime() - inicio.getTime()) / 86_400_000);
  return ((dia % VERSICULOS.length) + VERSICULOS.length) % VERSICULOS.length;
}

export const versiculoDoDia = (hoje: Date): Versiculo => VERSICULOS[indiceDoDia(hoje)];
