import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { chamadosMarkSeen } from "@/hooks/useChamadosNotif";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { ExportarChamado } from "./ExportarChamado";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MessageSquarePlus, Paperclip, RotateCcw, Star } from "lucide-react";
import { AvaliarChamadoDialog } from "./AvaliarChamadoDialog";
import { ChatChamado } from "./ChatChamado";
import {
  StatusBadge, PrioridadeBadge, CardAvaliacao,
  CATEGORIAS, TIPOS, IMPACTOS, URGENCIAS, AMBIENTES,
  labelDe, moduloLabel, fmtData, fmtDataHora,
  BUCKET_CHAMADOS, type Chamado, type Anexo, type AvaliacaoChamado,
} from "./types";

// Tela do SOLICITANTE: acompanha o próprio chamado e, quando o time pede mais
// informações (status 'aguardando_retorno'), adiciona novas informações que
// entram no histórico e devolvem o chamado para o time.
export default function AcompanharChamado({ base = "/app/central-servicos/chamados" }: { base?: string }) {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  const [avaliarAberto, setAvaliarAberto] = useState(false);

  // Abriu o chamado → o solicitante viu a novidade.
  useEffect(() => { chamadosMarkSeen(user?.id, "meus"); }, [user?.id]);

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

  const { data: avaliacao } = useQuery({
    queryKey: ["chamado-avaliacao", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await (supabase as any).from("CHAMADO_SISTEMA_AVALIACAO").select("*").eq("chamado_id", id).maybeSingle();
      return (data ?? null) as AvaliacaoChamado | null;
    },
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["chamado", id] });
    qc.invalidateQueries({ queryKey: ["chamado-eventos", id] });
    qc.invalidateQueries({ queryKey: ["chamados-meus", user?.id] });
    qc.invalidateQueries({ queryKey: ["chamados-meus-stats"] });
  };

  const baixarAnexo = async (path: string) => {
    const { data, error } = await supabase.storage.from(BUCKET_CHAMADOS).createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) { toast({ title: "Erro ao abrir anexo", variant: "destructive" }); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  if (!chamado) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;

  const ehSolicitante = chamado.solicitante_id === user?.id;
  const encerrado = chamado.status === "concluido" || chamado.status === "reprovado";
  const aguardandoRetorno = chamado.status === "aguardando_retorno";
  const anexosAbertura = anexos.filter((a) => (a.campo ?? "abertura") === "abertura");
  // Anexos anteriores ao chat: sem mensagem dona, ficam listados à parte.
  const anexosLegado = anexos.filter((a) => a.campo && a.campo !== "abertura" && !a.evento_id);

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
        module="Central de Serviços"
        breadcrumb={["Chamados de Sistemas", `#${chamado.numero}`]}
        actions={<Button variant="outline" className="gap-1.5" onClick={() => nav(base)}><ArrowLeft className="h-4 w-4" /> Meus chamados</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
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
              <Campo label="Responsável">{nomeDe(chamado.responsavel_id)}</Campo>
              <Campo label="Prazo previsto">{fmtData(chamado.prazo_previsto)}</Campo>
              <Campo label="Urgência informada">{labelDe(URGENCIAS, chamado.urgencia)}</Campo>
            </div>
          </Card>

          {chamado.observacao_gerente && (
            <Card className="space-y-1 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Observação do gerente</p>
              <p className="whitespace-pre-wrap text-sm">{chamado.observacao_gerente}</p>
            </Card>
          )}
          {chamado.status === "reprovado" && chamado.motivo_reprovacao && (
            <Card className="space-y-1 border-destructive/30 bg-destructive/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-destructive">Motivo da reprovação</p>
              <p className="whitespace-pre-wrap text-sm">{chamado.motivo_reprovacao}</p>
            </Card>
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

          {anexosLegado.length > 0 && (
            <Card className="animate-rise-in space-y-2 border-info/30 bg-info/5 p-4">
              <p className="flex items-center gap-1.5 text-sm font-bold text-info"><Paperclip className="h-4 w-4" /> Anexos enviados pelo time ({anexosLegado.length})</p>
              <div className="space-y-1">
                {anexosLegado.map((a) => (
                  <button key={a.id} onClick={() => baixarAnexo(a.storage_path)} className="flex w-full items-center gap-2 rounded border border-border bg-background px-2.5 py-1.5 text-left text-xs hover:border-info/40">
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate">{a.nome_arquivo}</span>
                    {a.tamanho_bytes != null && <span className="text-[10px] text-muted-foreground">{Math.round(a.tamanho_bytes / 1024)} KB</span>}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* Conversa do chamado — o solicitante fala com o time por aqui */}
          <ChatChamado
            chamadoId={chamado.id}
            solicitanteId={chamado.solicitante_id}
            perfil="solicitante"
            encerrado={encerrado}
            somenteLeitura={!ehSolicitante}
          />
        </div>

        {/* Coluna de ação do solicitante */}
        <div className="space-y-4">
          <ExportarChamado chamadoId={chamado.id} numero={chamado.numero} totalAnexos={anexos.length} />

          {ehSolicitante && !encerrado && (
            <Card className={`space-y-2 p-4 ${aguardandoRetorno ? "border-primary/40 bg-primary/5" : ""}`}>
              <p className="flex items-center gap-1.5 text-sm font-bold">
                <MessageSquarePlus className="h-4 w-4 text-primary" /> Falar com o time
              </p>
              {aguardandoRetorno ? (
                <p className="flex items-start gap-1.5 rounded bg-primary/10 px-2.5 py-2 text-xs text-primary">
                  <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  O time pediu mais informações. Responda na <b>conversa do chamado</b> e ele volta para atendimento.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Use a <b>conversa do chamado</b>, ao lado: dá para escrever, anexar arquivos e colar prints com Ctrl+V.
                </p>
              )}
            </Card>
          )}

          {/* Avaliação — só em chamados concluídos */}
          {chamado.status === "concluido" && (
            avaliacao ? (
              <CardAvaliacao avaliacao={avaliacao} titulo="Sua avaliação" />
            ) : ehSolicitante ? (
              <Card className="animate-rise-in space-y-3 border-warning/40 bg-warning/5 p-4">
                <p className="flex items-center gap-1.5 text-sm font-bold"><Star className="h-4 w-4 text-warning animate-pulse-soft" /> Avaliar atendimento</p>
                <p className="text-xs text-muted-foreground">Chamado concluído. Avalie o atendimento em 6 critérios — o comentário é opcional.</p>
                <Button className="w-full gap-2 transition-transform active:scale-95" onClick={() => setAvaliarAberto(true)}>
                  <Star className="h-4 w-4" /> Avaliar chamado
                </Button>
              </Card>
            ) : null
          )}

          {encerrado && (
            <Card className="p-4 text-xs text-muted-foreground">
              Este chamado está <b>{chamado.status === "concluido" ? "concluído" : "reprovado"}</b> e não aceita mais informações.
            </Card>
          )}
        </div>
      </div>

      <AvaliarChamadoDialog
        open={avaliarAberto}
        onOpenChange={setAvaliarAberto}
        chamado={{ id: chamado.id, numero: chamado.numero }}
      />
    </div>
  );
}
