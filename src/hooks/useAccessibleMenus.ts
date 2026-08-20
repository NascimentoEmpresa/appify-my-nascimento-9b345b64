import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";

/**
 * Returns the set of menu codes the current user can VIEW.
 * Used to filter the Sidebar and to enforce route-level access.
 *
 * Passes the active empresa to `list_accessible_menus` so that
 * per-empresa overrides in `screen_permission_user` are honored
 * by the menu/route layer (parity with `useScreenAccess`).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// app_menu.codigo só é único POR MÓDULO (UNIQUE (modulo_id, codigo)), não
// globalmente — dois módulos diferentes já colidiram no mesmo código na
// prática (ver 20260730000001_fix_menu_codigo_colisoes.sql). Por isso
// `routes` é uma LISTA (não um Map<codigo, rota>): um Map perderia
// silenciosamente uma das rotas quando dois módulos reusam o mesmo código,
// fazendo essa rota "sumir" do controle de acesso (tratada como nunca
// cadastrada, sempre aberta) sem nenhum aviso.
export interface MenuRoute {
  codigo: string;
  rota: string;
  ativo: boolean;
}

export function useAccessibleMenus(acao: string = "visualizar") {
  const { empresa } = useEmpresaAtiva();
  // Só passa pro banco se for um UUID real — mock IDs como "HAGG" causam erro 400.
  const rawId = empresa?.id ?? null;
  const empresaId = rawId && UUID_RE.test(rawId) ? rawId : null;

  return useQuery({
    queryKey: ["accessible-menus", acao, empresaId],
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return { codes: new Set<string>(), routes: [] as MenuRoute[], configuredCodes: new Set<string>(), inactiveCodes: new Set<string>() };

      const [rpcResult, menusResult, configuredResult] = await Promise.all([
        supabase.rpc("list_accessible_menus", {
          _user: u.user.id,
          _acao: acao,
          _empresa: empresaId,
        }),
        // Traz INATIVOS também. Antes filtrava ativo=true, e isso tinha um
        // efeito perverso: menu desativado sumia do casamento de rota, a rota
        // virava "não cadastrada" e o RouteGuard a tratava como ABERTA. Ou
        // seja, desativar um menu no Catálogo publicava a tela em vez de
        // fechá-la — 14 rotas estavam assim (todo o Suprimentos legado,
        // /app/pregao, /app/triagem). Agora o menu inativo continua casando a
        // rota, e o RouteGuard nega por estar inativo.
        supabase.from("app_menu").select("codigo, rota, ativo"),
        // Menus sem NENHUMA configuração em perfil_acesso_permissao/screen_permission_user
        // (ninguém nunca mexeu no gerenciamento de acesso pra eles) ficam de fora do
        // enforcement — ver 20260729000001_routeguard_list_configured_menu_codes.sql.
        (supabase as any).rpc("list_configured_menu_codes"),
      ]);

      if (rpcResult.error) {
        console.warn("list_accessible_menus error", rpcResult.error);
        return { codes: new Set<string>(), routes: [] as MenuRoute[], configuredCodes: new Set<string>(), inactiveCodes: new Set<string>() };
      }
      const codes = new Set<string>((rpcResult.data ?? []).map((r: any) => r.menu_codigo));

      const menus = (menusResult.data ?? []) as { codigo: string; rota: string | null; ativo: boolean }[];

      const routes: MenuRoute[] = menus
        .filter((m) => !!m.rota)
        .map((m) => ({ codigo: m.codigo, rota: m.rota as string, ativo: m.ativo }));

      // Códigos desativados no Catálogo: o RouteGuard nega, e a Sidebar não
      // lista. Um menu desativado é uma tela fora do ar, não uma tela pública.
      const inactiveCodes = new Set<string>(menus.filter((m) => !m.ativo).map((m) => m.codigo));

      if (configuredResult.error) console.warn("list_configured_menu_codes error", configuredResult.error);
      const configuredCodes = new Set<string>(
        ((configuredResult.data ?? []) as { menu_codigo: string }[]).map((r) => r.menu_codigo),
      );

      return { codes, routes, configuredCodes, inactiveCodes };
    },
  });
}

/**
 * Best-effort match of a pathname to an app_menu code (longest-prefix).
 *
 * Desempate por ATIVO, e isso não é detalhe: a mesma rota aparece cadastrada
 * duas vezes em vários lugares — uma entrada viva e uma sobra desativada de
 * quando a tela mudou de módulo (ex.: /app/rh/recrutamento existe como
 * `recrutamento` em RH, inativo, e como `recrutamento_gestao` em Recrutamento
 * e Seleção, ativo). Sem o desempate, a ordem que o banco devolveu decidia
 * quem vencia; se viesse a inativa, o RouteGuard bloqueava a tela e o painel
 * de acesso não resolvia — porque lá só aparece a ativa, e conceder nela não
 * mudava o casamento. Foi assim que "Gestão e Recrutamento" sumiu da sidebar.
 *
 * Regra: entre dois casamentos de mesmo comprimento, o ATIVO ganha. Comprimento
 * maior continua tendo prioridade sobre tudo (rota mais específica).
 */
export function matchMenuCode(pathname: string, routes: MenuRoute[]): string | null {
  let best: { code: string; len: number; ativo: boolean } | null = null;
  for (const { codigo, rota, ativo } of routes) {
    // Normalize dynamic segments like /:id by comparing only up to the first ":"
    const base = rota.split("/:")[0];
    if (pathname === rota || pathname === base || pathname.startsWith(base + "/")) {
      const melhor =
        !best ||
        base.length > best.len ||
        (base.length === best.len && ativo && !best.ativo);
      if (melhor) best = { code: codigo, len: base.length, ativo };
    }
  }
  return best?.code ?? null;
}
