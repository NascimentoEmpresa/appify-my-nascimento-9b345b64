import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Pencil } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { usePermissoes } from "@/context/PermissoesContext";
import type { Database } from "@/integrations/supabase/types";

type Role = Database["public"]["Enums"]["app_role"];

interface Meta {
  role: Role;
  nome: string | null;
  descricao: string | null;
  icone: string | null;
  cor: string | null;
}

const fallbackNome = (role: Role) =>
  String(role ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const displayNome = (m: Pick<Meta, "role" | "nome">) =>
  m.nome && m.nome.trim().length > 0 ? m.nome : fallbackNome(m.role);

export function PerfisTab() {
  const qc = useQueryClient();
  const { can } = usePermissoes();
  const podeGerenciar = can("alterar", undefined, "administracao");
  const metaQ = useQuery({
    queryKey: ["perfil_metadata"],
    queryFn: async () => {
      const { data, error } = await supabase.from("perfil_metadata").select("*").order("role");
      if (error) throw error;
      return ((data ?? []) as Meta[]).filter((m) => m.role !== "visitante");
    },
  });
  const usersByRoleQ = useQuery({
    queryKey: ["users-by-role"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("role");
      if (error) throw error;
      const m: Record<string, number> = {};
      (data ?? []).forEach((r: any) => { m[r.role] = (m[r.role] ?? 0) + 1; });
      return m;
    },
  });

  if (!podeGerenciar) {
    return <section className="card-elevated p-6 text-sm text-muted-foreground">Apenas administradores podem gerenciar perfis.</section>;
  }

  return (
    <section className="card-elevated">
      <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div>
          <h2 className="font-display text-sm font-bold">Perfis de acesso</h2>
          <p className="text-xs text-muted-foreground">
            Os perfis (roles) são fixos do sistema. Aqui você ajusta o nome de exibição, descrição, ícone e cor de cada um.
          </p>
        </div>
      </header>
      <div className="grid gap-3 p-5 sm:grid-cols-2">
        {metaQ.isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
        {(metaQ.data ?? []).map((p) => (
          <div key={p.role} className="card-elevated p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div
                  className="grid h-9 w-9 place-items-center rounded-lg text-white"
                  style={{ background: p.cor ?? "hsl(var(--primary))" }}
                >
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-display text-sm font-bold">{displayNome(p)}</h3>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    chave: <code className="font-mono">{p.role}</code>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{p.descricao ?? "—"}</p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge variant="secondary" className="text-[10px]">
                  {usersByRoleQ.data?.[p.role] ?? 0} usuário(s)
                </Badge>
                <EditarPerfilDialog perfil={p} onSaved={() => {
                  qc.invalidateQueries({ queryKey: ["perfil_metadata"] });
                  qc.invalidateQueries({ queryKey: ["perfil_metadata_dropdown"] });
                }} />

              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function EditarPerfilDialog({ perfil, onSaved }: { perfil: Meta; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState(perfil.nome ?? fallbackNome(perfil.role));
  const [descricao, setDescricao] = useState(perfil.descricao ?? "");
  const [icone, setIcone] = useState(perfil.icone ?? "");
  const [cor, setCor] = useState(perfil.cor ?? "#1e3a8a");
  const [saving, setSaving] = useState(false);

  const salvar = async () => {
    setSaving(true);
    try {
      const nomeTrim = nome.trim();
      const { error } = await supabase
        .from("perfil_metadata")
        .update({
          nome: nomeTrim.length > 0 ? nomeTrim : null,
          descricao: descricao || null,
          icone: icone || null,
          cor: cor || null,
        })
        .eq("role", perfil.role);
      if (error) throw error;
      toast({ title: "Perfil atualizado" });
      setOpen(false);
      onSaved();
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5"><Pencil className="h-3.5 w-3.5" /> Editar</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Perfil: <span>{displayNome(perfil)}</span>
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground">
            Chave técnica imutável: <code className="font-mono">{perfil.role}</code>
          </p>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome do perfil</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Diretor Administrativo"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Nome de exibição em telas, menus e listas. Não altera permissões.
            </p>
          </div>
          <div>
            <Label>Descrição</Label>
            <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <div>
            <Label>Ícone (lucide-react)</Label>
            <Input value={icone} onChange={(e) => setIcone(e.target.value)} placeholder="Ex.: ShieldCheck" />
          </div>
          <div>
            <Label>Cor (hex)</Label>
            <div className="flex gap-2">
              <Input value={cor} onChange={(e) => setCor(e.target.value)} />
              <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} className="h-10 w-14 rounded border border-border" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
