import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { chamadosMarkSeen } from "@/hooks/useChamadosNotif";
import { useChamadoPerms } from "./useChamadoPerms";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { ExportarChamado } from "./ExportarChamado";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, MessageSquare, XCircle, Paperclip, ArrowLeft, Trash2, Star, RotateCcw } from "lucide-react";
import { ExcluirChamadoDialog } from "./ExcluirChamadoDialog";
import { ChatChamado } from "./ChatChamado";
import {
  StatusBadge, PrioridadeBadge, STATUS_CHAMADO, CardAvaliacao,
  CATEGORIAS, TIPOS, IMPACTOS, URGENCIAS, AMBIENTES,
  labelDe, moduloLabel, fmtData, fmtDataHora,
  BUCKET_CHAMADOS, type Chamado, type Anexo, type Evento, type AvaliacaoChamado,
} from "./types";

export default function ExecutarChamado() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const { canCoordenar, canAprovar, canDev, canExcluir, gestor } = useChamadoPerms();

  const [reprovando, setReprovando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [excluindoOpen, setExcluindoOpen] = useState(false);
  const [agindo, setAgindo] = useState<string | null>(null); // ação em curso (trava cliques repetidos)
  const [flash, setFlash] = useState(false);                 // pisca o selo de status ao mudar

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

  const { data: avaliacao } = useQuery({
    queryKey: ["chamado-avaliacao", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await (supabase as any).from("CHAMADO_SISTEMA_AVALIACAO").select("*").eq("chamado_id", id).maybeSingle();
      return (data ?? null) as AvaliacaoChamado | null;
    },
  });

  const ehResponsavel = !!chamado && chamado.responsavel_id === user?.id;
  const podeAgir = canCoordenar || canAprovar || (canDev && ehResponsavel);

  // Dev responsável abriu o chamado → zera a bolinha de novidades do dev.
  useEffect(() => { if (ehResponsavel) chamadosMarkSeen(user?.id, "dev"); }, [ehResponsavel, user?.id]);
  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["chamado", id] });
    qc.invalidateQueries({ queryKey: ["chamado-eventos", id] });
    qc.invalidateQueries({ queryKey: ["chamados-meus-atribuidos", user?.id] });
  };

  const mudarStatus = async (status: string, texto: string, evento: string) => {
    if (agindo) return;                                   // já tem ação rodando
    if (chamado?.status === status) {                     // já está nesse status → não repete
      toast({ title: `O chamado já está "${STATUS_CHAMADO[status]?.label ?? status}".` });
      return;
    }
    setAgindo(evento);
    const { error } = await (supabase as any).from("CHAMADO_SISTEMA").update({ status }).eq("id", id);
    if (error) { setAgindo(null); toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    await (supabase as any).from("CHAMADO_SISTEMA_EVENTO").insert({ chamado_id: id, tipo: "evento", texto });
    supabase.functions.invoke("enviar-notificacao-push", { body: { chamado_id: id, evento } }).catch(() => {});
    toast({ title: texto });
    setFlash(true); setTimeout(() => setFlash(false), 700);
    setAgindo(null);
    invalidar();
  };

  const salvarPrazo = async (prazo: string) => {
    const { error } = await (supabase as any).from("CHAMADO_SISTEMA").update({ prazo_previsto: prazo || null }).eq("id", id);
    if (error) { toast({ title: "Erro ao salvar prazo", description: error.message, variant: "destructive" }); return; }
    invalidar();
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

  const anexosAbertura = anexos.filter((a) => (a.campo ?? "abertura") === "abertura");
  // Anexos de resposta anteriores ao chat: não pertencem a mensagem nenhuma, então
  // não têm balão onde aparecer — seguem listados à parte.
  const anexosLegado = anexos.filter((a) => a.campo && a.campo !== "abertura" && !a.evento_id);
  const encerrado = chamado.status === "concluido" || chamado.status === "reprovado";

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
        actions={<Button variant="outline" className="gap-1.5" onClick={() => nav("/app/sistemas/chamados/dev")}><ArrowLeft className="h-4 w-4" /> Meus chamados</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <Card className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold">Informações do chamado</p>
              <span className={`rounded-full ${flash ? "animate-status-flash" : ""}`}>
                <StatusBadge status={chamado.status} />
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo label="Categorias">{chamado.categorias.map((c) => labelDe(CATEGORIAS, c)).join(", ")}</Campo>
              <Campo label="Tipo de solicitação">{labelDe(TIPOS, chamado.tipo_solicitacao)}</Campo>
              <Campo label="Prioridade"><PrioridadeBadge prioridade={chamado.prioridade} /></Campo>
              <Campo label="Ambiente">{labelDe(AMBIENTES, chamado.ambiente)}</Campo>
              <Campo label="Módulo / Sistema">{moduloLabel(chamado)}</Campo>
              <Campo label="Impacto">{labelDe(IMPACTOS, chamado.impacto_trabalho)}</Campo>
              <Campo label="Abertura">{fmtDataHora(chamado.created_at)}</Campo>
              <Campo label="Última atualização">{fmtDataHora(chamado.updated_at)}{eventos[0] ? ` · por ${nomeDe(eventos[0].autor_id)}` : ""}</Campo>
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

          {avaliacao && (
            <CardAvaliacao avaliacao={avaliacao} titulo="Avaliação do solicitante" tone="warning" />
          )}

          <Card className="space-y-3 p-4">
            <p className="text-sm font-bold">Descrição e evidências (abertura)</p>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Descrição detalhada</p>
              <p className="whitespace-pre-wrap text-sm">{chamado.descricao || "—"}</p>
            </div>
            {chamado.observacoes_solicitante && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Observações do solicitante</p>
                <p className="whitespace-pre-wrap text-sm">{chamado.observacoes_solicitante}</p>
              </div>
            )}
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Anexos da abertura ({anexosAbertura.length})</p>
              <div className="space-y-1">
                {anexosAbertura.map((a) => (
                  <button key={a.id} onClick={() => baixarAnexo(a.storage_path)} className="flex w-full items-center gap-2 rounded border border-border px-2.5 py-1.5 text-left text-xs hover:border-primary/40">
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate">{a.nome_arquivo}</span>
                    {a.tamanho_bytes != null && <span className="text-[10px] text-muted-foreground">{Math.round(a.tamanho_bytes / 1024)} KB</span>}
                  </button>
                ))}
                {anexosAbertura.length === 0 && <p className="text-xs text-muted-foreground">Nenhum anexo.</p>}
              </div>
            </div>
          </Card>

          {/* Anexos de respostas antigas — as novas já aparecem no balão do chat */}
          {anexosLegado.length > 0 && (
            <Card className="space-y-2 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Anexos enviados nas respostas ({anexosLegado.length})</p>
              <div className="space-y-1">
                {anexosLegado.map((a) => (
                  <button key={a.id} onClick={() => baixarAnexo(a.storage_path)} className="flex w-full items-center gap-2 rounded border border-border px-2.5 py-1.5 text-left text-xs hover:border-primary/40">
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate">{a.nome_arquivo}</span>
                    <span className="text-[10px] text-muted-foreground">{nomeDe(a.autor_id)}</span>
                    {a.tamanho_bytes != null && <span className="text-[10px] text-muted-foreground">{Math.round(a.tamanho_bytes / 1024)} KB</span>}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* Conversa do chamado (grupo: solicitante + equipe) */}
          <ChatChamado
            chamadoId={chamado.id}
            solicitanteId={chamado.solicitante_id}
            perfil="equipe"
            encerrado={encerrado}
            somenteLeitura={!podeAgir}
          />
        </div>

        {/* Coluna de execução */}
        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <p className="text-sm font-bold">Execução do chamado</p>
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
              {chamado.status === "concluido" ? (
                <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm font-semibold text-success">
                  <CheckCircle2 className="h-4 w-4 animate-check-pop" /> Chamado concluído
                </div>
              ) : (
                <Button
                  className="w-full justify-start gap-2 bg-success text-success-foreground transition-transform hover:bg-success/90 active:scale-95 disabled:opacity-60"
                  disabled={!!agindo}
                  onClick={() => mudarStatus("concluido", "Chamado concluído", "concluido")}
                >
                  <CheckCircle2 className="h-4 w-4" /> {agindo === "concluido" ? "Concluindo…" : "Concluir chamado"}
                </Button>
              )}
              <Button
                variant="outline"
                className="w-full justify-start gap-2 transition-transform active:scale-95 disabled:opacity-60"
                disabled={!!agindo || chamado.status === "aguardando_retorno"}
                onClick={() => mudarStatus("aguardando_retorno", "Solicitadas mais informações ao solicitante", "solicitar_info")}
              >
                <MessageSquare className="h-4 w-4" />
                {agindo === "solicitar_info" ? "Solicitando…" : chamado.status === "aguardando_retorno" ? "Aguardando retorno do solicitante" : "Solicitar mais informações"}
              </Button>
              {chamado.status === "aguardando_retorno" && (
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 transition-transform active:scale-95 disabled:opacity-60"
                  disabled={!!agindo}
                  onClick={() => mudarStatus("em_andamento", "Solicitação de informações cancelada — chamado retomado", "cancelar_info")}
                >
                  <RotateCcw className="h-4 w-4 text-primary" />
                  {agindo === "cancelar_info" ? "Cancelando…" : "Cancelar solicitação de informações"}
                </Button>
              )}
              {canAprovar && chamado.status !== "concluido" && chamado.status !== "reprovado" && (
                <Button variant="outline" className="w-full justify-start gap-2 text-destructive transition-transform active:scale-95" onClick={() => setReprovando(true)}>
                  <XCircle className="h-4 w-4" /> Reprovar chamado
                </Button>
              )}
            </Card>
          )}

          {/* Exportar fica FORA do `podeAgir`: não é ação de execução — quem
              enxerga o chamado pode levar a ficha e os anexos embora. */}
          <ExportarChamado chamadoId={chamado.id} numero={chamado.numero} totalAnexos={anexos.length} />

          {canExcluir && (
            <Card className="space-y-2 p-4">
              <p className="text-sm font-bold text-destructive">Zona de risco</p>
              <Button variant="outline" className="w-full justify-start gap-2 text-destructive" onClick={() => setExcluindoOpen(true)}>
                <Trash2 className="h-4 w-4" /> Excluir chamado
              </Button>
              <p className="text-[11px] text-muted-foreground">Remove o chamado, histórico e anexos. Pede a senha da conta.</p>
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

      <ExcluirChamadoDialog
        open={excluindoOpen}
        onOpenChange={setExcluindoOpen}
        chamadoId={id ?? null}
        numero={chamado.numero}
        onExcluido={() => nav(gestor ? "/app/sistemas/chamados/painel" : "/app/sistemas/chamados/dev")}
      />
    </div>
  );
}
