import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { usePermissoes } from "@/context/PermissoesContext";
import { Plus, Trash2, AlertTriangle, Workflow, Users, ShieldCheck } from "lucide-react";
import { GestoresCCPanel } from "./GestoresCCPanel";
import { SaudeAlcadasPanel } from "./SaudeAlcadasPanel";

const fmt = (v: number | null) =>
  v === null ? "sem teto" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const ALVO_LABEL: Record<string, string> = {
  requisicao_compra: "Requisição de compra",
  pedido_compra: "Pedido de compra",
  licitacao_etapa: "Licitação",
  programacao_pagamento: "Programação de pagamento",
};

const TIPO_PARECER_LABEL: Record<string, { label: string; tone: string }> = {
  bloqueante: { label: "Bloqueante", tone: "bg-destructive/15 text-destructive border-destructive/30" },
  consultivo: { label: "Consultivo", tone: "bg-blue-500/15 text-blue-700 border-blue-300" },
  ciencia:    { label: "Ciência",    tone: "bg-muted text-muted-foreground border-border" },
};

export function AlcadasTab() {
  const qc = useQueryClient();
  const { can, empresaId } = usePermissoes();
  const podeGerenciar = can("alterar", undefined, "administracao");
  const [empresaSel, setEmpresaSel] = useState<string>("");

  const empresasQ = useQuery({
    queryKey: ["empresas-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id,codigo,razao_social,auto_aprovar_orcamento_cc,vincular_orcamento_padrao").order("razao_social");
      if (error) throw error;
      return data ?? [];
    },
  });

  const eid = empresaSel || empresaId || (empresasQ.data?.[0]?.id ?? "");

  return (
    <section className="card-elevated">
      <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div>
          <h2 className="font-display text-sm font-bold">Alçadas de aprovação</h2>
          <p className="text-xs text-muted-foreground">Fluxos, réguas de escalonamento e legado.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={eid} onValueChange={(v) => setEmpresaSel(v)}>
            <SelectTrigger className="h-9 w-72 text-xs">
              <SelectValue placeholder="Selecionar empresa" />
            </SelectTrigger>
            <SelectContent>
              {(empresasQ.data ?? []).map((e: any) => (
                <SelectItem key={e.id} value={e.id}>{e.codigo} — {e.razao_social}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <Tabs defaultValue="fluxos" className="p-5">
        <TabsList>
          <TabsTrigger value="fluxos"><Workflow className="h-3.5 w-3.5 mr-1.5" />Fluxos</TabsTrigger>
          <TabsTrigger value="gestores-cc"><Users className="h-3.5 w-3.5 mr-1.5" />Gestores de CC</TabsTrigger>
          <TabsTrigger value="reguas">Réguas de escalonamento</TabsTrigger>
          <TabsTrigger value="saude"><ShieldCheck className="h-3.5 w-3.5 mr-1.5" />Saúde</TabsTrigger>
          <TabsTrigger value="legado"><AlertTriangle className="h-3.5 w-3.5 mr-1.5" />Legado</TabsTrigger>
        </TabsList>

        <TabsContent value="fluxos" className="mt-4">
          {eid && <FluxosPanel empresaId={eid} podeGerenciar={podeGerenciar} empresa={(empresasQ.data ?? []).find((e: any) => e.id === eid)} />}
        </TabsContent>

        <TabsContent value="gestores-cc" className="mt-4">
          {eid && <GestoresCCPanel empresaId={eid} podeGerenciar={podeGerenciar} empresa={(empresasQ.data ?? []).find((e: any) => e.id === eid)} />}
        </TabsContent>

        <TabsContent value="reguas" className="mt-4">
          <ReguasPanel podeGerenciar={podeGerenciar} />
        </TabsContent>

        <TabsContent value="saude" className="mt-4">
          <SaudeAlcadasPanel />
        </TabsContent>

        <TabsContent value="legado" className="mt-4">
          {eid && <LegadoPanel empresaId={eid} />}
        </TabsContent>
      </Tabs>
    </section>
  );
}

// ============================================================
// FLUXOS
// ============================================================
function FluxosPanel({ empresaId, podeGerenciar, empresa }: { empresaId: string; podeGerenciar: boolean; empresa: any }) {
  const qc = useQueryClient();

  const fluxosQ = useQuery({
    queryKey: ["sup_aprov_fluxo", empresaId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sup_aprov_fluxo")
        .select("*")
        .eq("empresa_id", empresaId)
        .order("alvo")
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const toggleAutoOrc = async (val: boolean) => {
    const { error } = await supabase.from("empresas").update({ auto_aprovar_orcamento_cc: val } as any).eq("id", empresaId);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["empresas-all"] });
    toast({ title: val ? "Auto-aprovação por orçamento ATIVA" : "Auto-aprovação por orçamento DESATIVADA" });
  };

  const toggleVincOrc = async (val: boolean) => {
    const { error } = await supabase.from("empresas").update({ vincular_orcamento_padrao: val } as any).eq("id", empresaId);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["empresas-all"] });
    toast({ title: val ? "Vincular orçamento ATIVO (padrão da empresa)" : "Vincular orçamento DESATIVADO (padrão da empresa)" });
  };

  return (
    <div className="space-y-4">
      {/* Flag de auto-aprovação */}
      {empresa && (
        <div className="rounded-lg border border-border bg-muted/20 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Auto-aprovação por orçamento do CC</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Quando ativa, etapas com regra <code className="text-[10px]">orcamento_cc</code> em <strong>Pedido de compra</strong> são aprovadas automaticamente se houver saldo no CC dentro da vigência.
              </p>
            </div>
            <Button size="sm" variant={empresa.auto_aprovar_orcamento_cc ? "default" : "outline"} onClick={() => toggleAutoOrc(!empresa.auto_aprovar_orcamento_cc)} disabled={!podeGerenciar}>
              {empresa.auto_aprovar_orcamento_cc ? "Ativa" : "Inativa"}
            </Button>
          </div>
        </div>
      )}

      {/* Flag de vincular orçamento (3 níveis: Empresa → CC → Etapa) */}
      {empresa && (
        <div className="rounded-lg border border-border bg-muted/20 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Vincular orçamento (padrão da empresa)</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Quando ativo, requisições que <strong>estouram o orçamento do CC</strong> exigem uma 2ª etapa de aprovação ("ultrapassar orçamento"). Pode ser sobrescrito por CC (Controladoria → Centros de Custo) ou por etapa (campo <code className="text-[10px]">regra_auto.vincular_orcamento</code>).
              </p>
            </div>
            <Button size="sm" variant={empresa.vincular_orcamento_padrao ? "default" : "outline"} onClick={() => toggleVincOrc(!empresa.vincular_orcamento_padrao)} disabled={!podeGerenciar}>
              {empresa.vincular_orcamento_padrao ? "Ativo" : "Inativo"}
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">Fluxos cadastrados</h3>
        {podeGerenciar && <NovoFluxo empresaId={empresaId} onSaved={() => qc.invalidateQueries({ queryKey: ["sup_aprov_fluxo", empresaId] })} />}
      </div>

      {fluxosQ.isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
      {!fluxosQ.isLoading && (fluxosQ.data ?? []).length === 0 && (
        <p className="text-xs text-muted-foreground">Nenhum fluxo cadastrado. Crie um para começar.</p>
      )}

      <div className="space-y-3">
        {(fluxosQ.data ?? []).map((f: any) => (
          <FluxoCard key={f.id} fluxo={f} podeGerenciar={podeGerenciar} onChanged={() => qc.invalidateQueries({ queryKey: ["sup_aprov_fluxo", empresaId] })} />
        ))}
      </div>
    </div>
  );
}

function FluxoCard({ fluxo, podeGerenciar, onChanged }: { fluxo: any; podeGerenciar: boolean; onChanged: () => void }) {
  const qc = useQueryClient();
  const etapasQ = useQuery({
    queryKey: ["sup_aprov_etapa-template", fluxo.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sup_aprov_etapa")
        .select("*")
        .eq("fluxo_id", fluxo.id)
        .is("instancia_id", null) // só templates
        .order("ordem");
      if (error) throw error;
      return data ?? [];
    },
  });

  const removerFluxo = async () => {
    if (!confirm(`Excluir fluxo "${fluxo.nome}"? As instâncias em andamento NÃO serão afetadas.`)) return;
    const { error } = await (supabase as any).from("sup_aprov_fluxo").update({ ativo: false }).eq("id", fluxo.id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    onChanged();
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{ALVO_LABEL[fluxo.alvo] ?? fluxo.alvo}</Badge>
            <h4 className="text-sm font-bold">{fluxo.nome}</h4>
            {!fluxo.ativo && <Badge variant="secondary">Inativo</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {podeGerenciar && <NovaEtapa fluxoId={fluxo.id} proximaOrdem={(etapasQ.data?.length ?? 0) + 1} onSaved={() => qc.invalidateQueries({ queryKey: ["sup_aprov_etapa-template", fluxo.id] })} />}
          {podeGerenciar && fluxo.ativo && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={removerFluxo}><Trash2 className="h-3.5 w-3.5" /></Button>
          )}
        </div>
      </div>

      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left w-10">Ordem</th>
            <th className="px-3 py-2 text-left">Etapa</th>
            <th className="px-3 py-2 text-left">Parecer</th>
            <th className="px-3 py-2 text-right">Faixa de valor</th>
            <th className="px-3 py-2 text-left">Prazo (h)</th>
            <th className="px-3 py-2 text-left">Regra auto</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {(etapasQ.data ?? []).length === 0 && (
            <tr><td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">Nenhuma etapa-template. Etapas dinâmicas (ex.: Requisição) são criadas por instância.</td></tr>
          )}
          {(etapasQ.data ?? []).map((e: any) => {
            const tp = TIPO_PARECER_LABEL[e.tipo_parecer] ?? TIPO_PARECER_LABEL.consultivo;
            return (
              <tr key={e.id}>
                <td className="px-3 py-2 font-mono">{e.ordem}</td>
                <td className="px-3 py-2 font-medium">{e.nome}</td>
                <td className="px-3 py-2"><Badge variant="outline" className={tp.tone}>{tp.label}</Badge></td>
                <td className="px-3 py-2 text-right font-mono">{fmt(Number(e.valor_min ?? 0))} – {fmt(e.valor_max === null ? null : Number(e.valor_max))}</td>
                <td className="px-3 py-2">{e.prazo_horas ?? "—"}</td>
                <td className="px-3 py-2"><code className="text-[10px]">{e.regra_auto?.tipo ?? "—"}</code></td>
                <td className="px-3 py-2 text-right">
                  {podeGerenciar && (
                    <Button size="sm" variant="ghost" className="text-destructive h-7 w-7 p-0" onClick={async () => {
                      if (!confirm(`Excluir etapa "${e.nome}"?`)) return;
                      const { error } = await (supabase as any).from("sup_aprov_etapa").delete().eq("id", e.id);
                      if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
                      qc.invalidateQueries({ queryKey: ["sup_aprov_etapa-template", fluxo.id] });
                    }}><Trash2 className="h-3 w-3" /></Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NovoFluxo({ empresaId, onSaved }: { empresaId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [alvo, setAlvo] = useState("pedido_compra");
  const [nome, setNome] = useState("");
  const [saving, setSaving] = useState(false);

  const salvar = async () => {
    if (!nome.trim()) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
    setSaving(true);
    const { error } = await (supabase as any).from("sup_aprov_fluxo").insert({
      empresa_id: empresaId, alvo, nome: nome.trim(), ativo: true,
    });
    setSaving(false);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Fluxo criado" });
    setOpen(false); setNome(""); setAlvo("pedido_compra");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Novo fluxo</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo fluxo de aprovação</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Alvo</Label>
            <Select value={alvo} onValueChange={setAlvo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(ALVO_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Nome do fluxo</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Pedido de compra padrão" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NovaEtapa({ fluxoId, proximaOrdem, onSaved }: { fluxoId: string; proximaOrdem: number; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [tipoParecer, setTipoParecer] = useState("bloqueante");
  const [responsavelId, setResponsavelId] = useState("");
  const [vmin, setVmin] = useState("0");
  const [vmax, setVmax] = useState("");
  const [prazo, setPrazo] = useState("48");
  const [regraAuto, setRegraAuto] = useState(false);
  const [saving, setSaving] = useState(false);

  const usuariosQ = useQuery({
    enabled: open,
    queryKey: ["profiles-aprovadores"],
    queryFn: async () => (await supabase.from("profiles").select("id, display_name, email").eq("ativo", true).order("display_name")).data ?? [],
  });

  const salvar = async () => {
    if (!nome.trim()) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
    if (!responsavelId) { toast({ title: "Responsável obrigatório", variant: "destructive" }); return; }
    setSaving(true);
    const { error } = await (supabase as any).from("sup_aprov_etapa").insert({
      fluxo_id: fluxoId,
      ordem: proximaOrdem,
      nome: nome.trim(),
      tipo_parecer: tipoParecer,
      responsavel_user_id: responsavelId,
      valor_min: Number(vmin) || 0,
      valor_max: vmax ? Number(vmax) : null,
      prazo_horas: Number(prazo) || null,
      regra_auto: regraAuto ? { tipo: "orcamento_cc" } : null,
      ativo: true,
    });
    setSaving(false);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Etapa adicionada" });
    setOpen(false);
    setNome(""); setResponsavelId(""); setVmin("0"); setVmax(""); setPrazo("48"); setRegraAuto(false); setTipoParecer("bloqueante");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Etapa</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nova etapa do fluxo</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Nome da etapa</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Gerente, Diretoria" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Tipo de parecer</Label>
              <Select value={tipoParecer} onValueChange={setTipoParecer}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bloqueante">Bloqueante (decide o fluxo)</SelectItem>
                  <SelectItem value="consultivo">Consultivo (opinião)</SelectItem>
                  <SelectItem value="ciencia">Ciência (apenas notificação)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Prazo (horas)</Label>
              <Input type="number" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Responsável (usuário cadastrado)</Label>
            <Select value={responsavelId} onValueChange={setResponsavelId}>
              <SelectTrigger><SelectValue placeholder="— Selecione —" /></SelectTrigger>
              <SelectContent>
                {(usuariosQ.data ?? []).map((u: any) => (
                  <SelectItem key={u.id} value={u.id}>{u.display_name || u.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Valor mínimo (R$)</Label><Input type="number" value={vmin} onChange={(e) => setVmin(e.target.value)} /></div>
            <div><Label>Valor máximo (R$)</Label><Input type="number" value={vmax} onChange={(e) => setVmax(e.target.value)} placeholder="vazio = sem teto" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={regraAuto} onChange={(e) => setRegraAuto(e.target.checked)} className="h-4 w-4" />
            Auto-aprovar se há saldo no orçamento do CC
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// RÉGUAS DE ESCALONAMENTO
// ============================================================
function ReguasPanel({ podeGerenciar }: { podeGerenciar: boolean }) {
  const reguasQ = useQuery({
    queryKey: ["sup_aprov_regua"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sup_aprov_regua_escalonamento")
        .select("*, sup_aprov_regua_degrau(*)")
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Réguas controlam quem é notificado e quando, conforme o prazo da etapa avança. CRUD completo virá numa próxima iteração — por enquanto, apenas leitura.
      </p>
      {reguasQ.isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
      {(reguasQ.data ?? []).length === 0 && !reguasQ.isLoading && (
        <p className="text-xs text-muted-foreground">Nenhuma régua cadastrada.</p>
      )}
      {(reguasQ.data ?? []).map((r: any) => (
        <div key={r.id} className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold">{r.nome}</h4>
              <Badge variant="outline">{r.criticidade ?? "normal"}</Badge>
            </div>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Ordem</th>
                <th className="px-3 py-2 text-left">% Prazo</th>
                <th className="px-3 py-2 text-left">Horas extra</th>
                <th className="px-3 py-2 text-left">Destinatários</th>
                <th className="px-3 py-2 text-left">Canais</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(r.sup_aprov_regua_degrau ?? []).sort((a: any, b: any) => a.ordem - b.ordem).map((d: any) => (
                <tr key={d.id}>
                  <td className="px-3 py-2 font-mono">{d.ordem}</td>
                  <td className="px-3 py-2">{d.pct_prazo ?? "—"}</td>
                  <td className="px-3 py-2">{d.horas_extra ?? "—"}</td>
                  <td className="px-3 py-2 text-[11px]">{JSON.stringify(d.destinatarios)}</td>
                  <td className="px-3 py-2 text-[11px]">{JSON.stringify(d.canais)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// LEGADO (alcada_aprovacao antiga)
// ============================================================
interface Alcada {
  id: string; empresa_id: string; etapa: string;
  responsavel_user_id: string | null; responsavel_nome: string | null;
  valor_min: number; valor_max: number | null;
  excecao: string | null; ordem: number; ativo: boolean;
}

function LegadoPanel({ empresaId }: { empresaId: string }) {
  const alcadasQ = useQuery({
    queryKey: ["alcada_aprovacao", empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alcada_aprovacao")
        .select("*")
        .eq("empresa_id", empresaId)
        .order("ordem")
        .order("valor_min");
      if (error) throw error;
      return (data ?? []) as Alcada[];
    },
  });

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="text-xs">
          <p className="font-medium text-amber-900 dark:text-amber-200">Tabela legada (somente leitura)</p>
          <p className="text-amber-800/80 dark:text-amber-300/80 mt-0.5">
            Esses registros foram migrados automaticamente para o novo motor (Fluxos). Mantidos aqui para auditoria.
          </p>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-5 py-3 text-left">Etapa</th>
            <th className="px-3 py-3 text-left">Responsável</th>
            <th className="px-3 py-3 text-right">Valor mín.</th>
            <th className="px-3 py-3 text-right">Valor máx.</th>
            <th className="px-3 py-3 text-left">Exceção</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {alcadasQ.isLoading && <tr><td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">Carregando…</td></tr>}
          {!alcadasQ.isLoading && (alcadasQ.data ?? []).length === 0 && (
            <tr><td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">Nenhuma alçada legada.</td></tr>
          )}
          {(alcadasQ.data ?? []).map((a) => (
            <tr key={a.id} className="hover:bg-muted/40">
              <td className="px-5 py-3 font-medium">{a.etapa}</td>
              <td className="px-3 py-3 text-xs">{a.responsavel_nome ?? "—"}</td>
              <td className="px-3 py-3 text-right font-mono text-xs">{fmt(Number(a.valor_min))}</td>
              <td className="px-3 py-3 text-right font-mono text-xs">{fmt(a.valor_max === null ? null : Number(a.valor_max))}</td>
              <td className="px-3 py-3 text-xs text-muted-foreground">{a.excecao ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
