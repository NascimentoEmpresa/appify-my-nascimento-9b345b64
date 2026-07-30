import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import { MENUS_SEMPRE_ABERTOS } from "@/lib/acesso";

// Capacidades do módulo de Chamados de Sistemas, lidas de "Acesso por Usuário".
// - abrir: aberto a todos por padrão; vira restrito quando alguém é configurado
//   (mesma regra de canSee do resto do ERP: liberado OU ninguém configurou).
// - painel / coordenar / aprovar / dev: fechados até liberação explícita.
// gestor = qualquer papel de gestão (vê o painel, a fila e os chamados todos).
export function useChamadoPerms() {
  const { data: access, isLoading } = useAccessibleMenus("visualizar");
  const has = (c: string) => access?.codes.has(c) ?? false;
  const configurado = (c: string) => access?.configuredCodes.has(c) ?? false;

  // Abrir chamado é liberado a todos por padrão (menu sempre aberto), mesmo que
  // exista configuração de acesso — não precisa habilitar usuário por usuário.
  const canAbrir = MENUS_SEMPRE_ABERTOS.has("chamados_sistemas_abrir")
    || has("chamados_sistemas_abrir") || !configurado("chamados_sistemas_abrir");
  const canPainel = has("chamados_sistemas_painel");
  const canCoordenar = has("chamados_sistemas_coordenar");
  const canAprovar = has("chamados_sistemas_aprovar");
  const canDev = has("chamados_sistemas_dev");
  const canExcluir = has("chamados_sistemas_excluir");
  const gestor = canPainel || canCoordenar || canAprovar;

  return { canAbrir, canPainel, canCoordenar, canAprovar, canDev, canExcluir, gestor, loading: isLoading || !access };
}
