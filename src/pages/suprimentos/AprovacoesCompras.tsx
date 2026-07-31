import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/layout/PageHeader";
import { useList } from "@/hooks/useGenericCrud";
import { CheckCircle2, XCircle, GitBranch, Plus, Trash2, Workflow, Users } from "lucide-react";
import { toast } from "sonner";

const ALVOS = [
  { value: "rc", label: "Requisição de Compra (RC)" },
  { value: "pc", label: "Pedido de Compra (PC)" },
];

const MODOS = [
  { value: "qualquer", label: "Qualquer um aprova (OU)" },
  { value: "todos", label: "Todos devem aprovar (E)" },
  { value: "quorum", label: "Quórum mínimo" },
];

export default function AprovacoesCompras() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("instancias");

  // ========== Fluxos ==========
  const { data: fluxos = [] } = useQuery<any[]>({
    queryKey: ["sup_aprov_fluxo"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("sup_aprov_fluxo").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: empresas = [] } = useList<any>("empresas", { orderBy: "razao_social", ascending: true });

  const [openFluxo, setOpenFluxo] = useState(false);
  const [fluxoForm, setFluxoForm] = useState<any>({ alvo: "rc", valor_min: 0, ativo: true });

  const criarFluxo = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("sup_aprov_fluxo").insert([fluxoForm]);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Fluxo criado");
      qc.invalidateQueries({ queryKey: ["sup_aprov_fluxo"] });
      setOpenFluxo(false);
      setFluxoForm({ alvo: "rc", valor_min: 0, ativo: true });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ========== Etapas / Aprovadores ==========
  const [fluxoSel, setFluxoSel] = useState<any>(null);
  const [openEtapas, setOpenEtapas] = useState(false);

  const { data: etapas = [] } = useQuery<any[]>({
    queryKey: ["sup_aprov_etapa", fluxoSel?.id],
    queryFn: async () => {
      if (!fluxoSel?.id) return [];
      const { data, error } = await (supabase as any).from("sup_aprov_etapa")
        .select("*").eq("fluxo_id", fluxoSel.id).order("ordem");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!fluxoSel?.id,
  });

  const [novaEtapa, setNovaEtapa] = useState<any>({ ordem: 1, modo: "qualquer", quorum_minimo: null });

  const addEtapa = useMutation({
    mutationFn: async () => {
      const payload = { ...novaEtapa, fluxo_id: fluxoSel.id };
      const { error } = await (supabase as any).from("sup_aprov_etapa").insert([payload]);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Etapa criada");
      qc.invalidateQueries({ queryKey: ["sup_aprov_etapa", fluxoSel?.id] });
      setNovaEtapa({ ordem: (etapas.length || 0) + 2, modo: "qualquer", quorum_minimo: null });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delEtapa = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("sup_aprov_etapa").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sup_aprov_etapa", fluxoSel?.id] }),
    onError: (e: any) => toast.error(e.message),
  });

  // ========== Instâncias ==========
  const { data: instancias = [] } = useQuery<any[]>({
    queryKey: ["sup_aprov_instancia"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("sup_aprov_instancia")
        .select("*").order("iniciado_em", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [instSel, setInstSel] = useState<any>(null);
  const { data: votos = [] } = useQuery<any[]>({
    queryKey: ["sup_aprov_voto", instSel?.id],
    queryFn: async () => {
      if (!instSel?.id) return [];
      const { data, error } = await (supabase as any).from("sup_aprov_voto").select("*").eq("instancia_id", instSel.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!instSel?.id,
  });

  const [comentario, setComentario] = useState("");
  const votar = useMutation({
    mutationFn: async (voto: "aprovado" | "rejeitado") => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await (supabase as any).from("sup_aprov_voto").insert([{
        instancia_id: instSel.id,
        etapa_id: instSel.etapa_atual_id,
        user_id: u.user?.id,
        voto, comentario: comentario || null,
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Voto registrado");
      qc.invalidateQueries({ queryKey: ["sup_aprov_instancia"] });
      qc.invalidateQueries({ queryKey: ["sup_aprov_voto", instSel?.id] });
      setComentario("");
      setInstSel(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const statusBadge = (s: string) => {
    const map: Record<string, any> = {
      aberta: { v: "default", l: "Aberta" },
      aprovada: { v: "default", l: "Aprovada" },
      rejeitada: { v: "destructive", l: "Rejeitada" },
      cancelada: { v: "secondary", l: "Cancelada" },
    };
    const c = map[s] ?? { v: "outline", l: s };
    return <Badge variant={c.v}>{c.l}</Badge>;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Aprovações de Compras"
        subtitle="Configure fluxos paralelos e gerencie aprovações de RC e PC."
      />

      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs dark:bg-amber-950/30">
        <span className="font-semibold text-amber-900 dark:text-amber-200">⚠ Tela em depreciação.</span>
        <span className="text-amber-800/80 dark:text-amber-300/80">
          A configuração oficial de alçadas migrou para <strong>Administração → Alçadas</strong> (novo motor unificado <code>sup_aprov</code>). Esta tela é mantida apenas para consulta histórica das instâncias antigas.
        </span>
      </div>


      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="instancias"><Users className="h-4 w-4 mr-2" />Instâncias</TabsTrigger>
          <TabsTrigger value="fluxos"><Workflow className="h-4 w-4 mr-2" />Fluxos</TabsTrigger>
        </TabsList>

        {/* INSTÂNCIAS */}
        <TabsContent value="instancias" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Aprovações em andamento</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Alvo</TableHead><TableHead>RC/PC</TableHead><TableHead>Status</TableHead>
                  <TableHead>Iniciado em</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {instancias.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nenhuma instância</TableCell></TableRow>
                  )}
                  {instancias.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell><Badge variant="outline">{i.alvo?.toUpperCase()}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{(i.rc_id || i.pc_id)?.slice(0, 8)}</TableCell>
                      <TableCell>{statusBadge(i.status)}</TableCell>
                      <TableCell className="text-sm">{new Date(i.iniciado_em).toLocaleString("pt-BR")}</TableCell>
                      <TableCell>
                        {i.status === "aberta" && (
                          <Button size="sm" variant="outline" onClick={() => setInstSel(i)}>Votar</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Dialog open={!!instSel} onOpenChange={(o) => !o && setInstSel(null)}>
            <DialogContent>
              <DialogHeader><DialogTitle>Votar em aprovação</DialogTitle></DialogHeader>
              {instSel && (
                <div className="space-y-3">
                  <div className="text-sm">
                    <strong>Alvo:</strong> {instSel.alvo?.toUpperCase()} · <strong>Etapa:</strong> {instSel.etapa_atual_id?.slice(0, 8)}
                  </div>
                  <div>
                    <Label>Votos já registrados nesta etapa</Label>
                    <div className="text-sm text-muted-foreground">
                      {votos.filter((v: any) => v.etapa_id === instSel.etapa_atual_id).length} voto(s)
                    </div>
                  </div>
                  <div>
                    <Label>Comentário</Label>
                    <Textarea value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Opcional" />
                  </div>
                </div>
              )}
              <DialogFooter className="gap-2">
                <Button variant="destructive" onClick={() => votar.mutate("rejeitado")} disabled={votar.isPending}>
                  <XCircle className="h-4 w-4 mr-2" /> Rejeitar
                </Button>
                <Button onClick={() => votar.mutate("aprovado")} disabled={votar.isPending}>
                  <CheckCircle2 className="h-4 w-4 mr-2" /> Aprovar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* FLUXOS */}
        <TabsContent value="fluxos" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={openFluxo} onOpenChange={setOpenFluxo}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Novo Fluxo</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Novo fluxo de aprovação</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Empresa</Label>
                    <Select value={fluxoForm.empresa_id} onValueChange={(v) => setFluxoForm({ ...fluxoForm, empresa_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {empresas.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.razao_social ?? e.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Alvo</Label>
                    <Select value={fluxoForm.alvo} onValueChange={(v) => setFluxoForm({ ...fluxoForm, alvo: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ALVOS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Nome</Label><Input value={fluxoForm.nome ?? ""} onChange={(e) => setFluxoForm({ ...fluxoForm, nome: e.target.value })} /></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>Valor mínimo</Label><Input type="number" value={fluxoForm.valor_min} onChange={(e) => setFluxoForm({ ...fluxoForm, valor_min: parseFloat(e.target.value) || 0 })} /></div>
                    <div><Label>Valor máximo</Label><Input type="number" value={fluxoForm.valor_max ?? ""} onChange={(e) => setFluxoForm({ ...fluxoForm, valor_max: e.target.value ? parseFloat(e.target.value) : null })} /></div>
                  </div>
                </div>
                <DialogFooter><Button onClick={() => criarFluxo.mutate()} disabled={criarFluxo.isPending}>Criar</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardHeader><CardTitle>Fluxos cadastrados</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Nome</TableHead><TableHead>Alvo</TableHead><TableHead>Faixa</TableHead>
                  <TableHead>Ativo</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {fluxos.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">{f.nome}</TableCell>
                      <TableCell><Badge variant="outline">{f.alvo?.toUpperCase()}</Badge></TableCell>
                      <TableCell className="text-sm">R$ {Number(f.valor_min).toLocaleString("pt-BR")} – {f.valor_max ? `R$ ${Number(f.valor_max).toLocaleString("pt-BR")}` : "∞"}</TableCell>
                      <TableCell>{f.ativo ? <Badge>Sim</Badge> : <Badge variant="secondary">Não</Badge>}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => { setFluxoSel(f); setOpenEtapas(true); setEtapaSel(null); }}>
                          <GitBranch className="h-4 w-4 mr-2" />Etapas
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Etapas + aprovadores */}
          <Dialog open={openEtapas} onOpenChange={setOpenEtapas}>
            <DialogContent className="max-w-3xl">
              <DialogHeader><DialogTitle>Etapas de "{fluxoSel?.nome}"</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-2"><Label>Ordem</Label><Input type="number" value={novaEtapa.ordem} onChange={(e) => setNovaEtapa({ ...novaEtapa, ordem: parseInt(e.target.value) || 1 })} /></div>
                  <div className="col-span-4"><Label>Nome</Label><Input value={novaEtapa.nome ?? ""} onChange={(e) => setNovaEtapa({ ...novaEtapa, nome: e.target.value })} /></div>
                  <div className="col-span-3"><Label>Modo</Label>
                    <Select value={novaEtapa.modo} onValueChange={(v) => setNovaEtapa({ ...novaEtapa, modo: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{MODOS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {novaEtapa.modo === "quorum" && (
                    <div className="col-span-2"><Label>Quórum mín.</Label><Input type="number" value={novaEtapa.quorum_minimo ?? ""} onChange={(e) => setNovaEtapa({ ...novaEtapa, quorum_minimo: parseInt(e.target.value) || null })} /></div>
                  )}
                  <div className="col-span-1"><Button size="icon" onClick={() => addEtapa.mutate()}><Plus className="h-4 w-4" /></Button></div>
                </div>

                <Table>
                  <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Nome</TableHead><TableHead>Modo</TableHead><TableHead></TableHead></TableRow></TableHeader>
                  <TableBody>
                    {etapas.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>{e.ordem}</TableCell>
                        <TableCell className="font-medium">{e.nome}</TableCell>
                        <TableCell><Badge variant="outline">{e.modo}{e.modo === "quorum" ? ` (${e.quorum_minimo})` : ""}</Badge></TableCell>
                        <TableCell className="space-x-1">
                          <Button size="sm" variant="ghost" onClick={() => delEtapa.mutate(e.id)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}
