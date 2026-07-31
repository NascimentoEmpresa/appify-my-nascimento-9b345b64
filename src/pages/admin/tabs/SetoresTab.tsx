import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Building2, Pencil, Plus, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { usePermissoes } from "@/context/PermissoesContext";

export function SetoresTab() {
  const qc = useQueryClient();
  const { can } = usePermissoes();
  const podeGerenciar = can("alterar", undefined, "administracao");
  const [novoSetor, setNovoSetor] = useState("");
  const [criando, setCriando] = useState(false);

  const catalogoQ = useQuery({
    queryKey: ["setor_catalogo_admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("setor_catalogo").select("nome").order("nome");
      if (error) throw error;
      return (data ?? []).map((r: any) => r.nome as string);
    },
  });

  const contagemQ = useQuery({
    queryKey: ["setor_contagem"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_setor").select("setor");
      if (error) throw error;
      const m: Record<string, number> = {};
      (data ?? []).forEach((r: any) => { m[r.setor] = (m[r.setor] ?? 0) + 1; });
      return m;
    },
  });

  const invalidarTudo = () => {
    qc.invalidateQueries({ queryKey: ["setor_catalogo_admin"] });
    qc.invalidateQueries({ queryKey: ["setor_contagem"] });
    qc.invalidateQueries({ queryKey: ["setores_catalogo"] });
    qc.invalidateQueries({ queryKey: ["all-user-setores"] });
  };

  const criar = async () => {
    const nome = novoSetor.trim();
    if (!nome) return;
    setCriando(true);
    try {
      const { error } = await supabase.from("setor_catalogo").insert({ nome });
      if (error) throw error;
      toast({ title: "Setor criado" });
      setNovoSetor("");
      invalidarTudo();
    } catch (e: any) {
      toast({
        title: /duplicate|unique/i.test(e?.message ?? "") ? "Esse setor já existe" : "Erro ao criar setor",
        description: e?.message,
        variant: "destructive",
      });
    } finally {
      setCriando(false);
    }
  };

  if (!podeGerenciar) {
    return <section className="card-elevated p-6 text-sm text-muted-foreground">Apenas administradores podem gerenciar setores.</section>;
  }

  return (
    <section className="card-elevated">
      <header className="border-b border-border px-5 py-3.5">
        <h2 className="font-display text-sm font-bold">Setores</h2>
        <p className="text-xs text-muted-foreground">
          Setor é só um rótulo informativo (departamento da pessoa) — não concede nenhum acesso. Permissões são configuradas em Módulos & Menus → Acesso por Usuário.
        </p>
      </header>

      <div className="flex gap-2 border-b border-border p-4">
        <Input
          value={novoSetor}
          onChange={(e) => setNovoSetor(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); criar(); } }}
          placeholder="Novo setor (ex.: Manutenção)"
        />
        <Button onClick={criar} disabled={criando || !novoSetor.trim()} className="gap-1.5">
          <Plus className="h-4 w-4" /> Criar setor
        </Button>
      </div>

      <div className="grid gap-2 p-4 sm:grid-cols-2">
        {catalogoQ.isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
        {!catalogoQ.isLoading && (catalogoQ.data ?? []).length === 0 && (
          <p className="text-xs text-muted-foreground">Nenhum setor cadastrado ainda.</p>
        )}
        {(catalogoQ.data ?? []).map((nome) => (
          <div key={nome} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-medium">{nome}</span>
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                {contagemQ.data?.[nome] ?? 0} pessoa(s)
              </Badge>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <EditarSetorDialog nome={nome} onSaved={invalidarTudo} />
              <ExcluirSetorDialog nome={nome} qtdPessoas={contagemQ.data?.[nome] ?? 0} onDeleted={invalidarTudo} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function EditarSetorDialog({ nome, onSaved }: { nome: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [novoNome, setNovoNome] = useState(nome);
  const [saving, setSaving] = useState(false);

  const salvar = async () => {
    const trimmed = novoNome.trim();
    if (!trimmed || trimmed === nome) { setOpen(false); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("setor_catalogo").update({ nome: trimmed }).eq("nome", nome);
      if (error) throw error;
      toast({ title: "Setor renomeado" });
      setOpen(false);
      onSaved();
    } catch (e: any) {
      toast({
        title: /duplicate|unique/i.test(e?.message ?? "") ? "Já existe um setor com esse nome" : "Erro ao renomear",
        description: e?.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setNovoNome(nome); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0"><Pencil className="h-3.5 w-3.5" /></Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Renomear setor</DialogTitle>
        </DialogHeader>
        <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
        <p className="text-[11px] text-muted-foreground">
          Atualiza automaticamente quem já tem esse setor atribuído.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExcluirSetorDialog({ nome, qtdPessoas, onDeleted }: { nome: string; qtdPessoas: number; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [deletando, setDeletando] = useState(false);

  const excluir = async () => {
    setDeletando(true);
    try {
      const { error } = await supabase.from("setor_catalogo").delete().eq("nome", nome);
      if (error) throw error;
      toast({ title: "Setor excluído" });
      setOpen(false);
      onDeleted();
    } catch (e: any) {
      toast({ title: "Erro ao excluir", description: e?.message, variant: "destructive" });
    } finally {
      setDeletando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" /> Excluir setor "{nome}"?
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {qtdPessoas > 0
            ? <>Isso remove o setor de <strong>{qtdPessoas} pessoa(s)</strong> que têm ele atribuído hoje. Não afeta nenhum acesso — é só o rótulo.</>
            : "Nenhuma pessoa tem esse setor atribuído hoje."}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={deletando}>Cancelar</Button>
          <Button variant="destructive" onClick={excluir} disabled={deletando}>{deletando ? "Excluindo…" : "Sim, excluir"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
