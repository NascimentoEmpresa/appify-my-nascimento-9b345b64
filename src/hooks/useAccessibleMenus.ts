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
      if (!u.user) return { codes: new Set<string>(), routes: [] as MenuRoute[], configuredCodes: new Set<string>() };

      const [rpcResult, menusResult, configuredResult] = await Promise.all([
        supabase.rpc("list_accessible_menus", {
          _user: u.user.id,
          _acao: acao,
          _empresa: empresaId,
        }),
        supabase.from("app_menu").select("codigo, rota").eq("ativo", true),
        // Menus sem NENHUMA configuração em perfil_acesso_permissao/screen_permission_user
        // (ninguém nunca mexeu no gerenciamento de acesso pra eles) ficam de fora do
        // enforcement — ver 20260729000001_routeguard_list_configured_menu_codes.sql.
        (supabase as any).rpc("list_configured_menu_codes"),
      ]);

      if (rpcResult.error) {
        console.warn("list_accessible_menus error", rpcResult.error);
        return { codes: new Set<string>(), routes: [] as MenuRoute[], configuredCodes: new Set<string>() };
      }
      const codes = new Set<string>((rpcResult.data ?? []).map((r: any) => r.menu_codigo));

      const routes: MenuRoute[] = ((menusResult.data ?? []) as { codigo: string; rota: string | null }[])
        .filter((m) => !!m.rota)
        .map((m) => ({ codigo: m.codigo, rota: m.rota as string }));

      if (configuredResult.error) console.warn("list_configured_menu_codes error", configuredResult.error);
      const configuredCodes = new Set<string>(
        ((configuredResult.data ?? []) as { menu_codigo: string }[]).map((r) => r.menu_codigo),
      );

      return { codes, routes, configuredCodes };
    },
  });
}

/** Best-effort match of a pathname to an app_menu code (longest-prefix). */
export function matchMenuCode(pathname: string, routes: MenuRoute[]): string | null {
  let best: { code: string; len: number } | null = null;
  for (const { codigo, rota } of routes) {
    // Normalize dynamic segments like /:id by comparing only up to the first ":"
    const base = rota.split("/:")[0];
    if (pathname === rota || pathname === base || pathname.startsWith(base + "/")) {
      if (!best || base.length > best.len) best = { code: codigo, len: base.length };
    }
  }
  return best?.code ?? null;
}
