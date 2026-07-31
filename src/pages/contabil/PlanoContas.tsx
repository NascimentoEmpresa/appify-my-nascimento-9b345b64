import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { Plus, Pencil, PowerOff, CheckCircle2, XCircle, Clock, BookOpen } from "lucide-react";
import { PlanoContasPrint } from "@/components/contabil/PlanoContasPrint";

type ContaTipo = "sintetica" | "analitica";
type ContaNatureza = "D" | "C";
type ExigeContrato = "sim" | "nao" | "opcional";
type GrupoDre = "balanco" | "balanco_gerencial" | "dre";
type SolicTipo = "criar" | "alterar" | "inativar";
type SolicStatus = "pendente" | "aprovada" | "rejeitada" | "aplicada" | "erro";

interface Conta {
  id: string;
  classificacao: string;
  descricao: string;
  tipo: ContaTipo;
  natureza: ContaNatureza;
  exige_contrato: ExigeContrato;
  centro_custo_padrao: string | null;
  entra_fluxo: boolean;
  entra_orcamento: boolean;
  parent_id: string | null;
  dre_linha_id: string | null;
  grupo_dre: GrupoDre;
  ativo: boolean;
  conta_reduzida: number;
}

interface Solicitacao {
  id: string;
  tipo: SolicTipo;
  status: SolicStatus;
  classificacao: string | null;
  descricao: string | null;
  tipo_conta: ContaTipo | null;
  natureza: ContaNatureza | null;
  exige_contrato: ExigeContrato | null;
  entra_fluxo: boolean | null;
  entra_orcamento: boolean | null;
  parent_classificacao: string | null;
  dre_linha_id: string | null;
  grupo_dre: GrupoDre | null;
  ativo: boolean | null;
  justificativa: string;
  motivo_decisao: string | null;
  conta_contabil_id: string | null;
  solicitado_por: string;
  solicitado_em: string;
  decidido_por: string | null;
  decidido_em: string | null;
}

