/**
 * Detecta erro causado por access token vencido/inválido.
 *
 * O supabase-js renova o token de forma reativa (tick de 30s + visibilitychange),
 * então uma aba que ficou em segundo plano — ou a máquina que dormiu — volta com
 * o token já expirado no localStorage. As requisições que saem nesse intervalo
 * pegam o token velho e falham; segundos depois a renovação conclui e tudo volta
 * ao normal. Estes erros são transitórios e merecem retry mais paciente que o
 * backoff genérico do React Query.
 *
 * Formatos possíveis:
 *  - PostgREST: { code: "PGRST301", message: "JWT expired" }
 *  - GoTrue (AuthApiError): { status: 401 | 403, message: "invalid JWT: ... token is expired" }
 */
export function isAuthExpiredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; status?: unknown; message?: unknown };

  if (e.code === "PGRST301" || e.code === "PGRST303") return true;
  if (e.status === 401 || e.status === 403) return true;

  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return msg.includes("jwt expired") || msg.includes("token is expired") || msg.includes("invalid jwt");
}