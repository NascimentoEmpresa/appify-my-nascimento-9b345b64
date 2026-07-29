import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { chamadosMarkSeen } from "@/hooks/useChamadosNotif";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, MessageSquarePlus, Paperclip, Send, RotateCcw, Star } from "lucide-react";
import { AvaliarChamadoDialog } from "./AvaliarChamadoDialog";
import {
  StatusBadge, PrioridadeBadge, Estrelas,
  CATEGORIAS, TIPOS, IMPACTOS, URGENCIAS, AMBIENTES, CRITERIOS_AVALIACAO, mediaAvaliacao,
  labelDe, moduloLabel, fmtData, fmtDataHora,
  BUCKET_CHAMADOS, type Chamado, type Anexo, type Evento, type AvaliacaoChamado,
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

  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
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

  // O solicitante só enxerga eventos não-internos (a RLS filtra 'observacao_interna').
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

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["chamado", id] });
    qc.invalidateQueries({ queryKey: ["chamado-eventos", id] });
    qc.invalidateQueries({ queryKey: ["chamados-meus", user?.id] });
    qc.invalidateQueries({ queryKey: ["chamados-meus-stats"] });
  };

  const enviarInfo = async () => {
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    const { error } = await (supabase as any).rpc("chamado_adicionar_informacao", {
      p_chamado_id: id, p_texto: texto.trim(),
    });
    if (error) {
      toast({ title: "Erro ao adicionar informações", description: error.message, variant: "destructive" });
      setEnviando(false);
      return;
    }
    supabase.functions.invoke("enviar-notificacao-push", { body: { chamado_id: id, evento: "info_adicionada" } }).catch(() => {});
    setTexto("");
    setEnviando(false);
    toast({ title: "Informações enviadas", description: "O chamado voltou para o time." });
    invalidar();
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

          {/* Histórico do chamado (visível ao solicitante) */}
          <Card className="space-y-2 p-4">
            <p className="text-sm font-bold">Histórico do chamado</p>
            <div className="space-y-2 pt-1">
              {eventos.map((e) => (
                <div key={e.id} className="rounded border border-border/60 px-2.5 py-1.5">
                  <p className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">{nomeDe(e.autor_id)}</span>
                    {e.tipo === "comentario" && e.autor_id === chamado.solicitante_id && (
                      <span className="rounded bg-primary/10 px-1.5 text-[9px] font-semibold uppercase text-primary">informação adicionada</span>
                    )}
                    {e.tipo === "comentario" && e.autor_id !== chamado.solicitante_id && (
                      <span className="rounded bg-info/10 px-1.5 text-[9px] font-semibold uppercase text-info">comentário</span>
                    )}
                    {e.tipo === "evento" && <span className="rounded bg-muted px-1.5 text-[9px] font-semibold uppercase">evento</span>}
                    <span>{fmtDataHora(e.created_at)}</span>
                  </p>
                  {e.texto && <p className="whitespace-pre-wrap text-xs">{e.texto}</p>}
                </div>
              ))}
              {eventos.length === 0 && <p className="text-xs text-muted-foreground">Sem histórico ainda.</p>}
            </div>
          </Card>
        </div>

        {/* Coluna de ação do solicitante */}
        <div className="space-y-4">
          {ehSolicitante && !encerrado && (
            <Card className={`space-y-3 p-4 ${aguardandoRetorno ? "border-primary/40 bg-primary/5" : ""}`}>
              <p className="flex items-center gap-1.5 text-sm font-bold">
                <MessageSquarePlus className="h-4 w-4 text-primary" /> Adicionar mais informações
              </p>
              {aguardandoRetorno ? (
                <p className="flex items-start gap-1.5 rounded bg-primary/10 px-2.5 py-2 text-xs text-primary">
                  <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  O time pediu mais informações. Descreva abaixo e o chamado volta para atendimento.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Precisa complementar algo? Adicione aqui — fica registrado no histórico.</p>
              )}
              <Textarea
                rows={5} maxLength={2000}
                placeholder="Descreva as informações solicitadas…"
                value={texto} onChange={(e) => setTexto(e.target.value)}
              />
              <Button className="w-full gap-2" onClick={enviarInfo} disabled={!texto.trim() || enviando}>
                <Send className="h-4 w-4" /> {enviando ? "Enviando…" : "Enviar informações"}
              </Button>
            </Card>
          )}

          {/* Avaliação — só em chamados concluídos */}
          {chamado.status === "concluido" && (
            avaliacao ? (
              <Card className="animate-rise-in space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-sm font-bold"><Star className="h-4 w-4 text-warning" /> Sua avaliação</p>
                  <div className="flex items-center gap-1.5">
                    <Estrelas valor={mediaAvaliacao(avaliacao)} size={16} />
                    <span className="text-xs font-semibold text-muted-foreground">{mediaAvaliacao(avaliacao).toFixed(1).replace(".", ",")}</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {CRITERIOS_AVALIACAO.map((c) => (
                    <div key={c.key} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">{c.titulo}</span>
                      <Estrelas valor={avaliacao[c.key]} size={13} />
                    </div>
                  ))}
                </div>
                {avaliacao.comentario && <p className="whitespace-pre-wrap border-t border-border/60 pt-2 text-xs text-muted-foreground">{avaliacao.comentario}</p>}
                <p className="text-[11px] text-muted-foreground">Enviada em {fmtDataHora(avaliacao.created_at)}</p>
              </Card>
            ) : ehSolicitante ? (
              <Card className="animate-rise-in space-y-3 border-warning/40 bg-warning/5 p-4">
                <p className="flex items-center gap-1.5 text-sm font-bold"><Star className="h-4 w-4 text-warning animate-pulse-soft" /> Avaliar atendimento</p>
                <p className="text-xs text-muted-foreground">Chamado concluído. Avalie o atendimento em 5 critérios — o comentário é opcional.</p>
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
