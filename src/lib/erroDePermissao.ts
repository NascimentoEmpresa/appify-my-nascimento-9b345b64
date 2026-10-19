// Reconhece, entre os erros que chegam ao ErroDeTela, os que são de PERMISSÃO
// (RLS / função do banco recusando o usuário) — e não queda do sistema.
//
// 15/10/2026: a Calita perdeu o cargo de gerente e, ao clicar em "Minhas" nas
// Aprovações do Malote, caiu em "Sistema temporariamente indisponível / 404".
// O ERP estava de pé; faltava só permissão. Quem vê "indisponível" abre
// chamado de queda e espera o sistema voltar, em vez de pedir o acesso.
export function ehErroDePermissao(erro: unknown): boolean {
  if (!erro) return false;
  const e = erro as { code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown };
  if (String(e.code ?? "") === "42501") return true; // insufficient_privilege (Postgres/PostgREST)
  if (e.status === 403 || e.statusCode === 403) return true;
  const msg = (typeof e.message === "string" ? e.message : String(erro)).toLowerCase();
  return (
    msg.includes("permission denied") ||
    msg.includes("row-level security") ||
    msg.includes("insufficient_privilege") ||
    msg.includes("not authorized") ||
    msg.includes("sem permiss") ||
    msg.includes("sem acesso")
  );
}
