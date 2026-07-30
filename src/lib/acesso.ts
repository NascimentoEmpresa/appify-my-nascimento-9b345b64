/**
 * Chave de fase do controle de acesso por tela.
 *
 * true  = ACESSO ABERTO: todo usuário autenticado vê todos os módulos e telas
 *         (fase FRONT — módulos entregues sem regra de permissão).
 * false = enforcement deny-by-default: a tela precisa estar cadastrada em
 *         app_menu e o usuário precisa de allow=true explícito no painel
 *         "Acesso por Usuário" (RPC list_accessible_menus).
 *
 * Histórico: esteve em `true` de 2026-07-10 a 2026-07-22 enquanto o redesenho
 * de acesso (perfil_acesso 100% por perfil, ver supabase/migrations/2026071*
 * e 2026072*) era construído no back-end. Voltou pra `false` com o back-end
 * validado em produção.
 */
export const ACESSO_ABERTO_SEM_PERMISSOES = false;

/**
 * Menus que NUNCA caem no "ninguém configurou nada ainda, deixa aberto"
 * (ver useAccessibleMenus/configuredCodes). São a própria superfície de
 * administração e migração de dados — deliberadamente restritas a quem tem
 * perfil concede_tudo (ou grant explícito), sem nenhuma linha em
 * perfil_acesso_permissao/screen_permission_user porque nunca precisaram de
 * granularidade por perfil comum, não porque foram esquecidas.
 */
export const MENUS_SEMPRE_RESTRITOS = new Set(["administracao", "integracao", "integracao-aliases"]);

