import { closestCenter, pointerWithin, type CollisionDetection } from "@dnd-kit/core";
import type { EstruturaMenu } from "./estrutura";

/** O cabeçalho e o espaço livre do módulo recebem na primeira categoria. */
export function destinoDoArrasto(estrutura: EstruturaMenu, alvoId: string) {
  for (const modulo of estrutura.modulos) {
    if (alvoId === `mod:${modulo.id}`) {
      const categoria = modulo.categorias[0];
      return categoria ? { modulo, categoria, indice: categoria.itens.length } : null;
    }
    for (const categoria of modulo.categorias) {
      if (alvoId === `cat:${categoria.id}`) return { modulo, categoria, indice: categoria.itens.length };
      const indice = categoria.itens.findIndex((item) => alvoId === `item:${item.id}`);
      if (indice !== -1) return { modulo, categoria, indice };
    }
  }
  return null;
}

export function criarColisaoMenu(estrutura: EstruturaMenu): CollisionDetection {
  const modulosComCategoria = new Set(estrutura.modulos.filter((modulo) => modulo.categorias.length).map((modulo) => `mod:${modulo.id}`));
  return (args) => {
    const ehModulo = String(args.active.id).startsWith("mod:");
    const alvos = args.droppableContainers.filter((alvo) => {
      const id = String(alvo.id);
      if (ehModulo) return id.startsWith("mod:");
      return id.startsWith("item:") || id.startsWith("cat:") || modulosComCategoria.has(id);
    });
    const parametros = { ...args, droppableContainers: alvos };

    // Sem cursor, o teclado usa a posição do item. Com cursor, só vale o
    // cartão sob o mouse: soltar fora não pode escolher um vizinho distante.
    if (!args.pointerCoordinates) return closestCenter(parametros);
    const sob = pointerWithin(parametros);
    if (ehModulo) return sob;

    // As áreas são aninhadas: a linha prevalece sobre a categoria, e a
    // categoria sobre o cartão inteiro (inclusive quando está vazia).
    for (const prefixo of ["item:", "cat:", "mod:"]) {
      const especificos = sob.filter((alvo) => String(alvo.id).startsWith(prefixo));
      if (especificos.length) return especificos;
    }
    return [];
  };
}
