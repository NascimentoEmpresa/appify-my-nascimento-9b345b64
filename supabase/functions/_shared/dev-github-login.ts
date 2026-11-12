// Arquivo: supabase/functions/_shared/dev-github-login.ts
//
// Login do GitHub → profiles.id, para gravar o evento do chamado
// (CHAMADO_SISTEMA_EVENTO.autor_id é NOT NULL). Usado por chamado-vincular-pr
// e chamado-concluir-pr.
//
// POR QUE A TABELA (12/11/2026, auditoria da Bonificação, aprovado pelo Iury):
// as duas Edges tinham a lista chumbada no código, sem `PabloTasuyuk` (conta
// nova do Pablo desde a suspensão de 13/10) nem `otaviosistemas`. A PR deles
// não concluía o chamado nem vinculava a PR, então os chamados de dois devs
// seguiam um caminho diferente dos outros — e isso pesou no valor de cada um
// na Bonificação. A fonte única passa a ser "DEV_GITHUB_USUARIO" (mig
// 20261029004900), a mesma da tela Controle de Pull Requests; a lista antiga
// fica só de reserva, se a tabela não responder.

// deno-lint-ignore no-explicit-any
type Cliente = { from: (t: string) => any };

const RESERVA: Record<string, string> = {
  eduardojeiel007: "97260632-2f1a-44e3-9f93-58b2b1f3702c",
  tasuyuk1: "301bfa45-d01a-4e81-abd9-18d48bccef97",
  joaovperetti: "e2c4faf6-289e-4f80-a235-628c2d674f46",
};

/** profiles.id do login (sem diferenciar maiúsculas), ou null se não é dev do time. */
export async function perfilDoLoginGithub(admin: Cliente, login: string): Promise<string | null> {
  const chave = String(login ?? "").trim().toLowerCase();
  if (!chave) return null;
  const { data, error } = await admin
    .from("DEV_GITHUB_USUARIO")
    .select("login, profile_id")
    .not("profile_id", "is", null)
    .limit(200);
  if (error) {
    console.error("DEV_GITHUB_USUARIO:", error.message);
    return RESERVA[chave] ?? null;
  }
  const linha = (data ?? []).find((l: { login: string }) => String(l.login).toLowerCase() === chave);
  return linha?.profile_id ?? RESERVA[chave] ?? null;
}
