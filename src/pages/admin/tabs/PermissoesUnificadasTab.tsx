// Arquivo: src/pages/admin/tabs/PermissoesUnificadasTab.tsx
// FASE 2 / FRONT-END
// Nova tela única: Perfil + Ações + Menu/Rota + Overrides individuais.
// Salva perfil em role_permissions e sincroniza Visualizar com screen_permission_profile.
// Salva exceções individuais em screen_permission_user para todas as ações.

import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePermissoes } from "@/context/PermissoesContext";
import type { Database } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Layers,
  Loader2,
  Shield,
  User,
} from "lucide-react";

type Role = Database["public"]["Enums"]["app_role"];
type Acao = Database["public"]["Enums"]["app_acao"];

const ACOES: Acao[] = ["visualizar", "incluir", "alterar", "excluir", "aprovar", "exportar", "executar_ia"];

interface PerfilRow {
  role: Role;
  descricao: string | null;
}

interface ModuloRow {
  id: string;
  codigo: string;
  nome: string;
  ordem: number;
}

interface MenuRow {
  id: string;
  modulo_id: string;
  modulo_codigo: string;
  codigo: string;
  nome: string;
  rota: string | null;
  ordem: number;
}

interface RolePermissionRow {
  id?: string;
  role: Role;
  modulo: string;
  menu_codigo: string | null;
  acao: Acao;
}

interface UserOption {
  id: string;
  nome: string;
  email: string | null;
}

interface UserOverrideRow {
  id?: string;
  user_id: string;
  menu_codigo: string;
  acao: Acao;
  allow: boolean;
  empresa_id: string | null;
}

interface PendingProfileChange {
  role: Role;
  modulo: string;
  menu_codigo: string | null;
  acao: Acao;
  allow: boolean;
}

interface PendingUserChange {
  user_id: string;
  menu_codigo: string;
  acao: Acao;
  allow: boolean | null;
  empresa_id: string | null;
}

function permissionKey(modulo: string, menu: string | null, acao: Acao): string {
  return `${modulo}::${menu ?? ""}::${acao}`;
}

function userPermissionKey(userId: string, menu: string, acao: Acao, empresaId: string | null): string {
  return `${userId}::${menu}::${acao}::${empresaId ?? ""}`;
}

async function invalidatePermissionCaches(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["role_permissions"] }),
    queryClient.invalidateQueries({ queryKey: ["screen_permission_profile"] }),
    queryClient.invalidateQueries({ queryKey: ["screen_permission_user"] }),
    queryClient.invalidateQueries({ queryKey: ["screen-access"] }),
    queryClient.invalidateQueries({ queryKey: ["accessible-menus"] }),
    queryClient.invalidateQueries({ queryKey: ["perfil_metadata"] }),
    queryClient.invalidateQueries({ queryKey: ["user_roles"] }),
  ]);
}

export function PermissoesUnificadasTab() {
  return (
    <section className="space-y-4">
      <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
        <strong>Gestão unificada de permissões.</strong>{" "}
        A ação <strong>Visualizar</strong> libera a tela no menu e na rota. As demais ações controlam o que o usuário pode fazer dentro da tela.
        Exceções individuais são salvas sem criar novos perfis.
      </div>

      <Tabs defaultValue="perfil" className="space-y-4">
        <TabsList>
          <TabsTrigger value="perfil">
            <Shield className="mr-2 h-4 w-4" />
            Permissões por perfil
          </TabsTrigger>
          <TabsTrigger value="pessoa">
            <User className="mr-2 h-4 w-4" />
            Exceções individuais
          </TabsTrigger>
        </TabsList>
        <TabsContent value="perfil">
          <PermissoesPorPerfil />
        </TabsContent>
        <TabsContent value="pessoa">
          <OverridesPorPessoa />
        </TabsContent>
      </Tabs>
    </section>
  );
}

function useCatalogoPermissoes() {
  return useQuery({
    queryKey: ["catalogo-permissoes-unificado"],
    queryFn: async () => {
      const [{ data: modulos, error: modulosError }, { data: menus, error: menusError }] = await Promise.all([
        supabase
          .from("app_modulo")
          .select("id,codigo,nome,ordem")
          .order("ordem", { ascending: true }),
        supabase
          .from("app_menu")
          .select("id,modulo_id,codigo,nome,rota,ordem")
          .order("ordem", { ascending: true }),
      ]);

      if (modulosError) throw modulosError;
      if (menusError) throw menusError;

      const moduleRows = (modulos ?? []) as ModuloRow[];
      const moduleById = new Map(moduleRows.map((modulo) => [modulo.id, modulo]));

      const menuRows = ((menus ?? []) as Array<Omit<MenuRow, "modulo_codigo">>).map((menu) => ({
        ...menu,
        modulo_codigo: moduleById.get(menu.modulo_id)?.codigo ?? "",
      }));

      return {
        modulos: moduleRows,
        menus: menuRows,
      };
    },
  });
}

