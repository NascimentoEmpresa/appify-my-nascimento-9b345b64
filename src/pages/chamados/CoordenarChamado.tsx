import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useChamadoPerms } from "./useChamadoPerms";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ArrowUp, ArrowDown, Trash2, Plus, Send, ShieldAlert, XCircle, CheckCircle2 } from "lucide-react";
import {
  StatusBadge, PrioridadeBadge, TarefaStatusBadge, PRIORIDADES, iniciais, fmtDataHora, moduloLabel, type Chamado, type Tarefa,
} from "./types";

interface Dev { id: string; display_name: string; em_andamento: number; abertos: number; }

export default function CoordenarChamado() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { gestor, canCoordenar, canAprovar } = useChamadoPerms();

  const [responsavel, setResponsavel] = useState<string | null>(null);
  const [observacao, setObservacao] = useState("");
  const [novoTitulo, setNovoTitulo] = useState("");
  const [novaDescricao, setNovaDescricao] = useState("");
  const [novaPrioridade, setNovaPrioridade] = useState("media");
  const [novaPos, setNovaPos] = useState("fim");
  const [reprovando, setReprovando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  const { data: devs = [] } = useQuery({
    queryKey: ["chamados-devs"],
    enabled: gestor,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("listar_desenvolvedores_chamados");
      return (data ?? []) as Dev[];
    },
  });

  const { data: chamado } = useQuery({
    queryKey: ["chamado", id],
    enabled: !!id && gestor,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("chamado_sistema").select("*").eq("id", id).single();
      if (error) throw error;
      const c = data as Chamado;
      setResponsavel((cur) => cur ?? c.responsavel_id ?? null);
      setObservacao((cur) => cur || c.observacao_gerente || "");
      return c;
    },
  });

  const { data: tarefas = [] } = useQuery({
    queryKey: ["chamado-tarefas", id],
    enabled: !!id && gestor,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("chamado_sistema_tarefa")
        .select("*").eq("chamado_id", id).order("ordem", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Tarefa[];
    },
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["chamado-tarefas", id] });
    qc.invalidateQueries({ queryKey: ["chamado", id] });
    qc.invalidateQueries({ queryKey: ["chamados-todos"] });
  };

  const addTarefa = async () => {
    if (!novoTitulo.trim()) { toast({ title: "Dê um título à tarefa.", variant: "destructive" }); return; }
    const pos = novaPos === "inicio" ? 1 : novaPos === "fim" ? tarefas.length + 1 : Number(novaPos);
    // Reordena as existentes >= pos.
    for (const t of tarefas.filter((t) => t.ordem >= pos)) {
      await (supabase as any).from("chamado_sistema_tarefa").update({ ordem: t.ordem + 1 }).eq("id", t.id);
    }
    const { error } = await (supabase as any).from("chamado_sistema_tarefa").insert({
      chamado_id: id, titulo: novoTitulo.trim(), descricao: novaDescricao.trim() || null,
      prioridade: novaPrioridade, ordem: pos, responsavel_id: responsavel,
    });
    if (error) { toast({ title: "Erro ao criar tarefa", description: error.message, variant: "destructive" }); return; }
    setNovoTitulo(""); setNovaDescricao(""); setNovaPrioridade("media"); setNovaPos("fim");
    invalidar();
  };

  const mover = async (t: Tarefa, dir: -1 | 1) => {
    const vizinho = tarefas.find((o) => o.ordem === t.ordem + dir);
    if (!vizinho) return;
    await (supabase as any).from("chamado_sistema_tarefa").update({ ordem: vizinho.ordem }).eq("id", t.id);
    await (supabase as any).from("chamado_sistema_tarefa").update({ ordem: t.ordem }).eq("id", vizinho.id);
    invalidar();
  };

  const removerTarefa = async (t: Tarefa) => {
    await (supabase as any).from("chamado_sistema_tarefa").delete().eq("id", t.id);
    invalidar();
  };

  const atribuir = async () => {
    if (!responsavel) { toast({ title: "Escolha o responsável pela execução.", variant: "destructive" }); return; }
    setSalvando(true);
    const nomeDev = devs.find((d) => d.id === responsavel)?.display_name ?? "";
    const { error } = await (supabase as any).from("chamado_sistema").update({
      responsavel_id: responsavel, status: "em_andamento", observacao_gerente: observacao.trim() || null,
    }).eq("id", id);
    if (error) { setSalvando(false); toast({ title: "Erro ao atribuir", description: error.message, variant: "destructive" }); return; }
    // Garante que as tarefas fiquem com o responsável escolhido.
    for (const t of tarefas.filter((t) => t.responsavel_id !== responsavel)) {
      await (supabase as any).from("chamado_sistema_tarefa").update({ responsavel_id: responsavel }).eq("id", t.id);
    }
    await (supabase as any).from("chamado_sistema_evento").insert({
      chamado_id: id, tipo: "evento", texto: `Chamado direcionado a ${nomeDev}${tarefas.length ? ` com ${tarefas.length} tarefa(s)` : ""}`,
    });
    supabase.functions.invoke("enviar-notificacao-push-chamado", { body: { chamado_id: id, evento: "atribuido" } }).catch(() => {});
    setSalvando(false);
    toast({ title: "Chamado direcionado", description: `Responsável: ${nomeDev}` });
    invalidar();
    nav("/app/sistemas/chamados/painel");
  };

  const reprovar = async () => {
    if (!motivo.trim()) { toast({ title: "Informe o motivo da reprovação.", variant: "destructive" }); return; }
    const { error } = await (supabase as any).from("chamado_sistema").update({
      status: "reprovado", motivo_reprovacao: motivo.trim(),
    }).eq("id", id);
    if (error) { toast({ title: "Erro ao reprovar", description: error.message, variant: "destructive" }); return; }
    await (supabase as any).from("chamado_sistema_evento").insert({
      chamado_id: id, tipo: "evento", texto: "Chamado reprovado: " + motivo.trim(),
    });
    supabase.functions.invoke("enviar-notificacao-push-chamado", { body: { chamado_id: id, evento: "reprovado" } }).catch(() => {});
    toast({ title: "Chamado reprovado" });
    setReprovando(false); setMotivo("");
    nav("/app/sistemas/chamados/painel");
  };

  if (!gestor) {
    return (
      <div>
        <PageHeader title="Coordenação do chamado" module="Sistemas" breadcrumb={["Chamados de Sistemas", "Coordenação"]} />
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" /> Acesso restrito à gestão de chamados (Coordenar, Aprovar ou Painel).
        </Card>
      </div>
    );
  }
  if (!chamado) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;

  return (
    <div>
      <PageHeader
        title={`#${chamado.numero}`}
        subtitle={chamado.assunto}
        module="Sistemas"
        breadcrumb={["Chamados de Sistemas", `#${chamado.numero}`]}
        actions={<Button variant="outline" onClick={() => nav("/app/sistemas/chamados/painel")}>Voltar ao painel</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          {/* 1. Coordenação — escolher responsável */}
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold">1. Coordenação do chamado</p>
              <StatusBadge status={chamado.status} />
            </div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Responsável pela execução</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {devs.map((d) => (
                <button key={d.id} type="button" onClick={() => setResponsavel(d.id)}
                  className={`rounded-lg border p-3 text-left transition-colors ${responsavel === d.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/40"}`}>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8"><AvatarFallback className="text-[10px]">{iniciais(d.display_name)}</AvatarFallback></Avatar>
                    {responsavel === d.id && <CheckCircle2 className="ml-auto h-4 w-4 text-primary" />}
                  </div>
                  <p className="mt-2 truncate text-xs font-semibold">{d.display_name}</p>
                  <p className="text-[10px] text-muted-foreground">Chamados abertos: {d.abertos}</p>
                </button>
              ))}
              {devs.length === 0 && <p className="text-xs text-muted-foreground">Nenhum desenvolvedor liberado (código <b>chamados_sistemas_dev</b>).</p>}
            </div>
          </Card>

          {/* 2. Tarefas */}
          <Card className="p-4">
            <p className="mb-3 text-sm font-bold">2. Tarefas do responsável <span className="text-muted-foreground">— fila por prioridade</span></p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Ordem</TableHead>
                    <TableHead>Tarefa</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tarefas.map((t, i) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-semibold">{t.ordem}</span>
                          <button disabled={i === 0} onClick={() => mover(t, -1)} className="text-muted-foreground disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                          <button disabled={i === tarefas.length - 1} onClick={() => mover(t, 1)} className="text-muted-foreground disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm font-medium">{t.titulo}</p>
                        {t.descricao && <p className="text-[11px] text-muted-foreground">{t.descricao}</p>}
                      </TableCell>
                      <TableCell><PrioridadeBadge prioridade={t.prioridade} /></TableCell>
                      <TableCell><TarefaStatusBadge status={t.status} /></TableCell>
                      <TableCell>
                        <button onClick={() => removerTarefa(t)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {tarefas.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="py-4 text-center text-xs text-muted-foreground">Nenhuma tarefa ainda.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Nova tarefa */}
            {canCoordenar && <div className="mt-3 space-y-2 rounded-lg border border-dashed border-border p-3">
              <p className="text-xs font-semibold">Nova tarefa</p>
              <Input placeholder="Título da tarefa" value={novoTitulo} onChange={(e) => setNovoTitulo(e.target.value)} />
              <Textarea rows={2} placeholder="Descrição (opcional)" value={novaDescricao} onChange={(e) => setNovaDescricao(e.target.value)} />
              <div className="flex flex-wrap items-center gap-2">
                <Select value={novaPrioridade} onValueChange={setNovaPrioridade}>
                  <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORIDADES).map(([v, p]) => <SelectItem key={v} value={v}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={novaPos} onValueChange={setNovaPos}>
                  <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inicio">1º lugar</SelectItem>
                    {tarefas.map((_, i) => <SelectItem key={i} value={String(i + 2)}>{i + 2}º lugar</SelectItem>)}
                    <SelectItem value="fim">No fim da fila</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" className="gap-1.5" onClick={addTarefa}><Plus className="h-3.5 w-3.5" /> Adicionar</Button>
              </div>
            </div>}
          </Card>

          {/* 3. Observação + ações */}
          <Card className="space-y-3 p-4">
            <p className="text-sm font-bold">3. Observação para o responsável <span className="font-normal text-muted-foreground">(opcional)</span></p>
            <Textarea rows={3} maxLength={1000} placeholder="Informe orientações, contexto ou observações importantes…" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
            <div className="flex items-center justify-between">
              {canAprovar
                ? <Button variant="outline" className="gap-1.5 text-destructive" onClick={() => setReprovando(true)}><XCircle className="h-4 w-4" /> Reprovar chamado</Button>
                : <span />}
              {canCoordenar && <Button className="gap-1.5" disabled={salvando} onClick={atribuir}><Send className="h-4 w-4" /> Atribuir tarefas e direcionar chamado</Button>}
            </div>
          </Card>
        </div>

        {/* Resumo */}
        <Card className="h-fit space-y-2 p-4 text-sm">
          <p className="text-sm font-bold">Resumo do chamado</p>
          {[
            ["ID", `#${chamado.numero}`], ["Assunto", chamado.assunto],
            ["Solicitante", chamado.solicitante_nome || "—"], ["Setor", chamado.setor || "—"],
            ["Módulo / Sistema", moduloLabel(chamado)], ["Prioridade", <PrioridadeBadge key="p" prioridade={chamado.prioridade} />],
            ["Status", <StatusBadge key="s" status={chamado.status} />], ["Aberto em", fmtDataHora(chamado.created_at)],
            ["Prazo previsto", fmtDataHora(chamado.prazo_previsto)],
          ].map(([k, v]) => (
            <div key={String(k)} className="flex justify-between gap-2 border-b border-border/60 py-1 last:border-0">
              <span className="text-xs text-muted-foreground">{k}</span>
              <span className="text-right text-xs font-medium">{v}</span>
            </div>
          ))}
          {chamado.descricao && (
            <div className="pt-2">
              <p className="text-xs text-muted-foreground">Descrição</p>
              <p className="whitespace-pre-wrap text-xs">{chamado.descricao}</p>
            </div>
          )}
        </Card>
      </div>

      <Dialog open={reprovando} onOpenChange={setReprovando}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reprovar chamado</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Encerra o chamado informando o motivo (visível ao solicitante).</p>
          <Textarea rows={3} placeholder="Motivo da reprovação" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setReprovando(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={reprovar}>Reprovar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
