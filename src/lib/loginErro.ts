// =====================================================================
// LOGIN — erro do banco x erro da pessoa (16/10/2026)
//
// Em 16/10/2026, com o banco reiniciando na troca de instância (Small →
// Medium), o login devolvia "Database error querying schema" para algumas
// pessoas. Não era a conta: a mesma conta, minutos depois, entrava. O GoTrue
// devolve essa frase (HTTP 500) quando não consegue ler auth.users — banco
// fora, sobrecarregado ou sem conexão livre. Mostrar isso cru fazia a pessoa
// achar que o cadastro estava quebrado e chamar o T.I.
//
// Daí as duas regras: erro TRANSITÓRIO (do servidor) tenta de novo sozinho
// algumas vezes; se ainda assim falhar, a mensagem diz que é o sistema, não
// a senha. Senha errada nunca é repetida — repetir só gastaria o limite de
// tentativas do Supabase.
// =====================================================================

/** Erro que vem do servidor/banco e costuma passar em segundos. */
export function erroLoginTransitorio(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | null;
  if (e && typeof e.status === "number" && e.status >= 500) return true;
  const msg = String(e?.message ?? "");
  return /database error|querying schema|failed to fetch|networkerror|load failed|timeout|unexpected_failure/i.test(msg);
}

/** Texto que a tela mostra para o erro. */
export function mensagemErroLogin(err: unknown): string {
  const msg = String((err as { message?: string } | null)?.message ?? "");
  if (msg.includes("Invalid login credentials")) return "E-mail ou senha incorretos.";
  if (msg.includes("Email not confirmed")) return "E-mail ainda não confirmado. Fale com o administrador do sistema.";
  if (erroLoginTransitorio(err)) return "O sistema está instável neste momento e não conseguiu validar o acesso. Sua senha não foi recusada — tente de novo em alguns instantes.";
  return msg || "Erro desconhecido";
}

/** Espera entre as tentativas automáticas (ms). Duas novas tentativas: ~1,5 s e ~3,5 s. */
export const ESPERAS_LOGIN_MS = [1500, 3500];
