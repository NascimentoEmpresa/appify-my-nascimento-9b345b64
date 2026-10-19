// Fatia uma lista de ids em lotes e roda uma consulta por lote, em paralelo.
//
// POR QUE EXISTE (19/10/2026)
// Depois da virada para o cluster (api.grpnascimento.com.br), o gateway de lá
// devolve 502 "An invalid response was received from the upstream server"
// quando a URL passa de ~4 KB — medido: 3.804 caracteres passa, 3.999 não.
// Na Supabase o limite era bem mais alto, então várias telas mandavam
// `.in("id", todosOsIds)` sem pensar no tamanho. Cada uuid custa ~39
// caracteres na URL (36 + a vírgula codificada), e um `select` comprido já
// come metade do limite (o do Malote tem ~1,9 KB).
//
// Casos reais do mesmo dia: Caixa de Entrada do WhatsApp sem nome nenhum
// (100 contatos por lote) e o Meus Itens do Malote vazio para quem tem setor
// liberado (todas as classificações do setor numa URL só).
//
// Regra prática: lote de 40 com select curto; 20 com select comprido.

export function fatiar<T>(lista: T[], tamanho: number): T[][] {
  if (tamanho < 1) throw new Error("Tamanho do lote precisa ser ao menos 1");
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
  return lotes;
}

/**
 * Roda `consulta` para cada lote de `ids` e junta as linhas. Lista vazia não
 * consulta nada. O primeiro erro de qualquer lote é lançado — melhor a tela
 * mostrar o erro do que uma lista pela metade, que parece completa.
 */
export async function emLotes<T>(
  ids: string[],
  tamanho: number,
  consulta: (lote: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const respostas = await Promise.all(fatiar(ids, tamanho).map((lote) => consulta(lote)));
  const linhas: T[] = [];
  for (const { data, error } of respostas) {
    if (error) throw error;
    linhas.push(...(data ?? []));
  }
  return linhas;
}
