/**
 * Detecta erro causado por BANCO/BORDA SOBRECARREGADO — não por dado errado.
 *
 * Por que isto existe (21/09/2026)
 * ───────────────────────────────
 * Às 14:01:59 o Postgres de produção reiniciou sozinho por esgotamento de
 * conexões (61 em uso para 57 utilizáveis na instância Micro). Investigando a
 * queda, o `retry` do QueryClient apareceu como AGRAVANTE do incidente, não
 * como vítima dele.
 *
 * O `retry` tratava dois casos: token vencido (5 tentativas, pacientes) e
 * "todo o resto" (3 tentativas, backoff 1s/2s/4s). Erro de banco afogado caía
 * em "todo o resto". Resultado: no momento exato em que o banco não dava conta,
 * cada consulta que falhava era repetida mais 3 vezes — multiplicado por todos
 * os usuários conectados e pelos ~500 pontos de `useQuery` do sistema.
 *
 * Isso é colapso por congestionamento: a resposta automática à sobrecarga era
 * gerar MAIS carga. É plausivelmente o que transformou um pico de conexões
 * (que seria lentidão passageira) num reinício do banco.
 *
 * O que fazer com estes erros é o oposto do instinto: recuar. Uma única nova
 * tentativa, espaçada e com atraso ALEATÓRIO — sem o aleatório, todos os
 * navegadores voltam ao mesmo tempo e batem no banco em bloco de novo.
 *
 * Não confundir com token vencido: aquele é transitório e local, merece
 * insistência (ver `isAuthExpiredError` em ./authErrors). Por isso a checagem
 * de auth vem SEMPRE antes desta no QueryClient — 401/403 é auth, não
 * sobrecarga.
 *
 * Formatos que aparecem quando o banco/borda está afogado:
 *  - Cloudflare à frente do projeto: 521 (origem recusando), 522/524 (timeout)
 *  - Gateway da Supabase: 503 (sem conexão disponível), 504
 *  - Limite de taxa: 429
 *  - `fetch` morrendo antes de qualquer resposta HTTP: TypeError "Failed to fetch"
 */

const STATUS_SOBRECARGA = new Set([429, 502, 503, 504, 521, 522, 523, 524]);

const TRECHOS_SOBRECARGA = [
  "failed to fetch",
  "fetch failed",
  "networkerror",
  "network request failed",
  "load failed",
  "timeout",
  "timed out",
  "econnreset",
  "socket hang up",
  "too many",
  "service unavailable",
  "upstream connect",
  "no connection",
  "connection to database not available",
];

export function isSobrecargaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown };

  // `statusCode` aparece nos erros de storage; `status` nos de HTTP/GoTrue.
  for (const bruto of [e.status, e.statusCode, e.code]) {
    const n = typeof bruto === "string" ? Number(bruto) : bruto;
    if (typeof n === "number" && Number.isFinite(n) && STATUS_SOBRECARGA.has(n)) return true;
  }

  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (!msg) return false;
  return TRECHOS_SOBRECARGA.some((t) => msg.includes(t));
}

/**
 * Atraso da ÚNICA nova tentativa permitida para erro de sobrecarga.
 *
 * Entre 4 e 12 segundos, sorteado. O sorteio é a parte importante: dá tempo do
 * banco respirar e evita que todos os navegadores voltem no mesmo instante.
 */
export function atrasoSobrecargaMs(): number {
  return 4_000 + Math.floor(Math.random() * 8_000);
}
