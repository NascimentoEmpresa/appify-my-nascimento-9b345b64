import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { useContratosSelecao, type ContratoSelecao } from "@/hooks/useContratosERP";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, FileText, Send, CheckCircle2, XCircle, Clock, Eye, AlertTriangle } from "lucide-react";

function OrcamentoBadge({ empresaId, centroCustoId, valor }: { empresaId: string | null; centroCustoId: string; valor: number }) {
  const enabled = !!(empresaId && centroCustoId && valor > 0);
  const q = useQuery({
    queryKey: ["rc_orc_check", empresaId, centroCustoId, valor],
    enabled,
    queryFn: async () => {
      const [vinc, temOrc] = await Promise.all([
        (supabase as any).rpc("sup_aprov_vincula_orcamento", { _empresa_id: empresaId, _centro_custo_id: centroCustoId }),
        (supabase as any).rpc("sup_aprov_tem_orcamento_cc", { _centro_custo_id: centroCustoId, _valor: valor, _periodo: null }),
      ]);
      return {
        vincula: vinc.data === true,
        temOrcamento: temOrc.data === true,
      };
    },
  });
  if (!enabled || !q.data) return null;
  const { vincula, temOrcamento } = q.data;
  if (temOrcamento) {
    return (
      <div className="mt-2 flex items-center justify-end gap-2 text-xs text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> Há saldo no orçamento do CC para este valor.
      </div>
    );
  }
  if (vincula) {
    return (
      <div className="mt-2 flex items-start justify-end gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span><strong>Sem saldo no CC.</strong> Esta requisição abrirá <strong>2 etapas bloqueantes</strong> (retirada + ultrapassar orçamento), cada uma exigindo justificativa.</span>
      </div>
    );
  }
  return (
    <div className="mt-2 flex items-center justify-end gap-2 text-xs text-muted-foreground">
      <AlertTriangle className="h-3.5 w-3.5" /> Sem saldo no CC. "Vincular orçamento" desativado — segue só com a aprovação de retirada.
    </div>
  );
}

type RC = any;
type RCItem = any;

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  rascunho: { label: "Rascunho", tone: "bg-muted text-muted-foreground" },
  enviada: { label: "Enviada", tone: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
  em_validacao_estoque: { label: "Validando Estoque", tone: "bg-amber-500/15 text-amber-700" },
  parcialmente_atendida_por_estoque: { label: "Parcial Estoque", tone: "bg-amber-500/15 text-amber-700" },
  aguardando_budget: { label: "Aguardando Budget", tone: "bg-amber-500/15 text-amber-700" },
  bloqueada_sem_budget: { label: "Sem Budget", tone: "bg-destructive/15 text-destructive" },
  aguardando_aprovacao: { label: "Aguardando Aprovação", tone: "bg-amber-500/15 text-amber-700" },
  aprovada: { label: "Aprovada", tone: "bg-emerald-500/15 text-emerald-700" },
  em_compras: { label: "Em Compras", tone: "bg-blue-500/15 text-blue-700" },
  pedido_gerado: { label: "Pedido Gerado", tone: "bg-blue-500/15 text-blue-700" },
  parcialmente_atendida: { label: "Parcial", tone: "bg-amber-500/15 text-amber-700" },
  atendida_total: { label: "Atendida", tone: "bg-emerald-500/15 text-emerald-700" },
  cancelada: { label: "Cancelada", tone: "bg-muted text-muted-foreground" },
  rejeitada: { label: "Rejeitada", tone: "bg-destructive/15 text-destructive" },
};

const TIPO_OPTS = [
  { value: "material", label: "Material" },
  { value: "servico", label: "Serviço" },
  { value: "custo_direto", label: "Custo Direto (Contrato)" },
  { value: "administrativo", label: "Administrativo" },
];

const PRIORIDADE_OPTS = [
  { value: "baixa", label: "Baixa" },
  { value: "normal", label: "Normal" },
  { value: "alta", label: "Alta" },
  { value: "urgente", label: "Urgente" },
];

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, tone: "bg-muted" };
  return <Badge className={s.tone} variant="outline">{s.label}</Badge>;
}

