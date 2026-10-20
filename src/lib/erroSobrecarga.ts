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
 *
 * O VOCABULÁRIO MUDOU NA VIRADA PARA O CLUSTER (20/10/2026)
 * ─────────────────────────────────────────────────────────
 * Esta lista nasceu em setembro, quando a borda era Cloudflare + gateway da
 * Supabase. Desde 17/10 quem atende `api.grpnascimento.com.br` é o **Kong**
 * do cluster, e ele escreve os erros dele com outras palavras — nenhuma
 * delas estava aqui. O caso real: `/app/suprimentos/cotacoes` devolveu
 *
 *     502 {"message":"An invalid response was received from the upstream server"}
 *
 * e o `isSobrecargaError` respondeu FALSE. O porquê é sutil e vale registrar:
 * o postgrest-js monta o erro com `JSON.parse(body)` (PostgrestBuilder.ts),
 * então o objeto que chega aqui é literalmente `{ message: "..." }` — SEM
 * `status`, sem `code`. A checagem numérica de 502 lá em cima nunca tem o
 * que olhar; sobra só o texto. Com o texto do Kong fora da lista, um erro de
 * borda passou a ser tratado como erro de aplicação, com duas consequências:
 *
 *   1. o QueryClient caía no ramo genérico (3 tentativas, backoff curto) em
 *      vez do recuo de UMA tentativa que o incidente de 21/09 ensinou — ou
 *      seja, a lição do colapso por congestionamento deixou de valer
 *      silenciosamente no dia em que trocamos de gateway;
 *   2. a tela mostrava a frase em inglês do Kong como se fosse defeito da
 *      consulta, num painel sem saída.
 *
 * Por isso os trechos abaixo incluem o que o Kong fala. Ao trocar de borda
 * de novo, ESTA LISTA É PARTE DA VIRADA: borda nova, palavras novas.
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
  // Kong do cluster (desde 17/10/2026). "upstream server" cobre as duas
  // frases dele que importam: a de 502 ("An invalid response was received
  // from the upstream server") e a de 504 ("The upstream server is timing
  // out" — note que é "timing", não "timed", então não cai no trecho acima).
  "upstream server",
  // Quando quem responde é o Caddy/nginx na frente do Kong, ou o próprio
  // Kong sem corpo JSON.
  "bad gateway",
  "gateway time",
  // Kong sem nenhum destino de pé (todos os containers fora do ar).
  "failure to get a peer",
  "ring-balancer",
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
