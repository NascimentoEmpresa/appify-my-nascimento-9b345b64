// SIS-2026-0840: ao aprovar uma despesa aberta a partir de "Aprovações do Malote", a tela volta sozinha para a lista (aprovação em sequência).
// A lista manda de onde veio no `state` da navegação; a despesa só volta para lá se a aprovação deu certo (erro/validação: fica na despesa).
// Despesa aberta por outro caminho (Meus Itens, notificação, link direto) não tem esse state e fica onde está, como sempre.

/** O `state` que a lista passa ao abrir uma despesa: a própria rota (com a query) para voltar a ela. */
export function estadoDeRetornoDaLista(pathname: string, search: string): { voltarPara: string } {
  return { voltarPara: `${pathname}${search}` };
}

/** Rota para onde voltar depois de aprovar, ou null para ficar na despesa. Só aceita caminho interno do app. */
export function destinoAposAprovar(state: unknown): string | null {
  const v = (state as { voltarPara?: unknown } | null | undefined)?.voltarPara;
  if (typeof v !== "string") return null;
  return v.startsWith("/app/") && !v.startsWith("//") ? v : null;
}
