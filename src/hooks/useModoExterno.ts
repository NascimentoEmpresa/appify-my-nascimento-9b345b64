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
 */

/** Prefixos que o usuário externo pode navegar. Tudo fora daqui é negado. */
export const ROTAS_EXTERNO = [
  "/app/encarregados/solicitar-materiais",
  "/app/encarregados/meus-pedidos",
];

export function useModoExterno(): boolean {
  const { user } = useAuth();
  return user?.is_anonymous === true;
}

export function rotaPermitidaExterno(pathname: string): boolean {
  return ROTAS_EXTERNO.some((r) => pathname === r || pathname.startsWith(r + "/"));
}
