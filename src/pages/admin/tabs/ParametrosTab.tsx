import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { usePermissoes } from "@/context/PermissoesContext";
import { Plus, Trash2, Pencil } from "lucide-react";

interface Param { id: string; empresa_id: string; chave: string; valor: string | null; descricao: string | null; tipo: string; categoria: string | null }

export function ParametrosTab() {
  const qc = useQueryClient();
  const { can, empresaId } = usePermissoes();
  const podeGerenciar = can("alterar", undefined, "administracao");

  const empresasQ = useQuery({
    queryKey: ["empresas-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id,codigo,razao_social").order("razao_social");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [empresaSel, setEmpresaSel] = useState<string>("");
  const eid = empresaSel || empresaId || (empresasQ.data?.[0]?.id ?? "");

  const paramsQ = useQuery({
    enabled: !!eid,
    queryKey: ["parametro_geral", eid],
    queryFn: async () => {
      const { data, error } = await supabase.from("parametro_geral").select("*").eq("empresa_id", eid).order("categoria").order("chave");
      if (error) throw error;
      return (data ?? []) as Param[];
    },
  });

  const remover = async (id: string) => {
    if (!confirm("Excluir este parâmetro?")) return;
    const { error } = await supabase.from("parametro_geral").delete().eq("id", id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["parametro_geral", eid] });
  };

  return (
    <section className="card-elevated">
      <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div>
          <h2 className="font-display text-sm font-bold">Parâmetros gerais</h2>
          <p className="text-xs text-muted-foreground">Configurações chave/valor por empresa (margem, política de senha, fuso, etc.).</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={eid} onChange={(e) => setEmpresaSel(e.target.value)} className="h-9 rounded-md border border-border bg-card px-3 text-xs">
            {(empresasQ.data ?? []).map((e: any) => <option key={e.id} value={e.id}>{e.codigo} — {e.razao_social}</option>)}
          </select>
          {podeGerenciar && eid && <ParamDialog empresaId={eid} onSaved={() => qc.invalidateQueries({ queryKey: ["parametro_geral", eid] })} />}
        </div>
      </header>
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-5 py-3 text-left">Categoria</th>
            <th className="px-3 py-3 text-left">Chave</th>
            <th className="px-3 py-3 text-left">Valor</th>
            <th className="px-3 py-3 text-left">Descrição</th>
            <th className="px-5 py-3 text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {paramsQ.isLoading && <tr><td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">Carregando…</td></tr>}
          {!paramsQ.isLoading && (paramsQ.data ?? []).length === 0 && (
            <tr><td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">Nenhum parâmetro cadastrado.</td></tr>
          )}
          {(paramsQ.data ?? []).map((p) => (
            <tr key={p.id} className="hover:bg-muted/40">
              <td className="px-5 py-3 text-xs text-muted-foreground">{p.categoria ?? "—"}</td>
              <td className="px-3 py-3 font-mono text-xs">{p.chave}</td>
              <td className="px-3 py-3 text-sm font-medium">{p.valor ?? "—"}</td>
              <td className="px-3 py-3 text-xs text-muted-foreground">{p.descricao ?? "—"}</td>
              <td className="px-5 py-3 text-right">
                {podeGerenciar && (
                  <div className="flex justify-end gap-1">
                    <ParamDialog empresaId={eid} param={p} onSaved={() => qc.invalidateQueries({ queryKey: ["parametro_geral", eid] })} />
                    <Button size="sm" variant="ghost" onClick={() => remover(p.id)} className="text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ParamDialog({ empresaId, param, onSaved }: { empresaId: string; param?: Param; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [chave, setChave] = useState(param?.chave ?? "");
  const [valor, setValor] = useState(param?.valor ?? "");
  const [descricao, setDescricao] = useState(param?.descricao ?? "");
  const [categoria, setCategoria] = useState(param?.categoria ?? "");
  const [tipo, setTipo] = useState(param?.tipo ?? "texto");
  const [saving, setSaving] = useState(false);
  const isEdit = !!param;

  const salvar = async () => {
    if (!chave.trim()) { toast({ title: "Chave obrigatória", variant: "destructive" }); return; }
    setSaving(true);
    let error;
    if (isEdit) {
      ({ error } = await supabase.from("parametro_geral").update({
        valor: valor || null, descricao: descricao || null, categoria: categoria || null, tipo,
      }).eq("id", param!.id));
    } else {
      ({ error } = await supabase.from("parametro_geral").insert({
        empresa_id: empresaId, chave: chave.trim(),
        valor: valor || null, descricao: descricao || null, categoria: categoria || null, tipo,
      }));
    }
    setSaving(false);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: isEdit ? "Parâmetro atualizado" : "Parâmetro criado" });
    setOpen(false); onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit
          ? <Button size="sm" variant="ghost"><Pencil className="h-3.5 w-3.5" /></Button>
          : <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Novo parâmetro</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{isEdit ? "Editar parâmetro" : "Novo parâmetro"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Categoria</Label><Input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Ex.: Financeiro, Segurança" /></div>
          <div><Label>Chave *</Label><Input value={chave} onChange={(e) => setChave(e.target.value)} disabled={isEdit} placeholder="margem_minima" /></div>
          <div><Label>Valor</Label><Input value={valor} onChange={(e) => setValor(e.target.value)} /></div>
          <div><Label>Tipo</Label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm">
              <option value="texto">texto</option><option value="numero">número</option>
              <option value="percentual">percentual</option><option value="booleano">booleano</option>
              <option value="json">json</option>
            </select>
          </div>
          <div><Label>Descrição</Label><Input value={descricao} onChange={(e) => setDescricao(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
