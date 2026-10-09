// SIS-2026-0633 (Veranópolis): desconto de faltas calculado por DIAS, como na
// planilha modelo ("Tabela calculo faltas": valor do posto ÷ 30 × dias de falta).
// É uma seção da NOTA (não de cada item): uma linha por local/posto, e cada linha
// aponta para o item (escola) que recebe o desconto. O R$ das faltas de cada item é
// a soma das linhas ligadas a ele — `faltas` do item continua sendo o valor que entra
// nos cálculos, então bruto/retenções/INSS não mudam.
// Só vale para contrato com `nf_faltas_por_dias` ligado; nos demais as faltas seguem
// digitadas em R$ no item.

export interface LinhaFaltaDias {
  // índice do item da nota que recebe o desconto (null = ainda não escolhido)
  item: number | null;
  // posto escolhido na Planilha de Custo (informativo) e o valor usado no cálculo
  posto: string | null;
  valor_posto: number | null;
  // dias de falta (pessoa-dia)
  dias: number;
}

const arred2 = (n: number) => Math.round(n * 100) / 100;

export function linhaFaltaVazia(item: number | null = null): LinhaFaltaDias {
  return { item, posto: null, valor_posto: null, dias: 0 };
}

// Valor da falta = valor do posto ÷ 30 × dias (pessoa-dia), com 2 casas.
export function valorFaltasPorDias(valorPosto: number | null | undefined, dias: number): number {
  if (!((valorPosto ?? 0) > 0) || !(dias > 0)) return 0;
  return arred2(((valorPosto as number) / 30) * dias);
}

export function valorDaLinha(l: LinhaFaltaDias): number {
  return valorFaltasPorDias(l.valor_posto, l.dias);
}

export function totalFaltasLinhas(linhas: LinhaFaltaDias[]): number {
  return arred2(linhas.reduce((s, l) => s + valorDaLinha(l), 0));
}

// Itens que têm alguma linha ligada (o campo Faltas deles passa a ser calculado).
export function itensComFaltasCalculadas(linhas: LinhaFaltaDias[]): Set<number> {
  const s = new Set<number>();
  for (const l of linhas) if (l.item != null) s.add(l.item);
  return s;
}

// Aplica as linhas nos itens: o `faltas` de cada item ligado (antes ou agora) vira a
// soma das linhas atuais dele (0 se a última linha foi desligada). Itens que nunca
// tiveram linha ficam como estão (valor digitado).
export function aplicarFaltasNosItens<T extends { faltas: number }>(
  itens: T[],
  linhasAntes: LinhaFaltaDias[],
  linhasDepois: LinhaFaltaDias[],
): T[] {
  const afetados = new Set<number>([...itensComFaltasCalculadas(linhasAntes), ...itensComFaltasCalculadas(linhasDepois)]);
  if (afetados.size === 0) return itens;
  return itens.map((it, i) => {
    if (!afetados.has(i)) return it;
    const soma = arred2(linhasDepois.filter((l) => l.item === i).reduce((s, l) => s + valorDaLinha(l), 0));
    return soma === it.faltas ? it : { ...it, faltas: soma };
  });
}

// Ao remover o item `removido`, as linhas dele ficam sem item e as dos itens
// seguintes passam para o índice anterior.
export function reindexarLinhasAoRemoverItem(linhas: LinhaFaltaDias[], removido: number): LinhaFaltaDias[] {
  return linhas.map((l) => {
    if (l.item == null) return l;
    if (l.item === removido) return { ...l, item: null };
    return l.item > removido ? { ...l, item: l.item - 1 } : l;
  });
}

// Linha que vale gravar (ignora as totalmente em branco).
export function linhasParaGravar(linhas: LinhaFaltaDias[]): LinhaFaltaDias[] | null {
  const uteis = linhas.filter((l) => l.dias > 0 || l.posto || (l.valor_posto ?? 0) > 0);
  return uteis.length > 0 ? uteis : null;
}
