import { useAuth } from "@/hooks/useAuth";

/**
 * Modo externo — o encarregado de campo que entrou pela aba "Externo" do login.
 *
 * Por baixo ele é uma SESSÃO ANÔNIMA do Supabase (signInAnonymously). O
 * Supabase emite para ele um JWT com o papel `authenticated` e a claim
 * `is_anonymous: true` — ou seja, ele passa por todas as policies `TO
 * authenticated` do banco como qualquer outro usuário.
 *
 * O que efetivamente o contém NÃO é este hook: é a RLS. Um anônimo não tem
 * linha em user_empresa nem perfil de acesso, então can_access() e o filtro
 * de empresa devolvem falso para ele em absolutamente tudo. O único caminho
 * que ele tem no banco são as RPCs sup_ext_* e o ramo de sup_ext_sessao nas
 * policies de sup_pedido.
 *
 * As checagens de front que usam este hook são CONVENIÊNCIA DE UI — servem
 * para ele não ver menu que não vai funcionar. Elas só restringem, nunca
 * concedem: nenhuma delas libera nada que a RLS negue.
 *
 * Atenção: quem entra pela aba "Externo" mas TEM conta vinculada
 * (EMPREGADOS.auth_user_id) entra na conta real, com is_anonymous = false —
 * para o sistema ele é um usuário comum e nada aqui se aplica a ele.
 */

/**
 * Prefixos que o usuário externo pode navegar. Tudo fora daqui é negado.
 *
 * O grosso é o módulo Encarregados INTEIRO: quem entra pela aba "Externo"
 * trabalha em /app/encarregados (solicitar materiais, meus pedidos, minhas
 * solicitações, férias, vaga, advertência, chamados). Antes a lista tinha só
 * as duas primeiras telas, e as outras do próprio módulo caíam fora da
 * allowlist — funcionavam apenas porque o RouteGuard liberava rota não
 * cadastrada, o que deixou de valer com o deny-by-default.
 *
 * Fora do módulo entram só as duas telas fixas do menu dele, nenhuma delas de
 * negócio:
 *   • /app/novidades  — changelog do ERP, o mesmo item fixo da sidebar;
 *   • /app/meu-perfil — a própria ficha (nome, foto), pelo menu do Topbar.
 * A terceira é a home (/app), que precisa de casamento EXATO e por isso mora
 * na lista separada logo abaixo.
 */
// Atenção à ordem: Login.tsx usa ROTAS_EXTERNO[0] como destino pós-login.
export const ROTAS_EXTERNO = [
  "/app/encarregados",
  "/app/novidades",
  "/app/meu-perfil",
];

/**
 * Rotas do externo liberadas SÓ em casamento exato — nunca por prefixo.
 *
 * "/app" é a tela Início. Colocá-la na lista de cima liberaria
 * "/app/qualquer-coisa" e anularia a allowlist inteira. Mesma separação que
 * ROTAS_LIBERADAS_EXATAS faz em src/lib/acesso.ts, e pelo mesmo motivo.
 */
export const ROTAS_EXTERNO_EXATAS = ["/app"];

export function useModoExterno(): boolean {
  const { user } = useAuth();
  return user?.is_anonymous === true;
}

/**
 * Prefixo para ROTAS_EXTERNO (cobre subrotas e /:id), exato para
 * ROTAS_EXTERNO_EXATAS. Mesma normalização de barra final que
 * rotaSempreLiberada faz em src/lib/acesso.ts — "/app/" é "/app".
 */
export function rotaPermitidaExterno(pathname: string): boolean {
  const normalizada = pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
  if (ROTAS_EXTERNO_EXATAS.includes(normalizada)) return true;
  return ROTAS_EXTERNO.some((r) => normalizada === r || normalizada.startsWith(r + "/"));
}
