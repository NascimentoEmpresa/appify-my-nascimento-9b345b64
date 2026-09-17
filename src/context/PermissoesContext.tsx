// Arquivo: src/context/PermissoesContext.tsx
// FASE 2 / FRONT-END — redesenho do gerenciamento de acessos.
// Cargo (role) é 100% descritivo agora — carregado só pra exibição, nunca
// usado pra decidir acesso. `can()` resolve por: exceção individual
// (screen_permission_user) > perfil de acesso atribuído (usuario_perfil_acesso
// + perfil_acesso_permissao, com "concede_tudo" liberando tudo) > nega.
// O banco continua sendo a autoridade final via RLS/can_access/has_screen_access
// — isto aqui é só heurística de UI (esconder botão), nunca a proteção real.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDemoMode } from "@/context/DemoModeContext";

export type Role =
  | "admin"
  | "controladoria"
  | "comercial"
  | "operacional"
  | "juridico"
  | "sst"
  | "diretor_adm"
  | "diretor_op"
  | "presidencia"
  | "usuario"
  | "visitante"
  | "comprador"
  | "almoxarife"
  | "gestor_cc"
  | "fiscal_recebedor"
  | "financeiro"
  | "fiscal"
  | "rh"
  | "sistemas"
  | "treinamentos";

export type Acao =
  | "visualizar"
  | "incluir"
  | "alterar"
  | "excluir"
  | "aprovar"
  | "exportar"
  | "executar_ia"
  | "responder";

interface UserOverride {
  menu: string;
  acao: Acao;
  allow: boolean;
}

interface PerfilPermission {
  menu: string;
  acao: Acao;
  allow: boolean;
}

interface PermissoesCtx {
  role: Role;
  roles: Role[];
  empresaId: string | null;
  loading: boolean;
  can: (acao: Acao, modulo?: string, menu?: string) => boolean;
  setRole: (role: Role) => void;
}

const Ctx = createContext<PermissoesCtx | null>(null);

function findOverride(overrides: UserOverride[], acao: Acao, menu?: string): UserOverride | null {
  if (!menu) return null;
  return overrides.find((item) => item.menu === menu && item.acao === acao) ?? null;
}

function hasPerfilPermission(permissoes: PerfilPermission[], acao: Acao, menu?: string): boolean {
  if (!menu) return false;
  return permissoes.some((permission) => permission.menu === menu && permission.acao === acao && permission.allow === true);
}

export function PermissoesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { isDemo } = useDemoMode();

  const [roles, setRoles] = useState<Role[]>([]);
  const [userOverrides, setUserOverrides] = useState<UserOverride[]>([]);
  const [perfilPermissoes, setPerfilPermissoes] = useState<PerfilPermission[]>([]);
  const [concedeTudo, setConcedeTudo] = useState(false);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [demoRole, setDemoRole] = useState<Role>(() => {
    if (typeof window === "undefined") return "admin";
    return ((localStorage.getItem("gn:role") as Role) ?? "admin");
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);

      if (!user) {
        if (!cancelled) {
          setRoles(isDemo ? [demoRole] : []);
          setUserOverrides([]);
          setPerfilPermissoes([]);
          setConcedeTudo(false);
          setEmpresaId(null);
          setLoading(false);
        }
        return;
      }

      const { data: rolesData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);

      // Cargo é só exibição (badge no perfil, filtro de UI) — nunca gate de acesso.
      const userRoles = ((rolesData ?? []).map((item) => item.role)) as Role[];

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id, empresa_atual_id")
        .eq("id", user.id)
        .maybeSingle();

      const activeEmpresaId = profile?.empresa_atual_id ?? profile?.empresa_id ?? null;

      const [overridesRes, perfisRes] = await Promise.all([
        supabase
          .from("screen_permission_user")
          .select("menu_codigo, acao, allow")
          .eq("user_id", user.id),
        (supabase as any)
          .from("usuario_perfil_acesso")
          .select("perfil_acesso(id, ativo, concede_tudo)")
          .eq("user_id", user.id),
      ]);

      const perfisAtivos = ((perfisRes.data ?? []) as any[])
        .map((r) => r.perfil_acesso)
        .filter((p) => p?.ativo);
      const jaConcedeTudo = perfisAtivos.some((p) => p.concede_tudo);
      const perfilIds = perfisAtivos.map((p) => p.id as string);

      const permissaoRes = perfilIds.length
        ? await (supabase as any).from("perfil_acesso_permissao").select("menu_codigo, acao, allow").in("perfil_id", perfilIds)
        : { data: [] as any[] };

      if (!cancelled) {
        setRoles(userRoles.length ? userRoles : ["usuario" as Role]);
        setEmpresaId(activeEmpresaId);
        setUserOverrides(
          (overridesRes.data ?? []).map((permission: any) => ({
            menu: permission.menu_codigo,
            acao: permission.acao as Acao,
            allow: Boolean(permission.allow),
          })),
        );
        setConcedeTudo(jaConcedeTudo);
        setPerfilPermissoes(
          (permissaoRes.data ?? []).map((permission: any) => ({
            menu: permission.menu_codigo,
            acao: permission.acao as Acao,
            allow: Boolean(permission.allow),
          })),
        );
        setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isDemo, demoRole]);

  const value = useMemo<PermissoesCtx>(() => ({
    role: roles[0] ?? "usuario",
    roles,
    empresaId,
    loading,
    setRole: (nextRole) => {
      setDemoRole(nextRole);
      try {
        localStorage.setItem("gn:role", nextRole);
      } catch {
        return;
      }
    },
    can: (acao, _modulo, menu) => {
      if (!user && isDemo) {
        if (demoRole === "admin") return true;
        if (demoRole === "usuario" || demoRole === "visitante") return acao === "visualizar";
        return acao === "visualizar" || acao === "exportar";
      }

      const override = findOverride(userOverrides, acao, menu);
      if (override) return override.allow;

      if (concedeTudo) return true;
      if (hasPerfilPermission(perfilPermissoes, acao, menu)) return true;

      return false;
    },
  }), [concedeTudo, demoRole, empresaId, isDemo, loading, perfilPermissoes, roles, user, userOverrides]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePermissoes() {
  const context = useContext(Ctx);
  if (!context) throw new Error("usePermissoes deve ser usado dentro de PermissoesProvider");
  return context;
}
