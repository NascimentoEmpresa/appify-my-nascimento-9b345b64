import { ReactNode, useEffect, useRef } from "react";
import { useLocation, Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAccessibleMenus, matchMenuCode } from "@/hooks/useAccessibleMenus";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useFeatureFlag } from "@/lib/featureFlags";
import { ACESSO_ABERTO_SEM_PERMISSOES, rotaSempreLiberada } from "@/lib/acesso";
import { useModoExterno, rotaPermitidaExterno } from "@/hooks/useModoExterno";

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

  // Encarregado externo: allowlist estrita, avaliada ANTES de qualquer outra
  // regra. Ele não tem perfil de acesso nenhum, então cairia no ramo "menu
  // ainda não configurado → aberto" e enxergaria telas internas. Este ramo
  // só restringe: nunca libera nada que as regras abaixo negariam.
  const externo = useModoExterno();

  // NEGA POR PADRÃO. Regra atual, em uma frase: só passa quem tem permissão
  // explícita para uma tela cadastrada e ativa.
  //
  // - rota em ROTAS_SEMPRE_LIBERADAS -> passa (próprio perfil, abrir chamado).
  //   Sem isso, usuário novo não teria como nem pedir acesso;
  // - rota sem entrada em app_menu -> NEGA. Antes era liberada ("não migrada
  //   pro controle por perfil"), o que publicava toda tela nova que alguém
  //   esquecesse de cadastrar;
  // - menu INATIVO -> NEGA. Antes o menu inativo era filtrado antes do
  //   casamento, a rota virava "não cadastrada" e ficava ABERTA: desativar um
  //   menu no Catálogo publicava a tela em vez de fechá-la;
  // - menu ativo e cadastrado -> vale o que list_accessible_menus resolveu
  //   para este usuário (perfil comum, concede_tudo ou exceção individual).
  //   Não existe mais o ramo "ninguém configurou nada ainda => aberto"; com os
  //   20 perfis de módulo populados (20260906000001), quem trabalha já tem
  //   permissão, e quem não tem deve receber pelo painel — não por omissão.
  const allowed = externo
    ? rotaPermitidaExterno(pathname)
    : phaseFlagEnabled &&
      (ACESSO_ABERTO_SEM_PERMISSOES ||
        rotaSempreLiberada(pathname) ||
        (!!access &&
          !!menuCode &&
          !access.inactiveCodes.has(menuCode) &&
          access.codes.has(menuCode)));

  useEffect(() => {
    // Externo não tem grant em access_audit_log e o bloqueio dele não é um
    // evento de permissão a auditar — é a allowlist funcionando.
    if (isLoading || allowed || externo) return;
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
  }, [isLoading, allowed, externo, pathname, menuCode, phaseFlagEnabled, phaseFlagged]);

  // Só bloqueia o render na primeira carga (sem dados ainda). Com dados em
  // cache (staleTime 30s), mantém children montado entre navegações.
  // Externo não depende de list_accessible_menus — a decisão dele é a
  // allowlist, então esperar essa query só atrasaria a tela.
  if (!externo && !ACESSO_ABERTO_SEM_PERMISSOES && !access) return null;
  if (allowed) return <>{children}</>;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <ShieldAlert className="h-8 w-8 text-destructive" />
      </div>
      <h1 className="text-2xl font-semibold">Acesso negado</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {externo ? (
          <>Esta área não faz parte do acesso externo. Você pode solicitar materiais e acompanhar seus pedidos.</>
        ) : (
          <>
            Você não tem permissão para visualizar esta tela. Caso precise de acesso,
            solicite ao administrador em <strong>Configurações do ERP &gt; Acesso por Usuário</strong>.
          </>
        )}
      </p>
      {!externo && (
        <p className="text-xs text-muted-foreground">
          Tela: <code>{menuCode}</code> · Rota: <code>{pathname}</code>
        </p>
      )}
      <Button asChild>
        <Link to={externo ? "/app/encarregados/solicitar-materiais" : "/app/painel-executivo"}>
          Voltar ao início
        </Link>
      </Button>
    </div>
  );
}
