import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { usePermissoes } from "@/context/PermissoesContext";
import { AlertOctagon, Plus, Check } from "lucide-react";

interface Ocorr {
  id: string; empresa_id: string | null; tipo: string; severidade: string;
  titulo: string; descricao: string | null;
  usuario_nome: string | null; ocorreu_em: string;
  resolvida: boolean; resolvida_em: string | null;
}

export function OcorrenciasTab() {
  const qc = useQueryClient();
  const { can } = usePermissoes();
  const podeGerenciar = can("alterar", undefined, "administracao");

  const ocorrQ = useQuery({
    queryKey: ["ocorrencia_operacional"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ocorrencia_operacional").select("*").order("ocorreu_em", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as Ocorr[];
    },
  });

  const resolver = async (id: string) => {
    const { error } = await supabase.from("ocorrencia_operacional").update({
      resolvida: true,
      resolvida_em: new Date().toISOString(),
    }).eq("id", id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["ocorrencia_operacional"] });
    toast({ title: "Ocorrência resolvida" });
  };

  return (
    <section className="card-elevated">
      <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div>
          <h2 className="font-display text-sm font-bold">Ocorrências de operação</h2>
          <p className="text-xs text-muted-foreground">{ocorrQ.data?.length ?? 0} ocorrência(s) registrada(s).</p>
        </div>
        {podeGerenciar && <NovaOcorrenciaDialog onSaved={() => qc.invalidateQueries({ queryKey: ["ocorrencia_operacional"] })} />}
      </header>
      <ul className="divide-y divide-border">
        {ocorrQ.isLoading && <li className="px-5 py-6 text-center text-sm text-muted-foreground">Carregando…</li>}
        {!ocorrQ.isLoading && (ocorrQ.data ?? []).length === 0 && (
          <li className="px-5 py-6 text-center text-sm text-muted-foreground">Nenhuma ocorrência registrada.</li>
        )}
        {(ocorrQ.data ?? []).map((o) => {
          const tone = o.severidade === "destructive" ? "destructive" : o.severidade === "warning" ? "warning" : "info";
          return (
            <li key={o.id} className={`flex items-center gap-3 px-5 py-3 ${o.resolvida ? "opacity-60" : ""}`}>
              <AlertOctagon className={`h-4 w-4 shrink-0 text-${tone}`} />
              <div className="flex-1">
                <p className="text-sm font-medium">{o.titulo}</p>
                <p className="text-[11px] text-muted-foreground">
                  {o.tipo} · {o.usuario_nome ?? "sistema"} · {new Date(o.ocorreu_em).toLocaleString("pt-BR")}
                  {o.descricao && <> · {o.descricao}</>}
                </p>
              </div>
              {o.resolvida ? (
                <span className="chip border border-success/30 bg-success-soft text-success"><Check className="h-3 w-3" /> Resolvida</span>
              ) : podeGerenciar ? (
                <Button size="sm" variant="ghost" onClick={() => resolver(o.id)} className="gap-1.5"><Check className="h-3.5 w-3.5" /> Resolver</Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function NovaOcorrenciaDialog({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [severidade, setSeveridade] = useState("info");
  const [empresaId, setEmpresaId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const empresasQ = useQuery({
    queryKey: ["empresas-all"],
    queryFn: async () => {
      const { data } = await supabase.from("empresas").select("id,codigo,razao_social").order("razao_social");
      return data ?? [];
    },
  });

  const salvar = async () => {
    if (!titulo.trim() || !tipo.trim()) { toast({ title: "Tipo e título obrigatórios", variant: "destructive" }); return; }
    setSaving(true);
    const { error } = await supabase.from("ocorrencia_operacional").insert({
      titulo: titulo.trim(), tipo: tipo.trim(),
      descricao: descricao || null, severidade,
      empresa_id: empresaId || null,
    });
    setSaving(false);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Ocorrência registrada" });
    setOpen(false);
    setTitulo(""); setTipo(""); setDescricao(""); setSeveridade("info"); setEmpresaId("");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Nova ocorrência</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Registrar ocorrência</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Tipo *</Label><Input value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Ex.: Acesso fora do horário" /></div>
          <div><Label>Título *</Label><Input value={titulo} onChange={(e) => setTitulo(e.target.value)} /></div>
          <div><Label>Severidade</Label>
            <select value={severidade} onChange={(e) => setSeveridade(e.target.value)} className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm">
              <option value="info">info</option><option value="warning">atenção</option><option value="destructive">crítica</option>
            </select>
          </div>
          <div><Label>Empresa</Label>
            <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm">
              <option value="">— sem empresa —</option>
              {(empresasQ.data ?? []).map((e: any) => <option key={e.id} value={e.id}>{e.codigo} — {e.razao_social}</option>)}
            </select>
          </div>
          <div><Label>Descrição</Label><Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
