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
  const canExcluir = has("chamados_sistemas_excluir");
  const canDashboard = has("chamados_sistemas_dashboard");
  const gestor = canPainel || canCoordenar || canAprovar;
  // Ver TODOS os chamados (só leitura) — quem coordena e também quem tem só o
  // painel de TV. Espelha chamado_sistema_pode_ver_todos() na RLS: o dashboard
  // enxerga tudo, mas não escreve nada.
  const podeVerTodos = gestor || canDashboard;

  return {
    canAbrir, canPainel, canCoordenar, canAprovar, canDev, canExcluir, canDashboard,
    gestor, podeVerTodos, loading: isLoading || !access,
  };
}
