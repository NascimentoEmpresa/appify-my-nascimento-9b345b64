import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";

// Capacidades do módulo de Chamados de Sistemas, lidas de "Acesso por Usuário".
// - abrir: acompanha o ACESSO À TELA (ver abaixo).
// - painel / coordenar / aprovar / dev: fechados até liberação explícita.
// gestor = qualquer papel de gestão (vê o painel, a fila e os chamados todos).

/**
 * As três portas da MESMA tela de chamados: a rota muda conforme o módulo por
 * onde a pessoa entra, mas o componente é um só (MeusChamados recebe `base`).
 */
const MENUS_DA_TELA = [
  "central_servicos_chamados",
  "chamados_sistemas",
  "encarregados_chamados",
] as const;

export function useChamadoPerms() {
  const { data: access, isLoading } = useAccessibleMenus("visualizar");
  const has = (c: string) => access?.codes.has(c) ?? false;

  const canPainel = has("chamados_sistemas_painel");
  const canCoordenar = has("chamados_sistemas_coordenar");
  const canAprovar = has("chamados_sistemas_aprovar");
  const canDev = has("chamados_sistemas_dev");
  const canExcluir = has("chamados_sistemas_excluir");
  const gestor = canPainel || canCoordenar || canAprovar;

  /**
   * Quem alcança a tela pode abrir chamado.
   *
   * A regra anterior era "liberado OU ninguém configurou `chamados_sistemas_abrir`"
   * — o default permissivo morreu no dia em que a primeira pessoa foi
   * configurada naquele código (hoje são 61 exceções individuais e 40 regras de
   * perfil). Daí o sintoma: gente com a tela liberada entrando e não achando o
   * botão, numa tela que ainda dizia "Clique em Abrir Novo Chamado".
   *
   * Espelha `chamado_pode_abrir()` no banco, que é quem de fato autoriza o
   * INSERT — aqui é só para não mostrar um botão que o banco recusaria.
   * `chamados_sistemas_abrir` segue como OR (preserva quem já tinha a
   * capacidade avulsa), mas não restringe mais ninguém.
   */
  const canAbrir =
    MENUS_DA_TELA.some(has)
    // Quem gerencia chamado obviamente pode abrir um.
    || gestor
    || canDev
    // Aditivo: preserva quem já tinha a capacidade avulsa.
    || has("chamados_sistemas_abrir");

  return { canAbrir, canPainel, canCoordenar, canAprovar, canDev, canExcluir, gestor, loading: isLoading || !access };
}