export default function PlanoContas() {
  const { user } = useAuth();
  const { can } = usePermissoes();
  const { data: empresaId } = useEmpresaId();
  const qc = useQueryClient();
  const [tab, setTab] = useState("plano");

  const podeAprovar = can("alterar", undefined, "administracao");

  const contasQ = useQuery({
    queryKey: ["conta_contabil", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conta_contabil")
        .select("*")
        .eq("empresa_id", empresaId!)
        .order("classificacao");
      if (error) throw error;
      return (data ?? []) as Conta[];
    },
  });

  const dreQ = useQuery({
    queryKey: ["dre_linhas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("dre_linhas").select("id,codigo,descricao").order("ordem");
      if (error) throw error;
      return data ?? [];
    },
  });

  const solicQ = useQuery({
    queryKey: ["pcs", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plano_contas_solicitacao")
        .select("*")
        .order("solicitado_em", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Solicitacao[];
    },
  });

  const pendentes = useMemo(() => (solicQ.data ?? []).filter((s) => s.status === "pendente"), [solicQ.data]);

  const decidir = useMutation({
    mutationFn: async ({ id, status, motivo }: { id: string; status: "aprovada" | "rejeitada"; motivo: string }) => {
      const { error } = await supabase
        .from("plano_contas_solicitacao")
        .update({ status, motivo_decisao: motivo })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast({ title: vars.status === "aprovada" ? "Solicitação aprovada" : "Solicitação rejeitada" });
      qc.invalidateQueries({ queryKey: ["pcs"] });
      qc.invalidateQueries({ queryKey: ["conta_contabil"] });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  if (!empresaId) {
    return (
      <div>
        <PageHeader module="Contábil" breadcrumb={["Plano de Contas"]} title="Plano de Contas" />
        <div className="card-elevated p-6 text-sm text-muted-foreground">
          É necessário ter uma empresa vinculada ao seu perfil para acessar o plano de contas.
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        module="Contábil"
        breadcrumb={["Plano de Contas"]}
        title="Plano de Contas"
        subtitle="Mudanças exigem aprovação do gerente financeiro, controladoria ou diretor administrativo."
        actions={
          <div className="flex items-center gap-2">
            <PlanoContasPrint contas={contasQ.data ?? []} dreLinhas={dreQ.data ?? []} />
            <NovaContaDialog contas={contasQ.data ?? []} dreLinhas={dreQ.data ?? []} empresaId={empresaId} userId={user?.id ?? ""} onCreated={() => qc.invalidateQueries({ queryKey: ["pcs"] })} />
          </div>
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="plano" className="gap-2"><BookOpen className="h-3.5 w-3.5" />Plano ({contasQ.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="solicitacoes" className="gap-2"><Clock className="h-3.5 w-3.5" />Solicitações {pendentes.length > 0 && <Badge variant="destructive" className="ml-1">{pendentes.length}</Badge>}</TabsTrigger>
        </TabsList>

        <TabsContent value="plano" className="mt-4">
          <div className="card-elevated overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Classif.</th>
                  <th className="px-3 py-2 text-left">Descrição</th>
                  <th className="px-3 py-2 text-left">Tipo</th>
                  <th className="px-3 py-2 text-center">Nat.</th>
                  <th className="px-3 py-2 text-center">Fluxo</th>
                  <th className="px-3 py-2 text-center">Orç.</th>
                  <th className="px-3 py-2 text-center">Ativo</th>
                  <th className="px-3 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {contasQ.isLoading && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Carregando…</td></tr>}
                {(contasQ.data ?? []).map((c) => {
                  const indent = (c.classificacao.match(/\./g)?.length ?? 0) * 16;
                  return (
                    <tr key={c.id} className={`border-t border-border/60 ${!c.ativo ? "opacity-50" : ""}`}>
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-primary" style={{ paddingLeft: 12 + indent }}>{c.classificacao}</td>
                      <td className={`px-3 py-2 ${c.tipo === "sintetica" ? "font-semibold" : ""}`}>{c.descricao}</td>
                      <td className="px-3 py-2 text-xs capitalize">{c.tipo}</td>
                      <td className="px-3 py-2 text-center text-xs">{c.natureza}</td>
                      <td className="px-3 py-2 text-center text-xs">{c.entra_fluxo ? "✓" : "—"}</td>
                      <td className="px-3 py-2 text-center text-xs">{c.entra_orcamento ? "✓" : "—"}</td>
                      <td className="px-3 py-2 text-center text-xs">{c.ativo ? "✓" : "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-1">
                          <AlterarContaDialog conta={c} contas={contasQ.data ?? []} dreLinhas={dreQ.data ?? []} empresaId={empresaId} userId={user?.id ?? ""} onCreated={() => qc.invalidateQueries({ queryKey: ["pcs"] })} />
                          {c.ativo && (
                            <InativarConta conta={c} empresaId={empresaId} userId={user?.id ?? ""} onCreated={() => qc.invalidateQueries({ queryKey: ["pcs"] })} />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="solicitacoes" className="mt-4 space-y-3">
          {solicQ.isLoading && <div className="card-elevated p-6 text-center text-muted-foreground">Carregando…</div>}
          {(solicQ.data ?? []).length === 0 && (
            <div className="card-elevated p-6 text-center text-sm text-muted-foreground">Nenhuma solicitação registrada.</div>
          )}
          {(solicQ.data ?? []).map((s) => (
            <div key={s.id} className="card-elevated p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={s.tipo === "criar" ? "default" : s.tipo === "alterar" ? "secondary" : "destructive"} className="capitalize">{s.tipo}</Badge>
                    <StatusBadge status={s.status} />
                    <span className="text-xs text-muted-foreground">{new Date(s.solicitado_em).toLocaleString("pt-BR")}</span>
                  </div>
                  <p className="mt-2 font-medium">
                    {s.classificacao && <span className="font-mono text-primary mr-2">{s.classificacao}</span>}
                    {s.descricao || (s.conta_contabil_id ? "Alteração em conta existente" : "—")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground"><strong>Justificativa:</strong> {s.justificativa}</p>
                  {s.motivo_decisao && <p className="mt-1 text-xs"><strong>Decisão:</strong> {s.motivo_decisao}</p>}
                </div>
                {s.status === "pendente" && podeAprovar && (
                  <div className="flex gap-2">
                    <DecidirDialog id={s.id} acao="aprovada" onConfirm={(motivo) => decidir.mutate({ id: s.id, status: "aprovada", motivo })} />
                    <DecidirDialog id={s.id} acao="rejeitada" onConfirm={(motivo) => decidir.mutate({ id: s.id, status: "rejeitada", motivo })} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatusBadge({ status }: { status: SolicStatus }) {
  const map: Record<SolicStatus, { label: string; variant: any; icon: any }> = {
    pendente: { label: "Pendente", variant: "outline", icon: Clock },
    aprovada: { label: "Aprovada", variant: "default", icon: CheckCircle2 },
    aplicada: { label: "Aplicada", variant: "default", icon: CheckCircle2 },
    rejeitada: { label: "Rejeitada", variant: "destructive", icon: XCircle },
    erro: { label: "Erro", variant: "destructive", icon: XCircle },
  };
  const { label, variant, icon: Icon } = map[status];
  return <Badge variant={variant} className="gap-1"><Icon className="h-3 w-3" />{label}</Badge>;
}

interface FormProps {
  contas: Conta[];
  dreLinhas: { id: string; codigo: string; descricao: string }[];
  empresaId: string;
  userId: string;
  onCreated: () => void;
}

function NovaContaDialog({ contas, dreLinhas, empresaId, userId, onCreated }: FormProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    classificacao: "",
    descricao: "",
    tipo_conta: "analitica" as ContaTipo,
    natureza: "D" as ContaNatureza,
    exige_contrato: "nao" as ExigeContrato,
    entra_fluxo: false,
    entra_orcamento: false,
    parent_classificacao: "",
    dre_linha_id: "",
    grupo_dre: "balanco" as GrupoDre,
    justificativa: "",
  });

  const enviar = async () => {
    if (!form.classificacao || !form.descricao || !form.justificativa) {
      toast({ title: "Campos obrigatórios", description: "Classificação, descrição e justificativa.", variant: "destructive" });
      return;
    }
    const payload: Database["public"]["Tables"]["plano_contas_solicitacao"]["Insert"] = {
      empresa_id: empresaId,
      tipo: "criar",
      classificacao: form.classificacao,
      descricao: form.descricao,
      tipo_conta: form.tipo_conta,
      natureza: form.natureza,
      exige_contrato: form.exige_contrato,
      entra_fluxo: form.entra_fluxo,
      entra_orcamento: form.entra_orcamento,
      parent_classificacao: form.parent_classificacao || null,
      dre_linha_id: form.dre_linha_id || null,
      grupo_dre: form.grupo_dre,
      ativo: true,
      justificativa: form.justificativa,
      solicitado_por: userId,
    };
    const { error } = await supabase.from("plano_contas_solicitacao").insert(payload);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Solicitação enviada", description: "Aguardando aprovação." });
    setOpen(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2"><Plus className="h-4 w-4" />Nova conta</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Solicitar nova conta</DialogTitle>
          <DialogDescription>A criação será aplicada após aprovação.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Classificação *</Label><Input value={form.classificacao} onChange={(e) => setForm({ ...form, classificacao: e.target.value })} placeholder="01.1.1.05" /></div>
          <div><Label>Descrição *</Label><Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></div>
          <div><Label>Tipo</Label>
            <Select value={form.tipo_conta} onValueChange={(v) => setForm({ ...form, tipo_conta: v as ContaTipo })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="analitica">Analítica</SelectItem><SelectItem value="sintetica">Sintética</SelectItem></SelectContent>
            </Select>
          </div>
          <div><Label>Natureza</Label>
            <Select value={form.natureza} onValueChange={(v) => setForm({ ...form, natureza: v as ContaNatureza })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="D">Devedora (D)</SelectItem><SelectItem value="C">Credora (C)</SelectItem></SelectContent>
            </Select>
          </div>
          <div><Label>Exige contrato</Label>
            <Select value={form.exige_contrato} onValueChange={(v) => setForm({ ...form, exige_contrato: v as ExigeContrato })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="nao">Não</SelectItem><SelectItem value="sim">Sim</SelectItem><SelectItem value="opcional">Opcional</SelectItem></SelectContent>
            </Select>
          </div>
          <div><Label>Grupo DRE</Label>
            <Select value={form.grupo_dre} onValueChange={(v) => setForm({ ...form, grupo_dre: v as GrupoDre })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="balanco">Balanço</SelectItem><SelectItem value="balanco_gerencial">Balanço Gerencial</SelectItem><SelectItem value="dre">DRE</SelectItem></SelectContent>
            </Select>
          </div>
          <div><Label>Conta pai (classificação)</Label>
            <Select value={form.parent_classificacao || "_none"} onValueChange={(v) => setForm({ ...form, parent_classificacao: v === "_none" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— Nenhuma —</SelectItem>
                {contas.filter((c) => c.tipo === "sintetica").map((c) => (
                  <SelectItem key={c.id} value={c.classificacao}>{c.classificacao} — {c.descricao}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Linha DRE</Label>
            <Select value={form.dre_linha_id || "_none"} onValueChange={(v) => setForm({ ...form, dre_linha_id: v === "_none" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— Nenhuma —</SelectItem>
                {dreLinhas.map((d) => <SelectItem key={d.id} value={d.id}>{d.codigo} — {d.descricao}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.entra_fluxo} onCheckedChange={(v) => setForm({ ...form, entra_fluxo: v })} />Entra no fluxo</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.entra_orcamento} onCheckedChange={(v) => setForm({ ...form, entra_orcamento: v })} />Entra no orçamento</label>
          </div>
          <div className="col-span-2"><Label>Justificativa *</Label><Textarea value={form.justificativa} onChange={(e) => setForm({ ...form, justificativa: e.target.value })} rows={3} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={enviar}>Enviar para aprovação</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AlterarContaDialog({ conta, contas, dreLinhas, empresaId, userId, onCreated }: FormProps & { conta: Conta }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    descricao: conta.descricao,
    natureza: conta.natureza,
    exige_contrato: conta.exige_contrato,
    entra_fluxo: conta.entra_fluxo,
    entra_orcamento: conta.entra_orcamento,
    dre_linha_id: conta.dre_linha_id ?? "",
    grupo_dre: conta.grupo_dre,
    justificativa: "",
  });

  const enviar = async () => {
    if (!form.justificativa) {
      toast({ title: "Justificativa obrigatória", variant: "destructive" });
      return;
    }
    const payload: Database["public"]["Tables"]["plano_contas_solicitacao"]["Insert"] = {
      empresa_id: empresaId,
      tipo: "alterar",
      conta_contabil_id: conta.id,
      classificacao: conta.classificacao,
      descricao: form.descricao,
      natureza: form.natureza,
      exige_contrato: form.exige_contrato,
      entra_fluxo: form.entra_fluxo,
      entra_orcamento: form.entra_orcamento,
      dre_linha_id: form.dre_linha_id || null,
      grupo_dre: form.grupo_dre,
      justificativa: form.justificativa,
      solicitado_por: userId,
    };
    const { error } = await supabase.from("plano_contas_solicitacao").insert(payload);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Solicitação enviada" });
    setOpen(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost" className="h-7 w-7 p-0"><Pencil className="h-3.5 w-3.5" /></Button></DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Alterar {conta.classificacao}</DialogTitle>
          <DialogDescription>{conta.descricao}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Descrição</Label><Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></div>
          <div><Label>Natureza</Label>
            <Select value={form.natureza} onValueChange={(v) => setForm({ ...form, natureza: v as ContaNatureza })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="D">Devedora</SelectItem><SelectItem value="C">Credora</SelectItem></SelectContent>
            </Select>
          </div>
          <div><Label>Exige contrato</Label>
            <Select value={form.exige_contrato} onValueChange={(v) => setForm({ ...form, exige_contrato: v as ExigeContrato })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="nao">Não</SelectItem><SelectItem value="sim">Sim</SelectItem><SelectItem value="opcional">Opcional</SelectItem></SelectContent>
            </Select>
          </div>
          <div><Label>Linha DRE</Label>
            <Select value={form.dre_linha_id || "_none"} onValueChange={(v) => setForm({ ...form, dre_linha_id: v === "_none" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— Nenhuma —</SelectItem>
                {dreLinhas.map((d) => <SelectItem key={d.id} value={d.id}>{d.codigo} — {d.descricao}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Grupo DRE</Label>
            <Select value={form.grupo_dre} onValueChange={(v) => setForm({ ...form, grupo_dre: v as GrupoDre })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="balanco">Balanço</SelectItem><SelectItem value="balanco_gerencial">Balanço Gerencial</SelectItem><SelectItem value="dre">DRE</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.entra_fluxo} onCheckedChange={(v) => setForm({ ...form, entra_fluxo: v })} />Entra no fluxo</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.entra_orcamento} onCheckedChange={(v) => setForm({ ...form, entra_orcamento: v })} />Entra no orçamento</label>
          </div>
          <div className="col-span-2"><Label>Justificativa *</Label><Textarea value={form.justificativa} onChange={(e) => setForm({ ...form, justificativa: e.target.value })} rows={3} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={enviar}>Enviar para aprovação</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InativarConta({ conta, empresaId, userId, onCreated }: { conta: Conta; empresaId: string; userId: string; onCreated: () => void }) {
  const [motivo, setMotivo] = useState("");
  const enviar = async () => {
    if (!motivo) { toast({ title: "Justificativa obrigatória", variant: "destructive" }); return; }
    const payload: Database["public"]["Tables"]["plano_contas_solicitacao"]["Insert"] = {
      empresa_id: empresaId,
      tipo: "inativar",
      conta_contabil_id: conta.id,
      classificacao: conta.classificacao,
      ativo: false,
      justificativa: motivo,
      solicitado_por: userId,
    };
    const { error } = await supabase.from("plano_contas_solicitacao").insert(payload);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Solicitação enviada" });
    setMotivo("");
    onCreated();
  };
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild><Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive"><PowerOff className="h-3.5 w-3.5" /></Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Solicitar inativação?</AlertDialogTitle>
          <AlertDialogDescription>{conta.classificacao} — {conta.descricao}. Justifique abaixo:</AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={enviar}>Enviar solicitação</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DecidirDialog({ acao, onConfirm }: { id: string; acao: "aprovada" | "rejeitada"; onConfirm: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState("");
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant={acao === "aprovada" ? "default" : "destructive"} className="gap-1">
          {acao === "aprovada" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          {acao === "aprovada" ? "Aprovar" : "Rejeitar"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{acao === "aprovada" ? "Aprovar solicitação?" : "Rejeitar solicitação?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {acao === "aprovada"
              ? "A mudança será aplicada imediatamente no plano de contas da empresa."
              : "A solicitação será marcada como rejeitada e nada será alterado."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Motivo / observação (opcional)" />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => onConfirm(motivo)}>Confirmar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
