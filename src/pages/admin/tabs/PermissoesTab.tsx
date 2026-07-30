import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { usePermissoes } from "@/context/PermissoesContext";
import type { Database } from "@/integrations/supabase/types";
import { ChevronRight, ChevronDown, Layers, FileText } from "lucide-react";

type Role = Database["public"]["Enums"]["app_role"];
type Acao = Database["public"]["Enums"]["app_acao"];

const ACOES: Acao[] = ["visualizar", "incluir", "alterar", "excluir", "aprovar", "exportar", "executar_ia"];

interface ModuloRow { id: string; codigo: string; nome: string }
interface MenuRow { id: string; modulo_id: string; codigo: string; nome: string; rota: string | null }

export function PermissoesTab() {
  const qc = useQueryClient();
  const { can } = usePermissoes();
  const podeGerenciar = can("alterar", undefined, "administracao");

  const perfisQ = useQuery({
    queryKey: ["perfil_metadata"],
    queryFn: async () => {
      const { data, error } = await supabase.from("perfil_metadata").select("role").order("role");
      if (error) throw error;
      return (data ?? []).map((r: any) => r.role as Role).filter((r) => r !== "visitante");
    },
  });

  const modulosQ = useQuery({
    queryKey: ["app_modulo"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_modulo").select("id,codigo,nome").order("ordem");
      if (error) throw error;
      return (data ?? []) as ModuloRow[];
    },
  });

  const menusQ = useQuery({
    queryKey: ["app_menu"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_menu").select("id,modulo_id,codigo,nome,rota").eq("ativo", true).order("ordem");
      if (error) throw error;
      return (data ?? []) as MenuRow[];
    },
  });

  const menusByModulo = useMemo(() => {
    const m = new Map<string, MenuRow[]>();
    (menusQ.data ?? []).forEach((mn) => {
      const arr = m.get(mn.modulo_id) ?? [];
      arr.push(mn);
      m.set(mn.modulo_id, arr);
    });
    return m;
  }, [menusQ.data]);

  const [perfil, setPerfil] = useState<Role>("controladoria");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const permsQ = useQuery({
    queryKey: ["role_permissions", perfil],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_permissions")
        .select("modulo,acao,menu_codigo")
        .eq("role", perfil);
      if (error) throw error;
      return new Set((data ?? []).map((r: any) => `${r.modulo}::${r.menu_codigo ?? ""}::${r.acao}`));
    },
  });

  const [pending, setPending] = useState<Map<string, boolean>>(new Map());

  const keyOf = (modulo: string, menu: string | null, acao: Acao) =>
    `${modulo}::${menu ?? ""}::${acao}`;

  const isChecked = (key: string) => {
    if (pending.has(key)) return pending.get(key)!;
    return permsQ.data?.has(key) ?? false;
  };

  const toggle = (modulo: string, menu: string | null, acao: Acao) => {
    if (!podeGerenciar) return;
    const key = keyOf(modulo, menu, acao);
    const cur = isChecked(key);
    const next = new Map(pending);
    next.set(key, !cur);
    setPending(next);
  };

  const toggleExpand = (modCodigo: string) => {
    const next = new Set(expanded);
    if (next.has(modCodigo)) next.delete(modCodigo);
    else next.add(modCodigo);
    setExpanded(next);
  };

  const salvar = async () => {
    if (pending.size === 0) return;
    const adds: { role: Role; modulo: string; menu_codigo: string | null; acao: Acao }[] = [];
    const removes: { modulo: string; menu_codigo: string | null; acao: Acao }[] = [];
    pending.forEach((novoValor, key) => {
      const [modulo, menuRaw, acao] = key.split("::") as [string, string, Acao];
      const menu_codigo = menuRaw === "" ? null : menuRaw;
      if (novoValor) adds.push({ role: perfil, modulo, menu_codigo, acao });
      else removes.push({ modulo, menu_codigo, acao });
    });
    try {
      if (adds.length > 0) {
        const { error } = await supabase.from("role_permissions").insert(adds);
        if (error) throw error;
      }
      for (const r of removes) {
        let q = supabase.from("role_permissions").delete()
          .eq("role", perfil).eq("modulo", r.modulo).eq("acao", r.acao);
        q = r.menu_codigo === null ? q.is("menu_codigo", null) : q.eq("menu_codigo", r.menu_codigo);
        const { error } = await q;
        if (error) throw error;
      }
      toast({ title: "Permissões salvas", description: `${adds.length} adição(ões), ${removes.length} remoção(ões).` });
      setPending(new Map());
      qc.invalidateQueries({ queryKey: ["role_permissions", perfil] });
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    }
  };

  return (
    <section className="card-elevated">
      <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div>
          <h2 className="font-display text-sm font-bold">Matriz de permissões por perfil</h2>
          <p className="text-xs text-muted-foreground">
            Perfil ativo: <strong className="capitalize">{perfil.replace(/_/g, " ")}</strong> · expanda um módulo para liberar telas/menus específicos.
          </p>
        </div>
        <Select value={perfil} onValueChange={(v) => { setPerfil(v as Role); setPending(new Map()); }}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(perfisQ.data ?? []).map((r) => (
              <SelectItem key={r} value={r} className="capitalize">{r.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 text-left">Módulo / Tela</th>
              {ACOES.map((a) => <th key={a} className="px-2 py-3 text-center capitalize">{a.replace("_", " ")}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(modulosQ.data ?? []).map((m) => {
              const menus = menusByModulo.get(m.id) ?? [];
              const isOpen = expanded.has(m.codigo);
              return (
                <Fragment key={m.id}>
                  <tr className="bg-muted/20 hover:bg-muted/40">
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        onClick={() => toggleExpand(m.codigo)}
                        className="flex items-center gap-2 text-left text-sm font-semibold"
                      >
                        {menus.length > 0 ? (
                          isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
                        ) : <span className="w-3.5" />}
                        <Layers className="h-3.5 w-3.5 text-primary" />
                        {m.nome}
                        {menus.length > 0 && (
                          <span className="ml-1 text-[10px] font-normal text-muted-foreground">({menus.length} telas)</span>
                        )}
                      </button>
                    </td>
                    {ACOES.map((a) => (
                      <td key={a} className="px-2 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked(keyOf(m.codigo, null, a))}
                          onChange={() => toggle(m.codigo, null, a)}
                          disabled={!podeGerenciar}
                          className="h-4 w-4 rounded border-border accent-primary"
                          title={`${a} no módulo inteiro`}
                        />
                      </td>
                    ))}
                  </tr>
                  {isOpen && menus.map((mn) => (
                    <tr key={mn.id} className="hover:bg-muted/30">
                      <td className="px-5 py-2 pl-12">
                        <span className="flex items-center gap-2 text-xs">
                          <FileText className="h-3 w-3 text-muted-foreground" />
                          {mn.nome}
                          {mn.rota && <code className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{mn.rota}</code>}
                        </span>
                      </td>
                      {ACOES.map((a) => (
                        <td key={a} className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={isChecked(keyOf(m.codigo, mn.codigo, a))}
                            onChange={() => toggle(m.codigo, mn.codigo, a)}
                            disabled={!podeGerenciar}
                            className="h-4 w-4 rounded border-border accent-primary"
                            title={`${a} apenas em ${mn.nome}`}
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
          {pending.size} alteração(ões) pendente(s). · Permissão no módulo cobre todas as telas; libere telas individuais quando o perfil tiver acesso restrito.
        </p>
        <Button size="sm" onClick={salvar} disabled={!podeGerenciar || pending.size === 0}>Salvar matriz</Button>
      </div>
    </section>
  );
}