export default function Requisicoes() {
  const { user } = useAuth();
  const { data: empresaId } = useEmpresaId();
  const qc = useQueryClient();
  const [openForm, setOpenForm] = useState(false);
  const [openDetail, setOpenDetail] = useState<string | null>(null);

  const { data: rcs = [], isLoading } = useQuery({
    queryKey: ["rc_v2"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("requisicao_compra")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as RC[];
    },
  });

  const { data: ccs = [] } = useQuery({
    queryKey: ["cc_lookup"],
    queryFn: async () => (await supabase.from("centros_custo").select("id,codigo,nome").eq("ativo", true).order("codigo")).data ?? [],
  });
  const { data: contratos = [] } = useContratosSelecao();

  const stats = useMemo(() => {
    const open = rcs.filter((r) => !["atendida_total", "cancelada", "rejeitada"].includes(r.status_v2)).length;
    const aprov = rcs.filter((r) => r.status_v2 === "aguardando_aprovacao").length;
    const blocked = rcs.filter((r) => r.status_v2 === "bloqueada_sem_budget").length;
    return { total: rcs.length, open, aprov, blocked };
  }, [rcs]);

  return (
    <div>
      <PageHeader
        title="Requisições de Compra"
        subtitle="Solicitações internas que originam pedidos de compra e validações de estoque/orçamento."
        module="Suprimentos"
        actions={
          <Button onClick={() => setOpenForm(true)}>
            <Plus className="h-4 w-4 mr-2" /> Nova Requisição
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total" value={stats.total} icon={<FileText className="h-4 w-4" />} />
        <KpiCard label="Em aberto" value={stats.open} icon={<Clock className="h-4 w-4 text-amber-600" />} />
        <KpiCard label="Aguardando aprovação" value={stats.aprov} icon={<CheckCircle2 className="h-4 w-4 text-blue-600" />} />
        <KpiCard label="Bloqueadas" value={stats.blocked} icon={<XCircle className="h-4 w-4 text-destructive" />} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Requisições</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Carregando…</p>
          ) : rcs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma requisição cadastrada.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Prioridade</TableHead>
                  <TableHead>Necessidade</TableHead>
                  <TableHead>Estimado</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rcs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.numero}</TableCell>
                    <TableCell><Badge variant="outline">{r.tipo}</Badge></TableCell>
                    <TableCell><Badge variant="outline">{r.prioridade}</Badge></TableCell>
                    <TableCell>{r.data_necessidade ? new Date(r.data_necessidade).toLocaleDateString("pt-BR") : "—"}</TableCell>
                    <TableCell>{Number(r.valor_estimado ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                    <TableCell><StatusBadge status={r.status_v2} /></TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setOpenDetail(r.id)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {openForm && (
        <NovaRCDialog
          empresaId={empresaId ?? null}
          userId={user?.id ?? null}
          ccs={ccs}
          contratos={contratos}
          onClose={() => setOpenForm(false)}
          onCreated={() => {
            setOpenForm(false);
            qc.invalidateQueries({ queryKey: ["rc_v2"] });
          }}
        />
      )}

      {openDetail && (
        <RCDetailDialog
          rcId={openDetail}
          onClose={() => setOpenDetail(null)}
          onChanged={() => qc.invalidateQueries({ queryKey: ["rc_v2"] })}
        />
      )}
    </div>
  );
}

function KpiCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="text-2xl font-semibold mt-1">{value}</p>
          </div>
          <div className="p-2 rounded-md bg-muted">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ItemDraft {
  id?: string;
  descricao: string;
  unidade: string;
  quantidade: number;
  preco_estimado: number;
}

function NovaRCDialog({
  empresaId, userId, ccs, contratos, onClose, onCreated,
}: {
  empresaId: string | null; userId: string | null;
  ccs: any[]; contratos: ContratoSelecao[];
  onClose: () => void; onCreated: () => void;
}) {
  const [numero, setNumero] = useState("RC-" + new Date().getFullYear() + "-" + String(Math.floor(Math.random() * 9999)).padStart(4, "0"));
  const [tipo, setTipo] = useState("material");
  const [prioridade, setPrioridade] = useState("normal");
  const [centroCustoId, setCentroCustoId] = useState<string>("");
  const [contratoId, setContratoId] = useState<string>("");
  const [dataNecessidade, setDataNecessidade] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([
    { descricao: "", unidade: "UN", quantidade: 1, preco_estimado: 0 },
  ]);
  const [saving, setSaving] = useState(false);

  const valorTotal = items.reduce((s, i) => s + Number(i.quantidade || 0) * Number(i.preco_estimado || 0), 0);

  const addItem = () => setItems([...items, { descricao: "", unidade: "UN", quantidade: 1, preco_estimado: 0 }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, patch: Partial<ItemDraft>) =>
    setItems(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const handleSave = async (sendNow: boolean) => {
    if (!numero.trim()) return toast({ title: "Número obrigatório", variant: "destructive" });
    if (sendNow && !centroCustoId) return toast({ title: "Centro de Custo obrigatório para enviar", variant: "destructive" });
    if (sendNow && tipo === "custo_direto" && !contratoId) return toast({ title: "Contrato obrigatório para custo direto", variant: "destructive" });
    if (items.some((i) => !i.descricao.trim() || i.quantidade <= 0))
      return toast({ title: "Itens inválidos", description: "Descrição e quantidade > 0", variant: "destructive" });

    setSaving(true);
    try {
      const { data: rc, error: e1 } = await supabase
        .from("requisicao_compra")
        .insert({
          numero,
          data_solicitacao: new Date().toISOString().slice(0, 10),
          data_necessidade: dataNecessidade || null,
          valor_estimado: valorTotal,
          status: sendNow ? "enviada" : "rascunho",
          status_v2: sendNow ? "aguardando_aprovacao" : "rascunho",
          justificativa,
          empresa_id: empresaId,
          solicitante_id: userId,
          centro_custo_id: centroCustoId || null,
          contrato_id: contratoId || null,
          tipo: tipo as any,
          prioridade: prioridade as any,
        })
        .select()
        .single();
      if (e1) throw e1;

      const { error: e2 } = await supabase.from("requisicao_compra_item").insert(
        items.map((it) => ({
          requisicao_id: rc.id,
          descricao: it.descricao,
          unidade: it.unidade,
          quantidade: it.quantidade,
          preco_estimado: it.preco_estimado,
        }))
      );
      if (e2) throw e2;

      // Se for enviar para aprovação, abre instância no motor unificado
      if (sendNow && empresaId && centroCustoId) {
        const { data: fluxoId, error: eFluxo } = await (supabase as any).rpc("sup_aprov_fluxo_padrao", {
          _empresa_id: empresaId,
          _alvo: "requisicao_compra",
        });
        if (eFluxo) throw eFluxo;

        const { error: eInst } = await (supabase as any).rpc("sup_aprov_abrir_instancia", {
          _fluxo_id: fluxoId,
          _referencia_id: rc.id,
          _referencia_codigo: numero,
          _valor: valorTotal,
          _centro_custo_id: centroCustoId,
          _solicitante: userId,
        });
        if (eInst) throw eInst;
      }

      toast({ title: sendNow ? "RC enviada para aprovação" : "Rascunho salvo" });
      onCreated();
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova Requisição de Compra</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Número *</Label>
            <Input value={numero} onChange={(e) => setNumero(e.target.value)} />
          </div>
          <div>
            <Label>Data de Necessidade</Label>
            <Input type="date" value={dataNecessidade} onChange={(e) => setDataNecessidade(e.target.value)} />
          </div>
          <div>
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPO_OPTS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Prioridade</Label>
            <Select value={prioridade} onValueChange={setPrioridade}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORIDADE_OPTS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Centro de Custo {tipo !== "custo_direto" && <span className="text-destructive">*</span>}</Label>
            <Select value={centroCustoId} onValueChange={setCentroCustoId}>
              <SelectTrigger><SelectValue placeholder="Selecionar…" /></SelectTrigger>
              <SelectContent>
                {ccs.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.codigo} — {c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Contrato {tipo === "custo_direto" && <span className="text-destructive">*</span>}</Label>
            <Select value={contratoId} onValueChange={setContratoId}>
              <SelectTrigger><SelectValue placeholder="Selecionar…" /></SelectTrigger>
              <SelectContent>
                {contratos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label>Justificativa</Label>
          <Textarea rows={2} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="Por que esta compra é necessária?" />
        </div>

        <div className="border rounded-md p-3">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-sm">Itens da Requisição</h4>
            <Button size="sm" variant="outline" onClick={addItem}><Plus className="h-3.5 w-3.5 mr-1" />Adicionar</Button>
          </div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-5">
                  {i === 0 && <Label className="text-xs">Descrição</Label>}
                  <Input value={it.descricao} onChange={(e) => updateItem(i, { descricao: e.target.value })} />
                </div>
                <div className="col-span-2">
                  {i === 0 && <Label className="text-xs">Unidade</Label>}
                  <Input value={it.unidade} onChange={(e) => updateItem(i, { unidade: e.target.value })} />
                </div>
                <div className="col-span-2">
                  {i === 0 && <Label className="text-xs">Qtd</Label>}
                  <Input type="number" step="0.01" value={it.quantidade} onChange={(e) => updateItem(i, { quantidade: Number(e.target.value) })} />
                </div>
                <div className="col-span-2">
                  {i === 0 && <Label className="text-xs">Preço Est.</Label>}
                  <Input type="number" step="0.01" value={it.preco_estimado} onChange={(e) => updateItem(i, { preco_estimado: Number(e.target.value) })} />
                </div>
                <div className="col-span-1">
                  <Button size="icon" variant="ghost" onClick={() => removeItem(i)} disabled={items.length === 1}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-right text-sm">
            <span className="text-muted-foreground">Total estimado: </span>
            <strong>{valorTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong>
          </div>
          <OrcamentoBadge empresaId={empresaId} centroCustoId={centroCustoId} valor={valorTotal} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="secondary" onClick={() => handleSave(false)} disabled={saving}>Salvar Rascunho</Button>
          <Button onClick={() => handleSave(true)} disabled={saving}>
            <Send className="h-4 w-4 mr-2" /> Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RCDetailDialog({ rcId, onClose, onChanged }: { rcId: string; onClose: () => void; onChanged: () => void }) {
  const { data: rc } = useQuery({
    queryKey: ["rc_detail", rcId],
    queryFn: async () => (await supabase.from("requisicao_compra").select("*").eq("id", rcId).single()).data,
  });
  const { data: items = [] } = useQuery({
    queryKey: ["rc_items", rcId],
    queryFn: async () => (await supabase.from("requisicao_compra_item").select("*").eq("requisicao_id", rcId).order("created_at")).data ?? [],
  });
  const { data: hist = [] } = useQuery({
    queryKey: ["rc_hist", rcId],
    queryFn: async () => (await supabase.from("requisicao_compra_status_hist").select("*").eq("requisicao_id", rcId).order("created_at")).data ?? [],
  });

  const transitionMut = useMutation({
    mutationFn: async (newStatus: string) => {
      // status legacy só aceita um subconjunto; mapear quando possível
      const legacyMap: Record<string, string> = {
        rascunho: "rascunho", enviada: "enviada", aprovada: "aprovada",
        rejeitada: "rejeitada", cancelada: "cancelada", pedido_gerado: "pedido_emitido",
      };
      const legacyStatus = legacyMap[newStatus];
      const payload: any = { status_v2: newStatus };
      if (legacyStatus) payload.status = legacyStatus;
      const { error } = await supabase
        .from("requisicao_compra")
        .update(payload)
        .eq("id", rcId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Status atualizado" });
      onChanged();
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  if (!rc) return null;

  const nextActions: Array<{ label: string; status: string; variant?: any }> = [];
  if (rc.status_v2 === "rascunho") nextActions.push({ label: "Enviar", status: "enviada" });
  if (rc.status_v2 === "enviada") {
    nextActions.push({ label: "Aprovar", status: "aprovada" });
    nextActions.push({ label: "Rejeitar", status: "rejeitada", variant: "destructive" });
  }
  if (rc.status_v2 === "aprovada") nextActions.push({ label: "Marcar em Compras", status: "em_compras" });
  if (!["cancelada", "atendida_total", "rejeitada"].includes(rc.status_v2)) {
    nextActions.push({ label: "Cancelar", status: "cancelada", variant: "outline" });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {rc.numero} <StatusBadge status={rc.status_v2} />
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-muted-foreground">Tipo:</span> <strong>{rc.tipo}</strong></div>
          <div><span className="text-muted-foreground">Prioridade:</span> <strong>{rc.prioridade}</strong></div>
          <div><span className="text-muted-foreground">Necessidade:</span> {rc.data_necessidade ? new Date(rc.data_necessidade).toLocaleDateString("pt-BR") : "—"}</div>
          <div><span className="text-muted-foreground">Valor estimado:</span> {Number(rc.valor_estimado ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</div>
        </div>

        {rc.justificativa && (
          <div className="text-sm">
            <p className="text-muted-foreground mb-1">Justificativa</p>
            <p className="bg-muted/50 rounded p-2">{rc.justificativa}</p>
          </div>
        )}

        <div>
          <h4 className="font-medium text-sm mb-2">Itens</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead>Un</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Preço</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it: any) => (
                <TableRow key={it.id}>
                  <TableCell>{it.descricao}</TableCell>
                  <TableCell>{it.unidade}</TableCell>
                  <TableCell className="text-right">{it.quantidade}</TableCell>
                  <TableCell className="text-right">{Number(it.preco_estimado).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                  <TableCell className="text-right">{Number(it.valor_total ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div>
          <h4 className="font-medium text-sm mb-2">Timeline</h4>
          <ol className="space-y-2 border-l-2 border-muted pl-4">
            {hist.map((h: any) => (
              <li key={h.id} className="relative">
                <span className="absolute -left-[21px] top-1 h-3 w-3 rounded-full bg-primary" />
                <div className="text-sm">
                  <StatusBadge status={h.status_novo} />
                  <span className="text-xs text-muted-foreground ml-2">
                    {new Date(h.created_at).toLocaleString("pt-BR")}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {nextActions.map((a) => (
            <Button
              key={a.status}
              variant={a.variant ?? "default"}
              onClick={() => transitionMut.mutate(a.status)}
              disabled={transitionMut.isPending}
            >
              {a.label}
            </Button>
          ))}
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