function usePerfis() {
  return useQuery({
    queryKey: ["perfil_metadata"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("perfil_metadata")
        .select("role,descricao")
        .order("role", { ascending: true });

      if (error) throw error;

      return ((data ?? []) as PerfilRow[]).filter((row) => row.role !== "visitante");
    },
  });
}

function useUsuarios() {
  return useQuery({
    queryKey: ["usuarios-permissoes-unificadas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,display_name,email")
        .order("display_name", { ascending: true });

      if (error) throw error;

      return (data ?? []).map((user: any) => ({
        id: user.id,
        nome: user.display_name || user.email || user.id,
        email: user.email ?? null,
      })) as UserOption[];
    },
  });
}

function PermissoesPorPerfil() {
  const queryClient = useQueryClient();
  const { can } = usePermissoes();
  const podeGerenciar = can("alterar", undefined, "administracao");
  const catalogoQ = useCatalogoPermissoes();
  const perfisQ = usePerfis();

  const [perfil, setPerfil] = useState<Role>("controladoria");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filtroModulo, setFiltroModulo] = useState<string>("all");
  const [busca, setBusca] = useState("");
  const [pending, setPending] = useState<Map<string, PendingProfileChange>>(new Map());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!perfisQ.data?.length) return;
    if (!perfisQ.data.some((item) => item.role === perfil)) {
      setPerfil(perfisQ.data[0].role);
    }
  }, [perfil, perfisQ.data]);

  const permissoesQ = useQuery({
    queryKey: ["role_permissions", perfil],
    enabled: !!perfil,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_permissions")
        .select("id,role,modulo,menu_codigo,acao")
        .eq("role", perfil);

      if (error) throw error;

      return (data ?? []) as RolePermissionRow[];
    },
  });

  const baseSet = useMemo(() => {
    const result = new Set<string>();
    (permissoesQ.data ?? []).forEach((permission) => {
      result.add(permissionKey(permission.modulo, permission.menu_codigo, permission.acao));
    });
    return result;
  }, [permissoesQ.data]);

  const effectiveSet = useMemo(() => {
    const result = new Set(baseSet);
    pending.forEach((change, key) => {
      if (change.allow) result.add(key);
      else result.delete(key);
    });
    return result;
  }, [baseSet, pending]);

  const menusByModulo = useMemo(() => {
    const result = new Map<string, MenuRow[]>();
    (catalogoQ.data?.menus ?? []).forEach((menu) => {
      const list = result.get(menu.modulo_id) ?? [];
      list.push(menu);
      result.set(menu.modulo_id, list);
    });
    return result;
  }, [catalogoQ.data?.menus]);

  const modulosFiltrados = useMemo(() => {
    let modulos = catalogoQ.data?.modulos ?? [];

    if (filtroModulo !== "all") {
      modulos = modulos.filter((modulo) => modulo.id === filtroModulo);
    }

    if (busca.trim()) {
      const term = busca.trim().toLowerCase();
      const menusMatching = new Set(
        (catalogoQ.data?.menus ?? [])
          .filter((menu) =>
            menu.nome.toLowerCase().includes(term) ||
            menu.codigo.toLowerCase().includes(term) ||
            (menu.rota ?? "").toLowerCase().includes(term),
          )
          .map((menu) => menu.modulo_id),
      );

      modulos = modulos.filter((modulo) =>
        modulo.nome.toLowerCase().includes(term) ||
        modulo.codigo.toLowerCase().includes(term) ||
        menusMatching.has(modulo.id),
      );
    }

    return modulos;
  }, [busca, catalogoQ.data?.menus, catalogoQ.data?.modulos, filtroModulo]);

  const isChecked = (modulo: string, menu: string | null, acao: Acao) => {
    return effectiveSet.has(permissionKey(modulo, menu, acao));
  };

  const toggle = (modulo: string, menu: string | null, acao: Acao) => {
    if (!podeGerenciar) return;

    const key = permissionKey(modulo, menu, acao);
    const currentlyChecked = isChecked(modulo, menu, acao);
    const nextPending = new Map(pending);

    nextPending.set(key, {
      role: perfil,
      modulo,
      menu_codigo: menu,
      acao,
      allow: !currentlyChecked,
    });

    if (baseSet.has(key) === !currentlyChecked) {
      nextPending.delete(key);
    }

    setPending(nextPending);
  };

  const toggleExpand = (moduloCodigo: string) => {
    const next = new Set(expanded);
    if (next.has(moduloCodigo)) next.delete(moduloCodigo);
    else next.add(moduloCodigo);
    setExpanded(next);
  };

  const insertRolePermissionIfMissing = async (change: PendingProfileChange) => {
    let existingQuery = supabase
      .from("role_permissions")
      .select("id")
      .eq("role", change.role)
      .eq("modulo", change.modulo)
      .eq("acao", change.acao);

    existingQuery = change.menu_codigo === null
      ? existingQuery.is("menu_codigo", null)
      : existingQuery.eq("menu_codigo", change.menu_codigo);

    const { data: existing, error: existingError } = await existingQuery.maybeSingle();
    if (existingError) throw existingError;
    if (existing) return;

    const { error } = await supabase
      .from("role_permissions")
      .insert({
        role: change.role,
        modulo: change.modulo,
        menu_codigo: change.menu_codigo,
        acao: change.acao,
      });

    if (error) throw error;
  };

  const deleteRolePermissionIfExists = async (change: PendingProfileChange) => {
    let deleteQuery = supabase
      .from("role_permissions")
      .delete()
      .eq("role", change.role)
      .eq("modulo", change.modulo)
      .eq("acao", change.acao);

    deleteQuery = change.menu_codigo === null
      ? deleteQuery.is("menu_codigo", null)
      : deleteQuery.eq("menu_codigo", change.menu_codigo);

    const { error } = await deleteQuery;
    if (error) throw error;
  };

  const syncVisualizarWithScreenProfile = async (change: PendingProfileChange) => {
    if (change.acao !== "visualizar" || change.menu_codigo === null) return;

    const { error } = await supabase
      .from("screen_permission_profile")
      .upsert({
        role: change.role,
        menu_codigo: change.menu_codigo,
        acao: "visualizar",
        allow: change.allow,
      }, { onConflict: "role,menu_codigo,acao" });

    if (error) throw error;
  };

  const salvar = async () => {
    if (!podeGerenciar || pending.size === 0) return;
    setSaving(true);

    const changes = Array.from(pending.values());

    try {
      for (const change of changes) {
        if (change.allow) {
          await insertRolePermissionIfMissing(change);
        } else {
          await deleteRolePermissionIfExists(change);
        }

        await syncVisualizarWithScreenProfile(change);
      }

      toast({
        title: "Permissões salvas",
        description: `${changes.length} alteração(ões) aplicada(s). Visualizar foi sincronizado com menu/rota.`,
      });

      setPending(new Map());
      await invalidatePermissionCaches(queryClient);
      await permissoesQ.refetch();
    } catch (error: any) {
      toast({
        title: "Erro ao salvar permissões",
        description: error?.message ?? "Falha inesperada.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card-elevated">
      <header className="flex flex-col gap-3 border-b border-border px-5 py-3.5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h2 className="font-display text-sm font-bold">Matriz unificada por perfil</h2>
          <p className="text-xs text-muted-foreground">
            Marque <strong>Visualizar</strong> para liberar menu/rota. Marque as demais ações para liberar operações dentro da tela.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Select value={perfil} onValueChange={(value) => { setPerfil(value as Role); setPending(new Map()); }}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Perfil" />
            </SelectTrigger>
            <SelectContent>
              {(perfisQ.data ?? []).map((item) => (
                <SelectItem key={item.role} value={item.role}>
                  {item.descricao || item.role.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filtroModulo} onValueChange={setFiltroModulo}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Módulo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os módulos</SelectItem>
              {(catalogoQ.data?.modulos ?? []).map((modulo) => (
                <SelectItem key={modulo.id} value={modulo.id}>
                  {modulo.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar tela, rota ou código"
            className="w-64"
          />
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 bg-muted/40 px-5 py-3 text-left">Módulo / Tela</th>
              {ACOES.map((acao) => (
                <th key={acao} className="px-2 py-3 text-center capitalize">
                  {acao.replace("_", " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {modulosFiltrados.map((modulo) => {
              const menus = menusByModulo.get(modulo.id) ?? [];
              const isOpen = expanded.has(modulo.codigo) || busca.trim().length > 0;
              return (
                <Fragment key={modulo.id}>
                  <tr className="bg-muted/20 hover:bg-muted/40">
                    <td className="sticky left-0 z-10 bg-muted/20 px-5 py-3">
                      <button
                        type="button"
                        onClick={() => toggleExpand(modulo.codigo)}
                        className="flex items-center gap-2 text-left text-sm font-semibold"
                      >
                        {menus.length > 0 ? (
                          isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
                        ) : <span className="w-3.5" />}
                        <Layers className="h-3.5 w-3.5 text-primary" />
                        {modulo.nome}
                        <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                          ({menus.length} telas)
                        </span>
                      </button>
                    </td>
                    {ACOES.map((acao) => (
                      <td key={acao} className="px-2 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked(modulo.codigo, null, acao)}
                          onChange={() => toggle(modulo.codigo, null, acao)}
                          disabled={!podeGerenciar || saving}
                          className="h-4 w-4 rounded border-border accent-primary"
                          title={`${acao} no módulo inteiro`}
                        />
                      </td>
                    ))}
                  </tr>

                  {isOpen && menus.map((menu) => (
                    <tr key={menu.id} className="hover:bg-muted/30">
                      <td className="sticky left-0 z-10 bg-background px-5 py-2 pl-12">
                        <span className="flex items-center gap-2 text-xs">
                          <FileText className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium">{menu.nome}</span>
                          <code className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                            {menu.codigo}
                          </code>
                          {menu.rota && (
                            <code className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                              {menu.rota}
                            </code>
                          )}
                        </span>
                      </td>
                      {ACOES.map((acao) => (
                        <td key={acao} className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={isChecked(menu.modulo_codigo, menu.codigo, acao)}
                            onChange={() => toggle(menu.modulo_codigo, menu.codigo, acao)}
                            disabled={!podeGerenciar || saving}
                            className="h-4 w-4 rounded border-border accent-primary"
                            title={`${acao} em ${menu.nome}`}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-border bg-muted/30 px-5 py-3 text-xs">
        <p className="text-muted-foreground">
          {pending.size} alteração(ões) pendente(s). A RLS no banco continuará sendo a autoridade final.
        </p>
        <Button size="sm" onClick={salvar} disabled={!podeGerenciar || pending.size === 0 || saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Salvar matriz
        </Button>
      </div>
    </section>
  );
}

function OverridesPorPessoa() {
  const queryClient = useQueryClient();
  const { can } = usePermissoes();
  const podeGerenciar = can("alterar", undefined, "administracao");
  const catalogoQ = useCatalogoPermissoes();
  const usuariosQ = useUsuarios();

  const [userId, setUserId] = useState("");
  const [filtroModulo, setFiltroModulo] = useState("all");
  const [busca, setBusca] = useState("");
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Map<string, PendingUserChange>>(new Map());

  const userRolesQ = useQuery({
    queryKey: ["user_roles", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);

      if (error) throw error;

      return (data ?? []).map((row: any) => row.role as Role);
    },
  });

  const rolePermsQ = useQuery({
    queryKey: ["role_permissions", "user-inherited", userRolesQ.data?.join(",")],
    enabled: !!userRolesQ.data?.length,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_permissions")
        .select("role,modulo,menu_codigo,acao")
        .in("role", userRolesQ.data as Role[]);

      if (error) throw error;

      return (data ?? []) as RolePermissionRow[];
    },
  });

  const overridesQ = useQuery({
    queryKey: ["screen_permission_user", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("screen_permission_user")
        .select("id,user_id,menu_codigo,acao,allow,empresa_id")
        .eq("user_id", userId)
        .is("empresa_id", null);

      if (error) throw error;

      return (data ?? []) as UserOverrideRow[];
    },
  });

  const menusByModulo = useMemo(() => {
    const result = new Map<string, MenuRow[]>();
    (catalogoQ.data?.menus ?? []).forEach((menu) => {
      const list = result.get(menu.modulo_id) ?? [];
      list.push(menu);
      result.set(menu.modulo_id, list);
    });
    return result;
  }, [catalogoQ.data?.menus]);

  const modulosFiltrados = useMemo(() => {
    let modulos = catalogoQ.data?.modulos ?? [];

    if (filtroModulo !== "all") {
      modulos = modulos.filter((modulo) => modulo.id === filtroModulo);
    }

    if (busca.trim()) {
      const term = busca.trim().toLowerCase();
      const menusMatching = new Set(
        (catalogoQ.data?.menus ?? [])
          .filter((menu) =>
            menu.nome.toLowerCase().includes(term) ||
            menu.codigo.toLowerCase().includes(term) ||
            (menu.rota ?? "").toLowerCase().includes(term),
          )
          .map((menu) => menu.modulo_id),
      );

      modulos = modulos.filter((modulo) =>
        modulo.nome.toLowerCase().includes(term) ||
        modulo.codigo.toLowerCase().includes(term) ||
        menusMatching.has(modulo.id),
      );
    }

    return modulos;
  }, [busca, catalogoQ.data?.menus, catalogoQ.data?.modulos, filtroModulo]);

  const inheritedAllows = useMemo(() => {
    const result = new Set<string>();

    (rolePermsQ.data ?? []).forEach((permission) => {
      result.add(permissionKey(permission.modulo, permission.menu_codigo, permission.acao));

      if (permission.menu_codigo === null) {
        (catalogoQ.data?.menus ?? [])
          .filter((menu) => permission.modulo === "*" || menu.modulo_codigo === permission.modulo)
          .forEach((menu) => {
            result.add(permissionKey(menu.modulo_codigo, menu.codigo, permission.acao));
          });
      }
    });

    return result;
  }, [catalogoQ.data?.menus, rolePermsQ.data]);

  const overrideMap = useMemo(() => {
    const result = new Map<string, UserOverrideRow>();
    (overridesQ.data ?? []).forEach((override) => {
      result.set(userPermissionKey(override.user_id, override.menu_codigo, override.acao, override.empresa_id), override);
    });
    return result;
  }, [overridesQ.data]);

  const effectivePending = (menu: string, acao: Acao) => {
    const key = userPermissionKey(userId, menu, acao, null);
    return pending.get(key);
  };

  const currentValue = (menu: string, acao: Acao): "inherit" | "allow" | "deny" => {
    const pendingChange = effectivePending(menu, acao);
    if (pendingChange) {
      if (pendingChange.allow === null) return "inherit";
      return pendingChange.allow ? "allow" : "deny";
    }

    const existing = overrideMap.get(userPermissionKey(userId, menu, acao, null));
    if (!existing) return "inherit";
    return existing.allow ? "allow" : "deny";
  };

  const inheritedValue = (modulo: string, menu: string, acao: Acao) => {
    return (
      inheritedAllows.has(permissionKey(modulo, menu, acao)) ||
      inheritedAllows.has(permissionKey(modulo, null, acao)) ||
      inheritedAllows.has(permissionKey("*", null, acao))
    );
  };

  const setOverride = (menu: string, acao: Acao, value: "inherit" | "allow" | "deny") => {
    if (!userId || !podeGerenciar) return;

    const key = userPermissionKey(userId, menu, acao, null);
    const existing = overrideMap.get(key);
    const allow = value === "inherit" ? null : value === "allow";
    const nextPending = new Map(pending);

    if (allow === null) {
      if (existing) {
        nextPending.set(key, { user_id: userId, menu_codigo: menu, acao, allow: null, empresa_id: null });
      } else {
        nextPending.delete(key);
      }
    } else if (existing && existing.allow === allow) {
      nextPending.delete(key);
    } else {
      nextPending.set(key, { user_id: userId, menu_codigo: menu, acao, allow, empresa_id: null });
    }

    setPending(nextPending);
  };

  const salvar = async () => {
    if (!podeGerenciar || !userId || pending.size === 0) return;

    setSaving(true);

    try {
      for (const change of Array.from(pending.values())) {
        const existing = overrideMap.get(userPermissionKey(change.user_id, change.menu_codigo, change.acao, change.empresa_id));

        if (change.allow === null) {
          if (existing?.id) {
            const { error } = await supabase
              .from("screen_permission_user")
              .delete()
              .eq("id", existing.id);

            if (error) throw error;
          }
        } else if (existing?.id) {
          const { error } = await supabase
            .from("screen_permission_user")
            .update({ allow: change.allow })
            .eq("id", existing.id);

          if (error) throw error;
        } else {
          const { data: currentUser } = await supabase.auth.getUser();

          const { error } = await supabase
            .from("screen_permission_user")
            .insert({
              user_id: change.user_id,
              menu_codigo: change.menu_codigo,
              acao: change.acao,
              allow: change.allow,
              empresa_id: change.empresa_id,
              created_by: currentUser.user?.id ?? null,
            });

          if (error) throw error;
        }
      }

      toast({
        title: "Exceções individuais salvas",
        description: `${pending.size} alteração(ões) aplicada(s) diretamente no override do usuário.`,
      });

      setPending(new Map());
      await invalidatePermissionCaches(queryClient);
      await overridesQ.refetch();
    } catch (error: any) {
      toast({
        title: "Erro ao salvar exceções",
        description: error?.message ?? "Falha inesperada.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card-elevated">
      <header className="flex flex-col gap-3 border-b border-border px-5 py-3.5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h2 className="font-display text-sm font-bold">Exceções individuais por usuário</h2>
          <p className="text-xs text-muted-foreground">
            Use para conceder ou negar uma ação específica sem criar perfil duplicado.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Select value={userId} onValueChange={(value) => { setUserId(value); setPending(new Map()); }}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Selecione o usuário" />
            </SelectTrigger>
            <SelectContent>
              {(usuariosQ.data ?? []).map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filtroModulo} onValueChange={setFiltroModulo}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Módulo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os módulos</SelectItem>
              {(catalogoQ.data?.modulos ?? []).map((modulo) => (
                <SelectItem key={modulo.id} value={modulo.id}>
                  {modulo.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar tela, rota ou código"
            className="w-64"
          />
        </div>

        {userId && (
          <div className="text-xs text-muted-foreground">
            Perfis herdados:{" "}
            {userRolesQ.data?.length ? (
              userRolesQ.data.map((role) => (
                <Badge key={role} variant="secondary" className="mr-1">
                  {role}
                </Badge>
              ))
            ) : (
              <span>nenhum perfil encontrado</span>
            )}
          </div>
        )}
      </header>

      {!userId ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          Selecione um usuário para editar exceções individuais.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="sticky left-0 z-10 bg-muted/40 px-5 py-3 text-left">Módulo / Tela</th>
                {ACOES.map((acao) => (
                  <th key={acao} className="px-2 py-3 text-center capitalize">
                    {acao.replace("_", " ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {modulosFiltrados.map((modulo) => {
                const menus = menusByModulo.get(modulo.id) ?? [];
                return (
                  <Fragment key={modulo.id}>
                    <tr className="bg-muted/20">
                      <td className="sticky left-0 z-10 bg-muted/20 px-5 py-3 font-semibold">
                        <span className="flex items-center gap-2">
                          <Layers className="h-3.5 w-3.5 text-primary" />
                          {modulo.nome}
                          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                            ({menus.length} telas)
                          </span>
                        </span>
                      </td>
                      {ACOES.map((acao) => (
                        <td key={acao} className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                          Herança
                        </td>
                      ))}
                    </tr>

                    {menus.map((menu) => (
                      <tr key={menu.id} className="hover:bg-muted/30">
                        <td className="sticky left-0 z-10 bg-background px-5 py-2 pl-12">
                          <span className="flex items-center gap-2 text-xs">
                            <FileText className="h-3 w-3 text-muted-foreground" />
                            <span className="font-medium">{menu.nome}</span>
                            <code className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                              {menu.codigo}
                            </code>
                            {menu.rota && (
                              <code className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                                {menu.rota}
                              </code>
                            )}
                          </span>
                        </td>

                        {ACOES.map((acao) => {
                          const inherited = inheritedValue(menu.modulo_codigo, menu.codigo, acao);
                          const value = currentValue(menu.codigo, acao);

                          return (
                            <td key={acao} className="px-2 py-2 text-center">
                              <Select
                                value={value}
                                onValueChange={(next) => setOverride(menu.codigo, acao, next as "inherit" | "allow" | "deny")}
                                disabled={!podeGerenciar || saving}
                              >
                                <SelectTrigger className="mx-auto h-8 w-36 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="inherit">
                                    Herdar ({inherited ? "permitido" : "negado"})
                                  </SelectItem>
                                  <SelectItem value="allow">Permitir</SelectItem>
                                  <SelectItem value="deny">Negar</SelectItem>
                                </SelectContent>
                              </Select>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border bg-muted/30 px-5 py-3 text-xs">
        <p className="text-muted-foreground">
          {pending.size} alteração(ões) pendente(s). Override individual tem precedência sobre perfil.
        </p>
        <Button size="sm" onClick={salvar} disabled={!podeGerenciar || !userId || pending.size === 0 || saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Salvar exceções
        </Button>
      </div>
    </section>
  );
}
