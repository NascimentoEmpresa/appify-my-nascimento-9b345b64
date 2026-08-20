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

/**
 * Rotas que TODO usuário autenticado acessa, sem depender de permissão.
 *
 * Existem porque o sistema passou a NEGAR POR PADRÃO: rota sem cadastro em
 * app_menu, ou menu sem permissão pra pessoa, é bloqueada. Sem esta lista, um
 * usuário recém-criado não conseguiria nem ver o próprio perfil nem abrir
 * chamado pra pedir acesso — ficaria preso sem caminho de saída.
 *
 * Não são "furos": nenhuma delas expõe dado de terceiro. O perfil é do próprio
 * usuário (RLS filtra por auth.uid()) e a abertura de chamado é justamente o
 * canal para pedir o acesso que falta.
 *
 * Mantenha curta. Tela de negócio NÃO entra aqui — entra em app_menu.
 */
export const ROTAS_SEMPRE_LIBERADAS = [
  "/app/meu-perfil",
  "/app/sistemas/chamados",
  "/app/central-servicos/chamados/novo",
];

/** Casa por prefixo, igual ao matchMenuCode (cobre subrotas e /:id). */
export function rotaSempreLiberada(pathname: string): boolean {
  return ROTAS_SEMPRE_LIBERADAS.some((r) => pathname === r || pathname.startsWith(r + "/"));
}

