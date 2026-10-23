/**
 * Custo do enxoval exibido no Catálogo de Materiais.
 *
 * Um material pode estar em mais de um almoxarifado ou ter fichas separadas
 * por tamanho. Para não subavaliar o kit, vale o maior custo unitário já
 * apurado pelo Estoque para o item (a mesma regra usada na tela de estoque).
 * O id do material-base também recebe o custo das suas variações de tamanho.
 */
export type LinhaCustoEstoque = {
  sup_item_id: string;
  custo_unitario: number;
  base: { id: string } | null;
};

export function custosPorItemDoEnxoval(
  itemIds: Iterable<string>,
  estoque: Iterable<LinhaCustoEstoque>,
): Map<string, number> {
  const custos = new Map([...itemIds].map((id) => [id, 0]));

  for (const linha of estoque) {
    const custo = Number(linha.custo_unitario ?? 0);
    for (const id of [linha.sup_item_id, linha.base?.id]) {
      if (id && custos.has(id)) custos.set(id, Math.max(custos.get(id) ?? 0, custo));
    }
  }

  return custos;
}

export function totalDoEnxoval(custos: Iterable<number>): number {
  return [...custos].reduce((total, custo) => total + Number(custo ?? 0), 0);
}
