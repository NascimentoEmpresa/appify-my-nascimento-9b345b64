import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";

// Capacidades do módulo de Chamados de Sistemas, lidas de "Acesso por Usuário".
// - abrir: aberto a todos por padrão; vira restrito quando alguém é configurado
//   (mesma regra de canSee do resto do ERP: liberado OU ninguém configurou).
// - painel / coordenar / aprovar / dev: fechados até liberação explícita.
// gestor = qualquer papel de gestão (vê o painel, a fila e os chamados todos).
export function useChamadoPerms() {
  const { data: access, isLoading } = useAccessibleMenus("visualizar");
  const has = (c: string) => access?.codes.has(c) ?? false;
  const configurado = (c: string) => access?.configuredCodes.has(c) ?? false;

  const canAbrir = has("chamados_sistemas_abrir") || !configurado("chamados_sistemas_abrir");
  const canPainel = has("chamados_sistemas_painel");
  const canCoordenar = has("chamados_sistemas_coordenar");
  const canAprovar = has("chamados_sistemas_aprovar");
  const canDev = has("chamados_sistemas_dev");
  const gestor = canPainel || canCoordenar || canAprovar;

  return { canAbrir, canPainel, canCoordenar, canAprovar, canDev, gestor, loading: isLoading || !access };
}
