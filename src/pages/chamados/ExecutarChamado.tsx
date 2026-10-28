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
import { CalendarClock, PlayCircle, CheckCircle2, MessageSquare, XCircle, Paperclip, ArrowLeft, Trash2, Star, RotateCcw, GitPullRequest, UserCheck } from "lucide-react";
import { AvaliarSolicitanteDialog } from "./AvaliarSolicitanteDialog";
import { ExcluirChamadoDialog } from "./ExcluirChamadoDialog";
import { abrirPrGithub } from "./abrirPrGithub";
import { BotaoAdicionarParticipante } from "./ParticipantesChamado";
import { ReabrirChamadoDialog } from "./ReabrirChamadoDialog";
import { IniciarDesenvolvimentoDialog } from "./IniciarDesenvolvimentoDialog";
import {
  SITUACOES_PRAZO, desceuNaFila, podeDefinirPrazo, podeIniciarDesenvolvimento, situacaoPrazo,
} from "@/lib/chamados/prazoDesenvolvimento";
import { ChatChamado } from "./ChatChamado";
import { BotaoStatusChamado, CardTreinamento, CardValidacaoPresidencia, useValidacaoChamado } from "./StatusValidacao";
import {
  StatusBadge, SeloConfirmacao, SeloDesenvolvimento, PrioridadeBadge, STATUS_CHAMADO, CardAvaliacao,
  CATEGORIAS, TIPOS, IMPACTOS, URGENCIAS, AMBIENTES,
  labelDe, moduloLabel, fmtData, fmtDataHora, podeReabrirChamado, chamadoEncerrado,
  BUCKET_CHAMADOS, opcoesDownloadAnexo, type Chamado, type Anexo, type Evento, type AvaliacaoChamado,
  CRITERIOS_AVALIACAO_SOLICITANTE, DEV_AVALIA_SOLICITANTE_DESDE, type AvaliacaoSolicitante,
} from "./types";
import { useAnexoChamado } from "./useAnexoChamado";

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
  const [reabrindoOpen, setReabrindoOpen] = useState(false);
  const [agindo, setAgindo] = useState<string | null>(null); // ação em curso (trava cliques repetidos)
  const [flash, setFlash] = useState(false);                 // pisca o selo de status ao mudar
  // Concluir passa pela avaliação de quem pediu (mig 20261020000070) — com
  // a saída "Concluir sem avaliar" dentro do próprio diálogo.
  const [concluindoOpen, setConcluindoOpen] = useState(false);
  const [avaliarDepoisOpen, setAvaliarDepoisOpen] = useState(false);
  // Iniciar desenvolvimento / alterar prazo (mig 20261028001400).
  const [iniciarOpen, setIniciarOpen] = useState(false);
  // Definir / redefinir o prazo em dias (mig 20261028001500).
  const [prazoOpen, setPrazoOpen] = useState(false);

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

  // O que o dev (ou a gestão) achou de quem pediu. O RLS só devolve a quem
  // avaliou, ao responsável e à gestão — para os demais a lista vem vazia.
  const { data: avaliacoesDev = [] } = useQuery({
    queryKey: ["chamado-avaliacao-dev", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await (supabase as any).from("CHAMADO_SISTEMA_AVALIACAO_DEV").select("*").eq("chamado_id", id).order("created_at");
      return (data ?? []) as AvaliacaoSolicitante[];
    },
  });

  // Validação da Presidência (mig 266) — null quando o chamado não foi enviado.
  const { data: validacao } = useValidacaoChamado(id);

  const ehResponsavel = !!chamado && chamado.responsavel_id === user?.id;
  // Participante extra (mig 20261009000003) — vem pelo Painel do Desenvolvedor desde 20/10/2026.
  const { data: ehParticipante = false } = useQuery({
    queryKey: ["chamado-sou-participante", id, user?.id],
    enabled: !!id && !!user?.id,
    queryFn: async () => {
      const { data } = await (supabase as any).from("CHAMADO_SISTEMA_PARTICIPANTE")
        .select("id").eq("chamado_id", id).eq("user_id", user!.id).maybeSingle();
      return !!data;
    },
  });
  const podeAgir = canCoordenar || canAprovar || (canDev && ehResponsavel);

  // Dev responsável abriu o chamado → zera a bolinha de novidades do dev.
  useEffect(() => { if (ehResponsavel) chamadosMarkSeen(user?.id, "dev"); }, [ehResponsavel, user?.id]);
  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["chamado", id] });
    qc.invalidateQueries({ queryKey: ["chamado-eventos", id] });
    qc.invalidateQueries({ queryKey: ["chamados-meus-atribuidos", user?.id] });
    // Concluir/reabrir move a etapa da Presidência (trigger no banco).
    qc.invalidateQueries({ queryKey: ["chamado-validacao", id] });
    qc.invalidateQueries({ queryKey: ["chamado-validacoes"] });
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

  /** Fim do diálogo de concluir: grava o status e diz no histórico se houve avaliação. */
  const concluirAposAvaliar = async (resultado: "avaliou" | "pulou" | "ninguem") => {
    await mudarStatus(
      "concluido",
      resultado === "pulou" ? "Chamado concluído (sem avaliar quem pediu)" : "Chamado concluído",
      "concluido",
    );
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

  // Imagem abre num card no centro; o resto, em nova aba (useAnexoChamado).
  const { abrirAnexo: baixarAnexo, visualizador } = useAnexoChamado();

  if (!chamado) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;

  const anexosAbertura = anexos.filter((a) => (a.campo ?? "abertura") === "abertura");
  // Anexos de resposta anteriores ao chat: não pertencem a mensagem nenhuma, então
  // não têm balão onde aparecer — seguem listados à parte.
  const anexosLegado = anexos.filter((a) => a.campo && a.campo !== "abertura" && !a.evento_id);
  const encerrado = chamadoEncerrado(chamado.status);

  const Campo = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="text-sm">{children || "—"}</div>
    </div>
  );

  return (
    <div>
      {/* Imagem do anexo aberta num card no centro (useAnexoChamado). */}
      {visualizador}
      <PageHeader
        title={`#${chamado.numero}`}
        subtitle={chamado.assunto}
        module="Sistemas"
        breadcrumb={["Chamados de Sistemas", `#${chamado.numero}`]}
        actions={
          <div className="flex flex-wrap gap-2">
            <BotaoStatusChamado chamado={chamado} validacao={validacao} nomeDe={nomeDe} size="default" />
            <Button variant="outline" className="gap-1.5" onClick={() => nav("/app/sistemas/chamados/dev")}><ArrowLeft className="h-4 w-4" /> Meus chamados</Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <Card className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold">Informações do chamado</p>
              <span className={`flex items-center gap-1.5 rounded-full ${flash ? "animate-status-flash" : ""}`}>
                <SeloConfirmacao chamado={chamado} />
                <SeloDesenvolvimento chamado={chamado} />
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
              {/* Prazo esperado por quem abriu (mig 20261028001600). */}
              <Campo label="Prazo do solicitante">{chamado.prazo_solicitante ? fmtData(`${chamado.prazo_solicitante}T12:00:00`) : "—"}</Campo>
            </div>
          </Card>

          {chamado.comentario_gerente && (
            <Card className="space-y-1 border-primary/30 bg-primary/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Comentário do gerente de sistemas</p>
              <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{chamado.comentario_gerente}</p>
            </Card>
          )}
          {chamado.observacao_gerente && (
            <Card className="space-y-1 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Observação do gerente</p>
              <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{chamado.observacao_gerente}</p>
            </Card>
          )}

          {avaliacao && (
            <CardAvaliacao avaliacao={avaliacao} titulo="Avaliação do solicitante" tone="warning" />
          )}

          {avaliacoesDev.map((a) => (
            <CardAvaliacao
              key={a.id} avaliacao={a} tone="info" criterios={CRITERIOS_AVALIACAO_SOLICITANTE}
              titulo={`${nomeDe(a.avaliador_id)} avaliou ${nomeDe(a.avaliado_id)} (${a.papel === "solicitante" ? "solicitante" : "participante"})`}
            />
          ))}

          <Card className="space-y-3 p-4">
            <p className="text-sm font-bold">Descrição e evidências (abertura)</p>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Descrição detalhada</p>
              <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{chamado.descricao || "—"}</p>
            </div>
            {chamado.observacoes_solicitante && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Observações do solicitante</p>
                <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{chamado.observacoes_solicitante}</p>
              </div>
            )}
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Anexos da abertura ({anexosAbertura.length})</p>
              <div className="space-y-1">
                {anexosAbertura.map((a) => (
                  <button key={a.id} onClick={() => baixarAnexo(a)} className="flex w-full items-center gap-2 rounded border border-border px-2.5 py-1.5 text-left text-xs hover:border-primary/40">
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
                  <button key={a.id} onClick={() => baixarAnexo(a)} className="flex w-full items-center gap-2 rounded border border-border px-2.5 py-1.5 text-left text-xs hover:border-primary/40">
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
          {/* Participante extra que abre pelo Painel do Desenvolvedor
              (20/10/2026): conversa como participante — mensagem pública
              sim, observação interna não (a RLS também barra). */}
          <ChatChamado
            chamadoId={chamado.id}
            solicitanteId={chamado.solicitante_id}
            perfil={podeAgir || !ehParticipante ? "equipe" : "solicitante"}
            encerrado={encerrado}
            somenteLeitura={!podeAgir && !ehParticipante}
          />
        </div>

        {/* Coluna de execução */}
        <div className="space-y-4">
          <CardValidacaoPresidencia chamado={chamado} validacao={validacao} nomeDe={nomeDe} />
          {/* Presidência aprovou → o dev (ou a gestão, por ele) ENVIA o
              treinamento a usuários/setores; cada participante confirma em
              Central de Serviços › Treinamentos › Treinamentos Sistemas (mig 269). */}
          <CardTreinamento chamado={chamado} validacao={validacao} nomeDe={nomeDe} />
          <Card className="space-y-3 p-4">
            <p className="text-sm font-bold">Execução do chamado</p>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status atual</p>
              {podeAgir ? (
                <Select value={chamado.status} onValueChange={(v) => (v === "concluido" && chamado.status !== "concluido"
                  ? setConcluindoOpen(true)
                  : mudarStatus(v, `Status alterado para ${STATUS_CHAMADO[v]?.label ?? v}`, "status"))}>
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
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Prazo (dias úteis)</p>
              {/* SIS-2026-0763 (mig 20261028001500): prazo em dias úteis,
                  definido pelo dev ao receber a tarefa e TRAVADO — só
                  redefine quando a tarefa desce na fila. A previsão de
                  entrega é início + prazo; antes de iniciar, depende da fila. */}
              {chamado.prazo_dias ? (
                <p className="text-sm font-medium">
                  {chamado.prazo_dias} dia(s) útil(eis)
                  {!!chamado.prazo_redefinicoes && <span className="text-xs font-normal text-muted-foreground"> · redefinido {chamado.prazo_redefinicoes}x</span>}
                </p>
              ) : (
                <p className="text-xs text-warning">Ainda não definido — obrigatório para iniciar.</p>
              )}
              {desceuNaFila(chamado) && (
                <p className="mt-1 text-xs text-destructive">A tarefa desceu na fila ({chamado.prazo_posicao_fila}º → {chamado.posicao_dev}º): redefina o prazo.</p>
              )}
              {/* O prazo real é informado ao iniciar (botão em Ações rápidas);
                  depois, só redefine se a tarefa descer na fila. */}
              {podeAgir && chamado.prazo_dias != null && podeDefinirPrazo(chamado) && (
                <Button variant="outline" size="sm" className="mt-1.5 h-8 gap-1.5" onClick={() => setPrazoOpen(true)}>
                  <CalendarClock className="h-3.5 w-3.5" /> Redefinir prazo
                </Button>
              )}
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Previsão de entrega</p>
              {chamado.prazo_conclusao_em ? (
                <p className="text-sm font-medium">{fmtData(chamado.prazo_conclusao_em)}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{chamado.prazo_dias ? "Conta a partir do início do desenvolvimento (veja a projeção no Painel do Desenvolvedor)." : "—"}</p>
              )}
              {(() => {
                const sit = situacaoPrazo(chamado, chamado.prazo_conclusao_em ? { data: new Date(chamado.prazo_conclusao_em), projetada: false } : null);
                return sit && (chamado.prazo_conclusao_em || chamado.status === "concluido") ? (
                  <span className={`mt-1 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${SITUACOES_PRAZO[sit].cls}`}>{SITUACOES_PRAZO[sit].label}</span>
                ) : null;
              })()}
            </div>
            {chamado.desenvolvimento_iniciado_em && (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Desenvolvimento iniciado</p>
                <p className="text-sm">{fmtDataHora(chamado.desenvolvimento_iniciado_em)} · {nomeDe(chamado.desenvolvimento_iniciado_por ?? null)}</p>
              </div>
            )}
          </Card>

          {podeAgir && (
            <Card className="space-y-2 p-4">
              <p className="text-sm font-bold">Ações rápidas</p>
              {chamado.status === "concluido" ? (
                <>
                  <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm font-semibold text-success">
                    <CheckCircle2 className="h-4 w-4 animate-check-pop" /> Chamado concluído
                  </div>
                  {/* Concluir não fecha de vez (mig 20261028001300): o
                      solicitante confere e confirma — ou reabre e volta pra cá. */}
                  {!chamado.conclusao_confirmada_em && (
                    <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                      Aguardando o solicitante <b>confirmar a conclusão</b>. Se não resolveu, ele reabre e o chamado volta para você.
                    </p>
                  )}
                  {/* Concluído sem passar pelo diálogo (merge da PR) ou pulado:
                      dá para avaliar depois. Só de agora em diante — os
                      concluídos antes da mudança ficam de fora. */}
                  {!!chamado.concluido_em && new Date(chamado.concluido_em) >= new Date(DEV_AVALIA_SOLICITANTE_DESDE)
                    && !avaliacoesDev.some((a) => a.avaliador_id === user?.id) && (
                    <Button variant="outline" className="w-full justify-start gap-2 transition-transform active:scale-95" onClick={() => setAvaliarDepoisOpen(true)}>
                      <UserCheck className="h-4 w-4 text-info" /> Avaliar quem pediu
                    </Button>
                  )}
                </>
              ) : (
                <>
                {/* Em desenvolvimento (mig 20261028001400): o dev avisa o
                    solicitante que começou — com prazo obrigatório. */}
                {podeIniciarDesenvolvimento(chamado) && (
                  <Button
                    className="w-full justify-start gap-2 transition-transform active:scale-95"
                    disabled={!!agindo}
                    onClick={() => setIniciarOpen(true)}
                  >
                    <PlayCircle className="h-4 w-4" /> Iniciar desenvolvimento
                  </Button>
                )}
                <Button
                  className="w-full justify-start gap-2 bg-success text-success-foreground transition-transform hover:bg-success/90 active:scale-95 disabled:opacity-60"
                  disabled={!!agindo}
                  onClick={() => setConcluindoOpen(true)}
                >
                  <CheckCircle2 className="h-4 w-4" /> {agindo === "concluido" ? "Concluindo…" : "Concluir chamado"}
                </Button>
                </>
              )}
              {/* Mesmo "Abrir PR" da fila do Painel do Desenvolvedor: GitHub já
                  com título (número do chamado) e descrição preenchidos. Fica
                  visível mesmo concluído — a 2ª PR de uma entrega sai daqui. */}
              <Button
                variant="outline"
                className="w-full justify-start gap-2 transition-transform active:scale-95"
                onClick={() => abrirPrGithub(chamado, null, user?.id, toast)}
                title="Abrir PR no GitHub já preenchida com os dados deste chamado"
              >
                <GitPullRequest className="h-4 w-4 text-primary" /> Abrir PR
              </Button>
              {/* Participantes extras (mig 20261009000003): veem o chamado e,
                  concluído, também avaliam antes de abrir outro chamado. */}
              <BotaoAdicionarParticipante chamado={chamado} />
              {/* Logo abaixo do selo de concluído: é ali que se percebe que o
                  chamado fechou cedo demais — ex.: falta a 2ª PR da entrega. */}
              {podeReabrirChamado(chamado, { canCoordenar, canAprovar, canDev, userId: user?.id }) && (
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 transition-transform active:scale-95"
                  onClick={() => setReabrindoOpen(true)}
                >
                  <RotateCcw className="h-4 w-4 text-primary" /> Reabrir chamado
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
              {canAprovar && !chamadoEncerrado(chamado.status) && (
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

      <AvaliarSolicitanteDialog
        open={concluindoOpen} onOpenChange={setConcluindoOpen}
        chamado={chamado} modo="concluir" onConcluir={concluirAposAvaliar}
      />
      <AvaliarSolicitanteDialog
        open={avaliarDepoisOpen} onOpenChange={setAvaliarDepoisOpen}
        chamado={chamado} modo="avaliar"
      />

      <ReabrirChamadoDialog
        open={reabrindoOpen}
        onOpenChange={setReabrindoOpen}
        chamado={chamado}
        onReaberto={invalidar}
      />

      <IniciarDesenvolvimentoDialog
        open={prazoOpen}
        onOpenChange={setPrazoOpen}
        chamado={chamado}
        modo="definir"
        onFeito={invalidar}
      />

      <IniciarDesenvolvimentoDialog
        open={iniciarOpen}
        onOpenChange={setIniciarOpen}
        chamado={chamado}
        onFeito={invalidar}
      />

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
