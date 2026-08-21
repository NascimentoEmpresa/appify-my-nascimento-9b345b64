import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { DemoBanner } from "./DemoBanner";
import { ChamadoFab } from "@/components/chamados/ChamadoFab";
import { RouteGuard } from "@/components/auth/RouteGuard";
import { VinculoGate } from "@/components/auth/VinculoEmpregado";
import { VinculoDiscordGate } from "@/components/auth/VinculoDiscordGate";
import { useModoExterno } from "@/hooks/useModoExterno";

export function AppShell() {
  // Encarregado externo (sessão anônima) não tem cadastro em EMPREGADOS para
  // vincular nem abre chamado de sistemas — os dois gates só atrapalhariam.
  const externo = useModoExterno();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const desktopSidebarWidth = collapsed ? "172px" : "268px";

  // Fecha drawer mobile ao mudar de rota
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // ESC fecha drawer mobile
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  return (
    <div className="flex min-h-screen w-full max-w-full bg-background">
      {/* Overlay mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden animate-fade-in"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar collapsed={collapsed} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

      <div
        style={{ "--desktop-sidebar-width": desktopSidebarWidth } as React.CSSProperties}
        className="flex min-w-0 flex-1 flex-col overflow-x-hidden transition-[margin,width] duration-300 lg:ml-[var(--desktop-sidebar-width)] lg:w-[calc(100%_-_var(--desktop-sidebar-width))] lg:flex-none"
      >
        <DemoBanner />
        <Topbar onToggleSidebar={() => setCollapsed((c) => !c)} onOpenMobile={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-x-hidden p-4 sm:p-6 lg:p-8 min-w-0">
          <RouteGuard>
            {/* A `key` no pathname é o que faz a animação TOCAR A CADA
                navegação. Antes o `animate-fade-in` vivia no <main>, que não
                remonta ao trocar de rota — a entrada só acontecia no primeiro
                carregamento da sessão e nunca mais.

                O `sh-entra` anima com `transform`, e `transform` num ancestral
                vira containing block do `position: fixed` dos filhos. Telas de
                tela-cheia (painel TV, `fixed inset-0`) ficariam presas na área
                de conteúdo em vez de cobrir a tela — no desktop o transform
                acaba em 0,26s e libera, mas em navegador de Smart TV ele não
                solta e o painel fica preto. Por isso a rota TV NÃO usa o
                wrapper animado. */}
            {location.pathname === "/app/painel-executivo/tv" ? (
              <Outlet />
            ) : (
              <div key={location.pathname} className="sh-entra">
                <Outlet />
              </div>
            )}
          </RouteGuard>
        </main>
      </div>
      {!externo && <ChamadoFab />}
      {!externo && <VinculoGate />}
      {/* Entra depois do VinculoGate de propósito: ele só aparece quando o
          vínculo Senior já está resolvido, para não empilhar dois modais. */}
      {!externo && <VinculoDiscordGate />}
    </div>
  );
}
