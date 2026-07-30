import { ReactNode, useEffect, useRef } from "react";
import { useLocation, Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAccessibleMenus, matchMenuCode } from "@/hooks/useAccessibleMenus";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useFeatureFlag } from "@/lib/featureFlags";
import { ACESSO_ABERTO_SEM_PERMISSOES, MENUS_SEMPRE_RESTRITOS } from "@/lib/acesso";

/**
 * Bloco V3 — Rotas governadas por feature flag soberana de fase.
 * Quando a flag está desativada, o RouteGuard nega acesso mesmo que a rota
 * esteja em app_menu / permissões. Reativação exige flip explícito da flag.
 */
const PHASE_FLAGGED_ROUTES: { prefix: string; flag: "triagemIA" }[] = [
  // Triagem IA — desativada permanentemente (decisão de negócio 2026-05-28).
  { prefix: "/app/triagem", flag: "triagemIA" },
  // Copiloto IA (plano de ações) — desativado permanentemente sob a mesma flag
  // soberana de IA. Decisão de negócio 2026-05-28: nenhum usuário final do ERP
  // deve acessar funcionalidades de IA da Fase 1.
  { prefix: "/app/plano-acoes/copiloto", flag: "triagemIA" },
];

export function RouteGuard({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { data: access, isLoading } = useAccessibleMenus("visualizar");
  const loggedRef = useRef<string>("");

  // Bloco V3 — checagem soberana de fase via feature flag.
  const [triagemIAEnabled] = useFeatureFlag("triagemIA", false);
  const phaseFlagged = PHASE_FLAGGED_ROUTES.find(
    (r) => pathname === r.prefix || pathname.startsWith(r.prefix + "/"),
  );
  const phaseFlagEnabled = phaseFlagged
    ? (phaseFlagged.flag === "triagemIA" ? triagemIAEnabled : false)
    : true;

  const menuCode = access ? matchMenuCode(pathname, access.routes) : null;

  // Acesso determinado pelo gerenciamento de acesso ("Acesso por Usuário"):
  // - rota sem entrada em app_menu -> nunca foi migrada pro controle por
  //   perfil, continua sempre aberta;
  // - menu existe mas ninguém nunca configurou nada nele (nenhuma linha em
  //   perfil_acesso_permissao/screen_permission_user) -> aberto até alguém
  //   decidir algo lá (ver list_configured_menu_codes), EXCETO os menus em
  //   MENUS_SEMPRE_RESTRITOS (administração/integração — deliberadamente só
  //   concede_tudo, nunca "esquecido");
  // - menu configurado -> vale o resolvido por list_accessible_menus pra
  //   este usuário (perfil comum, concede_tudo ou exceção individual).
  const allowed =
    phaseFlagEnabled &&
    (ACESSO_ABERTO_SEM_PERMISSOES ||
      !access ||
      !menuCode ||
      (!access.configuredCodes.has(menuCode) && !MENUS_SEMPRE_RESTRITOS.has(menuCode)) ||
      access.codes.has(menuCode));

  useEffect(() => {
    if (isLoading || allowed) return;
    const key = `${pathname}|${menuCode}`;
    if (loggedRef.current === key) return;
    loggedRef.current = key;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      await supabase.from("access_audit_log").insert({
        user_id: u.user.id,
        menu_codigo: menuCode,
        rota: pathname,
        acao: "visualizar",
        allowed: false,
        motivo: !phaseFlagEnabled
          ? `route_guard_phase_flag_off:${phaseFlagged?.flag}`
          : "route_guard_block",
      });
    })();
  }, [isLoading, allowed, pathname, menuCode, phaseFlagEnabled, phaseFlagged]);

  // Só bloqueia o render na primeira carga (sem dados ainda). Com dados em
  // cache (staleTime 30s), mantém children montado entre navegações.
  if (!ACESSO_ABERTO_SEM_PERMISSOES && !access) return null;
  if (allowed) return <>{children}</>;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <ShieldAlert className="h-8 w-8 text-destructive" />
      </div>
      <h1 className="text-2xl font-semibold">Acesso negado</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Você não tem permissão para visualizar esta tela. Caso precise de acesso,
        solicite ao administrador em <strong>Configurações do ERP &gt; Acesso por Usuário</strong>.
      </p>
      <p className="text-xs text-muted-foreground">
        Tela: <code>{menuCode}</code> · Rota: <code>{pathname}</code>
      </p>
      <Button asChild>
        <Link to="/app/painel-executivo">Voltar ao início</Link>
      </Button>
    </div>
  );
}
