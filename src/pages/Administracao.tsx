import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Users, GitBranch, ShieldCheck, Building2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { UsuariosReal } from "@/components/admin/UsuariosReal";
import { ModulosMenusTab } from "@/pages/admin/tabs/ModulosMenusTab";
import { AlcadasTab } from "@/pages/admin/tabs/AlcadasTab";
import { AuditoriaTab } from "@/pages/admin/tabs/AuditoriaTab";
import { SetoresTab } from "@/pages/admin/tabs/SetoresTab";
import PlanoAcoesConfiguracoes from "@/pages/plano-acoes/Configuracoes";
import { ChevronRight } from "lucide-react";

type Tab = "usuarios" | "setores" | "modulos" | "alcadas" | "auditoria" | "plano-acoes-acl";

const VALID_TABS: Tab[] = ["usuarios", "setores", "modulos", "alcadas", "auditoria", "plano-acoes-acl"];

const tabs: { id: Tab; label: string; icon: any }[] = [
  { id: "usuarios", label: "Usuários", icon: Users },
  { id: "setores", label: "Setores", icon: Building2 },
  { id: "modulos", label: "Módulos & Menus", icon: GitBranch },
  { id: "alcadas", label: "Alçadas de aprovação", icon: GitBranch },
  { id: "auditoria", label: "Auditoria sensível", icon: ShieldCheck },
];

function normalizeTab(raw: string | null): Tab {
  if (raw && (VALID_TABS as string[]).includes(raw)) return raw as Tab;
  return "modulos";
}

export default function Administracao() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(normalizeTab(searchParams.get("tab")));

  useEffect(() => {
    const next = normalizeTab(searchParams.get("tab"));
    if (next !== tab) setTab(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const changeTab = (nextTab: Tab) => {
    setTab(nextTab);
    setSearchParams({ tab: nextTab }, { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações do ERP"
        breadcrumb={["Administração"]}
        subtitle="Governança, segurança e configuração institucional do ERP."
      />

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-3 self-start sticky top-4">
          <nav className="card-elevated p-2">
            {tabs.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => changeTab(item.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors",
                    tab === item.id
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-secondary",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="flex-1">{item.label}</span>
                  {tab === item.id && <ChevronRight className="h-4 w-4" />}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="space-y-5">
          {tab === "usuarios" && <UsuariosReal />}
          {tab === "setores" && <SetoresTab />}
          {tab === "modulos" && <ModulosMenusTab />}
          {tab === "plano-acoes-acl" && <PlanoAcoesConfiguracoes bypassGuard />}
          {tab === "alcadas" && <AlcadasTab />}
          {tab === "auditoria" && <AuditoriaTab />}
        </div>
      </div>
    </div>
  );
}
