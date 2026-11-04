// =====================================================================
// LEITURA COMPACTA — remonta o formato de fluxo_caixa_ler_fonte_compacta
// (migration 20261104000100) nos MESMOS objetos de fluxo_caixa_ler_fonte.
//
// Formato que chega:
//   { v: 1,
//     cols:   ["despesa_id", "empresa_id", "valor", ...],
//     dic:    { despesa_id: [...], empresa_id: ["uuid-a", "uuid-b"], ... },
//     linhas: [[0, 1, 1520.5, ...], ...] }
// Coluna que está em `dic`: o valor da linha é a POSIÇÃO no dicionário
// (null continua null). Coluna fora de `dic` (número, booleano, json): o
// valor vem cru.
//
// Saída: um objeto por linha com TODAS as colunas, inclusive as nulas —
// igual ao json_agg(t) de antes. A igualdade foi provada na produção para
// as 8 fontes e vários usuários (infra/qa/conferir-leitura-compacta.mjs),
// e é travada por src/test/leitura-compacta.test.ts.
// =====================================================================

export interface LeituraCompacta {
  v: 1;
  // Fonte com mais de 100 colunas (planilha_custo): cada linha chega em
  // pedaços de até 100 — limite de argumentos de função do Postgres — e é
  // emendada aqui.
  partes?: boolean;
  cols: string[];
  dic: Record<string, unknown[]>;
  linhas: unknown[][];
}

export function ehLeituraCompacta(x: unknown): x is LeituraCompacta {
  return !!x && typeof x === "object" && (x as LeituraCompacta).v === 1 && Array.isArray((x as LeituraCompacta).linhas);
}

export function decodificarCompacto(dado: LeituraCompacta): Record<string, unknown>[] {
  const { cols, dic, linhas, partes } = dado;
  const dics = cols.map((c) => dic[c] ?? null);
  const saida: Record<string, unknown>[] = new Array(linhas.length);
  for (let i = 0; i < linhas.length; i++) {
    const l = partes ? (linhas[i] as unknown[][]).flat() : linhas[i];
    const o: Record<string, unknown> = {};
    for (let j = 0; j < cols.length; j++) {
      const v = l[j];
      const d = dics[j];
      o[cols[j]] = d === null || v === null ? v : d[v as number];
    }
    saida[i] = o;
  }
  return saida;
}

type ClienteRpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }> };

/**
 * Lê uma fonte pela RPC compacta `fn` e devolve os objetos remontados.
 * null = a função ainda não existe no banco (front publicado antes da
 * migration) — quem chamou cai na leitura de sempre. Outro erro sobe.
 */
export async function lerCompactoOuNada(cliente: ClienteRpc, fn: string, fonte: string): Promise<Record<string, unknown>[] | null> {
  const { data, error } = await cliente.rpc(fn, { p_fonte: fonte });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return null;
    throw error;
  }
  return ehLeituraCompacta(data) ? decodificarCompacto(data) : null;
}
