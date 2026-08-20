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
  // Avisos do sistema (changelog do ERP). A sidebar mostra o item para todo
  // mundo, então sem estar aqui o clique dava "Acesso negado".
  "/app/novidades",
];

/**
 * Rotas liberadas SÓ em casamento exato — nunca por prefixo.
 *
 * "/app" é a tela inicial e não tem entrada em app_menu (é o shell, não um
 * módulo). Sem estar aqui, o deny-by-default barrava a própria home: o
 * usuário logava e tomava "Acesso negado" na primeira tela, sem nada no painel
 * de administração que pudesse liberar — porque não é menu, não aparece lá.
 *
 * Precisa ser lista separada porque a de cima casa por PREFIXO: "/app" ali
 * dentro liberaria "/app/qualquer-coisa" e anularia o controle inteiro.
 */
export const ROTAS_LIBERADAS_EXATAS = ["/app"];

/**
 * Prefixo para ROTAS_SEMPRE_LIBERADAS (cobre subrotas e /:id), exato para
 * ROTAS_LIBERADAS_EXATAS.
 */
export function rotaSempreLiberada(pathname: string): boolean {
  const normalizada = pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
  if (ROTAS_LIBERADAS_EXATAS.includes(normalizada)) return true;
  return ROTAS_SEMPRE_LIBERADAS.some((r) => normalizada === r || normalizada.startsWith(r + "/"));
}

