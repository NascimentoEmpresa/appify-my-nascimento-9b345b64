import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useChamadoPerms } from "./useChamadoPerms";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, MessageSquare, XCircle, Paperclip, ArrowLeft } from "lucide-react";
import {
  StatusBadge, PrioridadeBadge, TarefaStatusBadge, STATUS_CHAMADO, STATUS_TAREFA,
  CATEGORIAS, TIPOS, IMPACTOS, URGENCIAS, AMBIENTES, labelDe, moduloLabel, fmtData, fmtDataHora,
  BUCKET_CHAMADOS, type Chamado, type Tarefa, type Anexo, type Evento,
} from "./types";

export default function ExecutarChamado() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const { canCoordenar, canAprovar, canDev } = useChamadoPerms();

  const [obsInterna, setObsInterna] = useState("");
  const [reprovando, setReprovando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const { data: usuarios = [] } = useQuery({
    queryKey: ["chamados-usuarios"],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("listar_usuarios_ativos");
      return (data ?? []) as Array<{ id: string; display_name: string }>;
    },
  });
  const nomeDe = (uid: string | null) => (uid ? usuarios.find((u) => u.id === uid)?.display_name ?? "—" : "—");

  const { data: chamado } = useQuery({
    queryKey: ["chamado", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("CHAMADO_SISTEMA").select("*").eq("id", id).single();
      if (error) throw error;
      return data as Chamado;
    },
  });

  const { data: tarefas = [] } = useQuery({
    queryKey: ["chamado-tarefas", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await (supabase as any).from("CHAMADO_SISTEMA_TAREFA").select("*").eq("chamado_id", id).order("ordem");
      return (data ?? []) as Tarefa[];
    },
  });

  const { data: anexos = [] } = useQuery({
    queryKey: ["chamado-anexos", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await (supabase as any).from("CHAMADO_SISTEMA_ANEXO").select("*").eq("chamado_id", id).order("created_at");
      return (data ?? []) as Anexo[];
    },
  });

  const { data: eventos = [] } = useQuery({
    queryKey: ["chamado-eventos", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await (supabase as any).from("CHAMADO_SISTEMA_EVENTO").select("*").eq("chamado_id", id).order("created_at", { ascending: false });
      return (data ?? []) as Evento[];
    },
  });

  const ehResponsavel = !!chamado && chamado.responsavel_id === user?.id;
  const podeAgir = canCoordenar || canAprovar || (canDev && ehResponsavel);
  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["chamado", id] });
    qc.invalidateQueries({ queryKey: ["chamado-eventos", id] });
    qc.invalidateQueries({ queryKey: ["chamados-minhas-tarefas", user?.id] });
  };

  const mudarStatus = async (status: string, texto: string, evento: string) => {
    const { error } = await (supabase as any).from("CHAMADO_SISTEMA").update({ status }).eq("id", id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    await (supabase as any).from("CHAMADO_SISTEMA_EVENTO").insert({ chamado_id: id, tipo: "evento", texto });
    supabase.functions.invoke("enviar-notificacao-push", { body: { chamado_id: id, evento } }).catch(() => {});
    toast({ title: texto });
    invalidar();
  };

  const salvarPrazo = async (prazo: string) => {
    const { error } = await (supabase as any).from("CHAMADO_SISTEMA").update({ prazo_previsto: prazo || null }).eq("id", id);
    if (error) { toast({ title: "Erro ao salvar prazo", description: error.message, variant: "destructive" }); return; }
    invalidar();
  };

  const mudarStatusTarefa = async (t: Tarefa, status: string) => {
    const { error } = await (supabase as any).from("CHAMADO_SISTEMA_TAREFA").update({ status }).eq("id", t.id);
    if (error) { toast({ title: "Erro na tarefa", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["chamado-tarefas", id] });
    qc.invalidateQueries({ queryKey: ["chamados-minhas-tarefas", user?.id] });
  };

  const salvarObs = async () => {
    if (!obsInterna.trim()) return;
    const { error } = await (supabase as any).from("CHAMADO_SISTEMA_EVENTO").insert({
      chamado_id: id, tipo: "observacao_interna", texto: obsInterna.trim(),
    });
    if (error) { toast({ title: "Erro ao salvar observação", description: error.message, variant: "destructive" }); return; }
    setObsInterna("");
    qc.invalidateQueries({ queryKey: ["chamado-eventos", id] });
  };

  const reprovar = async () => {
    if (!motivo.trim()) { toast({ title: "Informe o motivo.", variant: "destructive" }); return; }
    const { error } = await (supabase as any).from("CHAMADO_SISTEMA").update({ status: "reprovado", motivo_reprovacao: motivo.trim() }).eq("id", id);
    if (error) { toast({ title: "Erro ao reprovar", description: error.message, variant: "destructive" }); return; }
    await (supabase as any).from("CHAMADO_SISTEMA_EVENTO").insert({ chamado_id: id, tipo: "evento", texto: "Chamado reprovado: " + motivo.trim() });
    supabase.functions.invoke("enviar-notificacao-push", { body: { chamado_id: id, evento: "reprovado" } }).catch(() => {});
    toast({ title: "Chamado reprovado" });
    setReprovando(false); setMotivo("");
    invalidar();
  };

  const baixarAnexo = async (path: string) => {
    const { data, error } = await supabase.storage.from(BUCKET_CHAMADOS).createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) { toast({ title: "Erro ao abrir anexo", variant: "destructive" }); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  if (!chamado) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;

  const Campo = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="text-sm">{children || "—"}</div>
    </div>
  );

  return (
    <div>
      <PageHeader
        title={`#${chamado.numero}`}
        subtitle={chamado.assunto}
        module="Sistemas"
        breadcrumb={["Chamados de Sistemas", `#${chamado.numero}`]}
        actions={<Button variant="outline" className="gap-1.5" onClick={() => nav("/app/sistemas/chamados/dev")}><ArrowLeft className="h-4 w-4" /> Minhas tarefas</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <Card className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold">Informações do chamado</p>
              <StatusBadge status={chamado.status} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo label="Categorias">{chamado.categorias.map((c) => labelDe(CATEGORIAS, c)).join(", ")}</Campo>
              <Campo label="Tipo de solicitação">{labelDe(TIPOS, chamado.tipo_solicitacao)}</Campo>
              <Campo label="Prioridade"><PrioridadeBadge prioridade={chamado.prioridade} /></Campo>
              <Campo label="Ambiente">{labelDe(AMBIENTES, chamado.ambiente)}</Campo>
              <Campo label="Módulo / Sistema">{moduloLabel(chamado)}</Campo>
              <Campo label="Impacto">{labelDe(IMPACTOS, chamado.impacto_trabalho)}</Campo>
              <Campo label="Abertura">{fmtDataHora(chamado.created_at)}</Campo>
              <Campo label="Solicitante">{chamado.solicitante_nome || "—"} <span className="text-xs text-muted-foreground">({chamado.setor || "—"})</span></Campo>
              <Campo label="Afeta usuários">{chamado.afeta_usuarios ?? "—"}</Campo>
              <Campo label="Urgência informada">{labelDe(URGENCIAS, chamado.urgencia)}</Campo>
            </div>
          </Card>

          {chamado.comentario_gerente && (
            <Card className="space-y-1 border-primary/30 bg-primary/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Comentário do gerente de sistemas</p>
              <p className="whitespace-pre-wrap text-sm">{chamado.comentario_gerente}</p>
            </Card>
          )}
          {chamado.observacao_gerente && (
            <Card className="space-y-1 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Observação do gerente</p>
              <p className="whitespace-pre-wrap text-sm">{chamado.observacao_gerente}</p>
            </Card>
          )}

          <Card className="space-y-3 p-4">
            <p className="text-sm font-bold">Descrição e evidências (abertura)</p>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Descrição detalhada</p>
              <p className="whitespace-pre-wrap text-sm">{chamado.descricao || "—"}</p>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Anexos da abertura ({anexos.length})</p>
              <div className="space-y-1">
                {anexos.map((a) => (
                  <button key={a.id} onClick={() => baixarAnexo(a.storage_path)} className="flex w-full items-center gap-2 rounded border border-border px-2.5 py-1.5 text-left text-xs hover:border-primary/40">
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate">{a.nome_arquivo}</span>
                    {a.tamanho_bytes != null && <span className="text-[10px] text-muted-foreground">{Math.round(a.tamanho_bytes / 1024)} KB</span>}
                  </button>
                ))}
                {anexos.length === 0 && <p className="text-xs text-muted-foreground">Nenhum anexo.</p>}
              </div>
            </div>
          </Card>

          {/* Minhas tarefas neste chamado */}
          {tarefas.length > 0 && (
            <Card className="space-y-2 p-4">
              <p className="text-sm font-bold">Tarefas deste chamado</p>
              {tarefas.map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded border border-border px-2.5 py-2">
                  <span className="text-xs font-semibold text-muted-foreground">{t.ordem}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{t.titulo}</p>
                    {t.descricao && <p className="text-[11px] text-muted-foreground">{t.descricao}</p>}
                  </div>
                  <PrioridadeBadge prioridade={t.prioridade} />
                  {podeAgir && t.responsavel_id === user?.id ? (
                    <Select value={t.status} onValueChange={(v) => mudarStatusTarefa(t, v)}>
                      <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(STATUS_TAREFA).map(([v, s]) => <SelectItem key={v} value={v}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : <TarefaStatusBadge status={t.status} />}
                </div>
              ))}
            </Card>
          )}

          {/* Observações internas */}
          <Card className="space-y-2 p-4">
            <p className="text-sm font-bold">Observações internas <span className="font-normal text-muted-foreground">(visíveis só à equipe)</span></p>
            {podeAgir && (
              <div className="flex items-start gap-2">
                <Textarea rows={2} maxLength={1000} placeholder="Adicione observações sobre o andamento, testes, decisões técnicas…" value={obsInterna} onChange={(e) => setObsInterna(e.target.value)} />
                <Button size="sm" onClick={salvarObs} disabled={!obsInterna.trim()}>Salvar</Button>
              </div>
            )}
            <div className="space-y-2 pt-1">
              {eventos.map((e) => (
                <div key={e.id} className="rounded border border-border/60 px-2.5 py-1.5">
                  <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">{nomeDe(e.autor_id)}</span>
                    {e.tipo === "observacao_interna" && <span className="rounded bg-muted px-1.5 text-[9px] font-semibold uppercase">interna</span>}
                    {e.tipo === "evento" && <span className="rounded bg-info/10 px-1.5 text-[9px] font-semibold uppercase text-info">evento</span>}
                    <span>{fmtDataHora(e.created_at)}</span>
                  </p>
                  {e.texto && <p className="whitespace-pre-wrap text-xs">{e.texto}</p>}
                </div>
              ))}
              {eventos.length === 0 && <p className="text-xs text-muted-foreground">Sem histórico ainda.</p>}
            </div>
          </Card>
        </div>

        {/* Coluna de execução */}
        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <p className="text-sm font-bold">Execução da tarefa</p>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status atual</p>
              {podeAgir ? (
                <Select value={chamado.status} onValueChange={(v) => mudarStatus(v, `Status alterado para ${STATUS_CHAMADO[v]?.label ?? v}`, "status")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["aberto", "em_andamento", "aguardando_retorno", "concluido"].map((v) => (
                      <SelectItem key={v} value={v}>{STATUS_CHAMADO[v].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : <StatusBadge status={chamado.status} />}
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Responsável</p>
              <p className="text-sm font-medium">{nomeDe(chamado.responsavel_id)}</p>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Prazo para concluir</p>
              {podeAgir ? (
                <Input type="date" defaultValue={chamado.prazo_previsto ?? ""} onBlur={(e) => salvarPrazo(e.target.value)} />
              ) : <p className="text-sm">{fmtData(chamado.prazo_previsto)}</p>}
            </div>
          </Card>

          {podeAgir && (
            <Card className="space-y-2 p-4">
              <p className="text-sm font-bold">Ações rápidas</p>
              <Button className="w-full justify-start gap-2 bg-success text-success-foreground hover:bg-success/90" onClick={() => mudarStatus("concluido", "Chamado concluído", "concluido")}>
                <CheckCircle2 className="h-4 w-4" /> Concluir chamado
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => mudarStatus("aguardando_retorno", "Solicitadas mais informações ao solicitante", "solicitar_info")}>
                <MessageSquare className="h-4 w-4" /> Solicitar mais informações
              </Button>
              {canAprovar && (
                <Button variant="outline" className="w-full justify-start gap-2 text-destructive" onClick={() => setReprovando(true)}>
                  <XCircle className="h-4 w-4" /> Reprovar chamado
                </Button>
              )}
            </Card>
          )}
        </div>
      </div>

      <Dialog open={reprovando} onOpenChange={setReprovando}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reprovar chamado</DialogTitle></DialogHeader>
          <Textarea rows={3} placeholder="Motivo da reprovação (visível ao solicitante)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setReprovando(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={reprovar}>Reprovar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
