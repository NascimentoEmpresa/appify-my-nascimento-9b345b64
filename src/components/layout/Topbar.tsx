import { Bell, Search, PanelLeft, ChevronDown, Building2, HelpCircle, Settings, LogOut, ShieldAlert, Check, ExternalLink, User as UserIcon, Monitor, ShieldCheck, Contact } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useDemoMode } from "@/context/DemoModeContext";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AgendaCorporativaSheet } from "./AgendaCorporativaSheet";
import { resolverLinkNotificacao } from "@/lib/notificacaoLink";

type Notif = {
  id: string;
  titulo: string;
  mensagem: string | null;
  tipo: string;
  link: string | null;
  lida: boolean;
  created_at: string;
};

type Sessao = {
  id: string;
  user_agent: string | null;
  ip: string | null;
  iniciada_em: string;
  ultima_atividade: string;
  ativa: boolean;
};

export function Topbar({ onToggleSidebar, onOpenMobile }: { onToggleSidebar: () => void; onOpenMobile?: () => void }) {
  const { empresa, empresas, setEmpresa } = useEmpresaAtiva();
  const [openSelector, setOpenSelector] = useState(false);
  const [openNotif, setOpenNotif] = useState(false);
  const [openHelp, setOpenHelp] = useState(false);
  const [openSettings, setOpenSettings] = useState(false);
  const [openProfile, setOpenProfile] = useState(false);
  const [openAgenda, setOpenAgenda] = useState(false);
  const navigate = useNavigate();
  const { disableDemo } = useDemoMode();
  const { user, signOut } = useAuth();
  const { roles, can } = usePermissoes();
  const qc = useQueryClient();

  const isAdmin = can("alterar", undefined, "administracao");

  // Mesma chave que Meu Perfil usa: trocar a foto lá, ou importar a do
  // Discord, invalida ["meu-perfil"] — e o chip acompanha sem precisar de F5.
  // Com o useEffect solto que existia aqui a foto só mudava recarregando a
  // página, porque o Topbar fica montado a navegação inteira.
  const perfilQ = useQuery({
    queryKey: ["meu-perfil", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle();
      return data as Record<string, any> | null;
    },
  });
  const displayName = perfilQ.data?.display_name || perfilQ.data?.email || user?.email || "";
  const avatarUrl: string | null = perfilQ.data?.avatar_url ?? null;

  // Notificações
  const notifQ = useQuery({
    queryKey: ["notificacoes", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notificacoes" as any)
        .select("id,titulo,mensagem,tipo,link,lida,created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as Notif[];
    },
  });

  // Registra sessão ao montar (uma vez por user)
  useEffect(() => {
    if (!user?.id) return;
    const key = `gn:sess:${user.id}`;
    if (sessionStorage.getItem(key)) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("sessoes_ativas")
        .insert({ user_id: user.id, user_agent: navigator.userAgent })
        .select("id")
        .maybeSingle();
      if (data?.id) sessionStorage.setItem(key, data.id);
    })();
  }, [user?.id]);

  const sessoesQ = useQuery({
    queryKey: ["minhas-sessoes", user?.id],
    enabled: !!user?.id && openProfile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessoes_ativas" as any)
        .select("id,user_agent,ip,iniciada_em,ultima_atividade,ativa")
        .eq("user_id", user!.id)
        .order("iniciada_em", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as unknown as Sessao[];
    },
  });

  const naoLidas = useMemo(() => (notifQ.data ?? []).filter((n) => !n.lida).length, [notifQ.data]);

  const marcarLida = async (id: string) => {
    await supabase.from("notificacoes" as any).update({ lida: true } as any).eq("id", id);
    qc.invalidateQueries({ queryKey: ["notificacoes", user?.id] });
  };
  const marcarTodasLidas = async () => {
    await supabase.from("notificacoes" as any).update({ lida: true } as any).eq("user_id", user!.id).eq("lida", false);
    qc.invalidateQueries({ queryKey: ["notificacoes", user?.id] });
  };

  // Clicar na notificação leva para a tela do registro que a originou (o destino
  // vem de `notificacoes.link`, normalizado em resolverLinkNotificacao).
  const abrirNotificacao = (n: Notif) => {
    const destino = resolverLinkNotificacao(n);
    if (!n.lida) marcarLida(n.id);
    if (!destino) return;
    setOpenNotif(false);
    if (/^https?:\/\//i.test(destino)) window.open(destino, "_blank", "noopener");
    else navigate(destino);
  };

  const nomeExibido = displayName || user?.email?.split("@")[0] || "Usuário";
  const iniciais = nomeExibido.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "U";
  const roleLabel = isAdmin ? "Admin Master" : (roles?.[0] ? roles[0].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Usuário");

  const fecharTodos = () => { setOpenSelector(false); setOpenNotif(false); setOpenHelp(false); setOpenSettings(false); setOpenProfile(false); setOpenAgenda(false); };

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border/70 bg-surface/80 px-3 backdrop-blur-md sm:gap-4 sm:px-4 lg:px-6">
      {/* Hambúrguer: abre drawer no mobile, alterna colapso no desktop */}
      <button
        onClick={() => {
          if (typeof window !== "undefined" && window.innerWidth < 1024 && onOpenMobile) {
            onOpenMobile();
          } else {
            onToggleSidebar();
          }
        }}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
        aria-label="Alternar menu"
      >
        <PanelLeft className="h-4 w-4" />
      </button>

      {/* Empresa selector */}
      <div className="relative min-w-0">
        <button
          onClick={() => { fecharTodos(); setOpenSelector((o) => !o); }}
          className="flex max-w-[60vw] items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5 text-left shadow-sm transition-colors hover:border-border-strong sm:max-w-none sm:gap-2.5 sm:px-3"
        >
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
            <Building2 className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <p className="hidden text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:block">Empresa ativa</p>
            <p className="truncate text-xs font-semibold text-foreground">
              {empresa.sigla}
              <span className="hidden sm:inline"> · <span className="font-mono">{empresa.cnpj}</span></span>
            </p>
          </div>
          <span className="hidden rounded-md bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold text-primary md:inline-block">
            {empresa.regime}
          </span>
          {empresa.validacaoDocumentalObrigatoria && (
            <span className="hidden items-center gap-1 rounded-md bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning md:inline-flex" title="Validação documental obrigatória">
              <ShieldAlert className="h-3 w-3" />
              Validar
            </span>
          )}
          <ChevronDown className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block" />
        </button>

        {openSelector && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpenSelector(false)} />
            <div className="absolute left-0 top-full z-20 mt-2 w-96 overflow-hidden rounded-xl border border-border bg-popover shadow-xl animate-fade-in">
              <div className="border-b border-border bg-muted/40 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Empresas do Grupo Nascimento</p>
              </div>
              <ul className="max-h-96 overflow-y-auto py-1">
                {empresas.map((e) => (
                  <li key={e.id}>
                    <button
                      onClick={() => { setEmpresa(e.id); setOpenSelector(false); }}
                      className={cn(
                        "flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm hover:bg-secondary",
                        empresa.id === e.id && "bg-primary-soft",
                      )}
                    >
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary text-[11px] font-bold">
                        {e.sigla}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{e.razao}</p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">{e.cnpj}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{e.regime}</span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{e.papel}</span>
                          {e.validacaoDocumentalObrigatoria && (
                            <span className="inline-flex items-center gap-1 rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                              <ShieldAlert className="h-2.5 w-2.5" />
                              Validação documental
                            </span>
                          )}
                        </div>
                      </div>
                      {empresa.id === e.id && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>

      {/* Search */}
      <div className="relative ml-2 hidden flex-1 max-w-xl md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          placeholder="Buscar em todos os módulos · editais, contratos, lançamentos, fornecedores…"
          className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-16 text-sm shadow-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">⌘K</kbd>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        {/* Ajuda */}
        <div className="relative">
          <IconBtn aria-label="Ajuda" onClick={() => { fecharTodos(); setOpenHelp((o) => !o); }}><HelpCircle className="h-4 w-4" /></IconBtn>
          {openHelp && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpenHelp(false)} />
              <div className="absolute right-0 top-full z-20 mt-2 w-72 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
                <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold">Central de ajuda</div>
                <ul className="text-sm">
                  <MenuItem onClick={() => { setOpenHelp(false); navigate("/app"); }} icon={<ExternalLink className="h-3.5 w-3.5" />}>Tour da plataforma</MenuItem>
                  <MenuItem onClick={() => window.open("mailto:suporte@cheetahconsultores.com", "_blank")} icon={<ExternalLink className="h-3.5 w-3.5" />}>Falar com suporte</MenuItem>
                  <MenuItem onClick={() => { setOpenHelp(false); navigate("/app/historico"); }} icon={<ExternalLink className="h-3.5 w-3.5" />}>Histórico de ações</MenuItem>
                </ul>
              </div>
            </>
          )}
        </div>

        {/* Configurações */}
        <div className="relative">
          <IconBtn aria-label="Configurações" onClick={() => { fecharTodos(); setOpenSettings((o) => !o); }}><Settings className="h-4 w-4" /></IconBtn>
          {openSettings && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpenSettings(false)} />
              <div className="absolute right-0 top-full z-20 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
                <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold">Configurações</div>
                <ul className="text-sm">
                  <MenuItem onClick={() => { setOpenSettings(false); navigate("/app/administracao"); }} icon={<Settings className="h-3.5 w-3.5" />}>Administração</MenuItem>
                  <MenuItem onClick={() => { setOpenSettings(false); navigate("/app/controladoria/empresas"); }} icon={<Building2 className="h-3.5 w-3.5" />}>Empresas</MenuItem>
                  <MenuItem onClick={() => { setOpenSettings(false); navigate("/app/contabil/plano-contas"); }} icon={<Settings className="h-3.5 w-3.5" />}>Plano de contas</MenuItem>
                </ul>
              </div>
            </>
          )}
        </div>

        {/* Notificações */}
        <div className="relative">
          <IconBtn aria-label="Notificações" onClick={() => { fecharTodos(); setOpenNotif((o) => !o); }}>
            <Bell className="h-4 w-4" />
            {naoLidas > 0 && (
              <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold text-accent-foreground">
                {naoLidas > 9 ? "9+" : naoLidas}
              </span>
            )}
          </IconBtn>
          {openNotif && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpenNotif(false)} />
              <div className="absolute right-0 top-full z-20 mt-2 w-96 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
                <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
                  <p className="text-xs font-semibold">Notificações</p>
                  {naoLidas > 0 && (
                    <button onClick={marcarTodasLidas} className="text-[11px] font-medium text-primary hover:underline">
                      Marcar todas como lidas
                    </button>
                  )}
                </div>
                <ul className="max-h-96 divide-y divide-border overflow-y-auto">
                  {notifQ.isLoading && <li className="p-4 text-center text-xs text-muted-foreground">Carregando…</li>}
                  {!notifQ.isLoading && (notifQ.data ?? []).length === 0 && (
                    <li className="p-6 text-center text-xs text-muted-foreground">Nenhuma notificação.</li>
                  )}
                  {(notifQ.data ?? []).map((n) => {
                    const destino = resolverLinkNotificacao(n);
                    const conteudo = (
                      <>
                        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full",
                          n.tipo === "success" ? "bg-success" : n.tipo === "warning" ? "bg-warning" : n.tipo === "error" ? "bg-destructive" : "bg-primary")} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium leading-tight">{n.titulo}</p>
                          {n.mensagem && <p className="mt-0.5 text-xs text-muted-foreground">{n.mensagem}</p>}
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: ptBR })}
                          </p>
                        </div>
                      </>
                    );
                    return (
                      <li key={n.id} className={cn("flex items-start gap-1 pr-2 hover:bg-secondary/60", !n.lida && "bg-primary-soft/40")}>
                        {destino ? (
                          <button
                            type="button"
                            onClick={() => abrirNotificacao(n)}
                            title={`Abrir: ${n.titulo}`}
                            className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 px-3 py-2.5 text-left"
                          >
                            {conteudo}
                          </button>
                        ) : (
                          <div className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2.5">{conteudo}</div>
                        )}
                        {!n.lida && (
                          <button onClick={() => marcarLida(n.id)} className="mt-2.5 grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted" title="Marcar como lida">
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          )}
        </div>

        {/* Agenda Corporativa */}
        <IconBtn aria-label="Agenda Corporativa" onClick={() => { fecharTodos(); setOpenAgenda((o) => !o); }}>
          <Contact className="h-4 w-4" />
        </IconBtn>

        <div className="mx-1 h-8 w-px bg-border" />

        {/* Perfil/Sessões */}
        <div className="relative">
          <button
            onClick={() => { fecharTodos(); setOpenProfile((o) => !o); }}
            className="flex items-center gap-2.5 rounded-lg px-2 py-1 hover:bg-secondary" title={user?.email ?? ""}
          >
            {/* A foto do perfil, quando existe. Sem ela ficam as iniciais, que
                era o único estado possível antes — o chip nunca chegou a
                mostrar avatar, nem para quem já tinha um em profiles. */}
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
            ) : (
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-primary text-sm font-semibold text-primary-foreground">
                {iniciais}
              </div>
            )}
            <div className="hidden text-left lg:block">
              <p className="text-xs font-semibold leading-tight">{nomeExibido}</p>
              <p className="text-[10px] text-muted-foreground">
                {roleLabel}{!isAdmin && ` · ${empresa.sigla}`}
              </p>
            </div>
            <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground lg:block" />
          </button>
          {openProfile && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpenProfile(false)} />
              <div className="absolute right-0 top-full z-20 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
                <div className="border-b border-border bg-muted/40 px-3 py-3">
                  <p className="text-sm font-semibold">{nomeExibido}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{user?.email}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {(roles ?? []).map((r) => (
                      <span key={r} className="inline-flex items-center gap-1 rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        {r === "admin" && <ShieldCheck className="h-2.5 w-2.5" />}
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
                <ul className="text-sm">
                  <MenuItem onClick={() => { setOpenProfile(false); navigate("/app/meu-perfil"); }} icon={<UserIcon className="h-3.5 w-3.5" />}>Meu perfil</MenuItem>
                  <MenuItem onClick={() => { setOpenProfile(false); navigate("/app/administracao"); }} icon={<ShieldCheck className="h-3.5 w-3.5" />}>Administração / Usuários</MenuItem>
                </ul>
                <div className="border-t border-border bg-muted/20 px-3 py-2">
                  <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Monitor className="h-3 w-3" /> Sessões ativas
                  </p>
                  <ul className="max-h-40 space-y-1 overflow-y-auto">
                    {sessoesQ.isLoading && <li className="text-[11px] text-muted-foreground">Carregando…</li>}
                    {!sessoesQ.isLoading && (sessoesQ.data ?? []).length === 0 && (
                      <li className="text-[11px] text-muted-foreground">Nenhuma sessão registrada.</li>
                    )}
                    {(sessoesQ.data ?? []).map((s) => (
                      <li key={s.id} className="rounded border border-border bg-card px-2 py-1.5">
                        <p className="truncate text-[11px] font-medium" title={s.user_agent ?? ""}>
                          {(s.user_agent ?? "Desconhecido").split(" ").slice(0, 4).join(" ")}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(s.iniciada_em), { addSuffix: true, locale: ptBR })}
                          {s.ativa && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-success" />}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>

        <button
          onClick={async () => { await signOut(); disableDemo(); navigate("/login"); }}
          className="ml-1 flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:border-destructive/40 hover:bg-destructive-soft hover:text-destructive"
          aria-label="Sair"
          title="Sair da plataforma"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Sair</span>
        </button>
      </div>

      <AgendaCorporativaSheet open={openAgenda} onOpenChange={setOpenAgenda} userId={user?.id} />
    </header>
  );
}

function IconBtn({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="relative grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
    >
      {children}
    </button>
  );
}

function MenuItem({ children, icon, onClick }: { children: React.ReactNode; icon?: React.ReactNode; onClick?: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary">
        {icon}
        <span className="flex-1">{children}</span>
      </button>
    </li>
  );
}
