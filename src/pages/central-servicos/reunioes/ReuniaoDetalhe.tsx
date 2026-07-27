import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  ArrowLeft, Bell, BellRing, CalendarDays, CalendarPlus, CheckCircle2, Clock, Download, FileDown, MapPin, Pencil, Play,
  Trash2, UserPlus, Users, Video, X, XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useReuniaoDetalhe } from "./useReuniaoDetalhe";
import { useUsuariosAtivos, useEditarSerieRecorrente, useExcluirReunioesEmMassa, verificarConflitoSala, verificarConflitoParticipante } from "./useReunioes";
import { PautaTabela } from "./componentes/PautaTabela";
import { EditarDiaHorarioDialog } from "./componentes/EditarDiaHorarioDialog";
import { PresencaBadge } from "./componentes/PresencaBadge";
import { AssinaturasPanel } from "./componentes/AssinaturasPanel";
import { AnexosPainel } from "./componentes/AnexosPainel";
import { ComentariosPainel } from "./componentes/ComentariosPainel";
import { HistoricoPainel } from "./componentes/HistoricoPainel";
import { exportarConvocacaoPdf } from "./pdf/convocacaoPdf";
import { exportarAtaFinalPdf } from "./pdf/ataFinalPdf";
import { buildGoogleCalendarUrl, baixarIcs } from "@/lib/calendarExport";
import { ETAPA_COR, ETAPA_LABEL, nomeUsuario, SALAS_PRESENCIAIS, TIPO_REUNIAO_LABEL, type TipoLocalReuniao } from "./types";

function iniciaisUsuario(nome: string): string {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

function CampoEditavel({
  icon, label, valor, editavel, editor,
}: {
  icon: React.ReactNode;
  label: string;
  valor: React.ReactNode;
  editavel: boolean;
  editor?: (fechar: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{valor}</p>
      </div>
      {editavel && editor && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0"><Pencil className="h-3 w-3" /></Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 space-y-2">{editor(() => setOpen(false))}</PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function EditorDataHora({ dataHoraAtual, onSalvar }: { dataHoraAtual: string; onSalvar: (iso: string, justificativa: string) => Promise<void> }) {
  const d = new Date(dataHoraAtual);
  const [data, setData] = useState(d.toISOString().slice(0, 10));
  const [hora, setHora] = useState(d.toTimeString().slice(0, 5));
  const [justificativa, setJustificativa] = useState("");
  const [salvando, setSalvando] = useState(false);
  return (
    <>
      <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
      <Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
      <Textarea
        value={justificativa}
        onChange={(e) => setJustificativa(e.target.value)}
        placeholder="Estou Alterando o Horário Pelo Motivo..."
        className="min-h-16 text-sm"
      />
      <Button
        size="sm"
        className="w-full"
        disabled={!data || !hora || !justificativa.trim() || salvando}
        onClick={async () => {
          setSalvando(true);
          await onSalvar(new Date(`${data}T${hora}:00`).toISOString(), justificativa.trim());
          setSalvando(false);
        }}
      >
        {salvando ? "Salvando…" : "Salvar"}
      </Button>
    </>
  );
}

function EditorLocal({
  tipoAtual, localAtual, linkAtual, onSalvar,
}: {
  tipoAtual: TipoLocalReuniao;
  localAtual: string;
  linkAtual: string | null;
  onSalvar: (tipo: TipoLocalReuniao, local: string, linkOnline: string | null) => Promise<void>;
}) {
  const [tipo, setTipo] = useState(tipoAtual);
  const usaSalaInicial = tipoAtual === "presencial" || tipoAtual === "hibrido";
  const salaInicial = usaSalaInicial && (SALAS_PRESENCIAIS as readonly string[]).includes(localAtual) ? localAtual : (usaSalaInicial ? "Outro" : "");
  const [sala, setSala] = useState(salaInicial);
  const [outro, setOutro] = useState(usaSalaInicial && salaInicial === "Outro" ? localAtual : "");
  const [link, setLink] = useState(tipoAtual === "online" ? localAtual : (tipoAtual === "hibrido" ? (linkAtual ?? "") : ""));
  const [salvando, setSalvando] = useState(false);

  const usaSala = tipo === "presencial" || tipo === "hibrido";
  const usaLink = tipo === "online" || tipo === "hibrido";
  const salaFinal = sala === "Outro" ? outro.trim() : sala;
  const localFinal = usaSala ? salaFinal : link.trim();
  const podeSalvar = (!usaSala || salaFinal) && (!usaLink || link.trim());

  return (
    <>
      <Select value={tipo} onValueChange={(v) => { setTipo(v as TipoLocalReuniao); setSala(""); setOutro(""); setLink(""); }}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="presencial">Presencial</SelectItem>
          <SelectItem value="online">Online</SelectItem>
          <SelectItem value="hibrido">Híbrido</SelectItem>
        </SelectContent>
      </Select>
      {usaSala && (
        <>
          <Select value={sala} onValueChange={setSala}>
            <SelectTrigger><SelectValue placeholder="Selecione a sala" /></SelectTrigger>
            <SelectContent>
              {SALAS_PRESENCIAIS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {sala === "Outro" && <Input value={outro} onChange={(e) => setOutro(e.target.value)} placeholder="Descreva" />}
        </>
      )}
      {usaLink && <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link da reunião" />}
      <Button
        size="sm"
        className="w-full"
        disabled={!podeSalvar || salvando}
        onClick={async () => {
          setSalvando(true);
          await onSalvar(tipo, localFinal, tipo === "hibrido" ? link.trim() : null);
          setSalvando(false);
        }}
      >
        {salvando ? "Salvando…" : "Salvar"}
      </Button>
    </>
  );
}

function EditorOrganizador({ atual, opcoes, onSalvar }: { atual: string; opcoes: { value: string; label: string }[]; onSalvar: (userId: string) => Promise<void> }) {
  const [valor, setValor] = useState(atual);
  return (
    <>
      <SearchableSelect value={valor} onChange={setValor} options={opcoes} placeholder="Selecionar organizador" />
      <Button size="sm" className="w-full" disabled={!valor} onClick={() => onSalvar(valor)}>Salvar</Button>
    </>
  );
}

export default function ReuniaoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const push = usePushNotifications();
  const { data: usuarios = [] } = useUsuariosAtivos();
  const [novoConvidado, setNovoConvidado] = useState("");
  const [novoPapel, setNovoPapel] = useState<"convidado" | "observador">("convidado");
  const [motivoCancelamento, setMotivoCancelamento] = useState("");
  const [participantesOpen, setParticipantesOpen] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [serieOpen, setSerieOpen] = useState(false);
  const editarSerie = useEditarSerieRecorrente();
  const excluirLote = useExcluirReunioesEmMassa();

  const {
    reuniao, isLoading, pauta, respostas, convidados, anexos, pautaAnexos, comentarios, assinaturas, logs,
    cancelarReuniao, excluirReuniao, encerrarReuniao, atualizarCampos,
    salvarPautaItem, atualizarPautaItem, reordenarPauta, removerPautaItem, salvarResposta,
    uploadAnexo, removerAnexo, downloadAnexo, uploadPautaAnexo, removerPautaAnexo,
    adicionarConvidado, removerConvidado, marcarPresenca, adicionarComentario, removerComentario, salvarAssinatura,
  } = useReuniaoDetalhe(id);

  const confirmacoes = useMemo(() => ({
    confirmados: convidados.filter((c) => c.presente === true).length,
    pendentes: convidados.filter((c) => c.presente === null).length,
    naoPoderao: convidados.filter((c) => c.presente === false).length,
  }), [convidados]);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Carregando reunião…</div>;
  if (!reuniao) {
    return (
      <div className="space-y-4 p-6">
        <p className="text-sm text-muted-foreground">Reunião não encontrada.</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/app/central-servicos/reunioes"><ArrowLeft className="mr-1 h-4 w-4" /> Voltar</Link>
        </Button>
      </div>
    );
  }

  const podeGerenciar = user?.id === reuniao.criado_por || user?.id === reuniao.responsavel_preenchimento_user_id || user?.id === reuniao.organizador_user_id;
  const souParticipante = podeGerenciar || convidados.some((c) => c.user_id === user?.id);
  const reuniaoEncerrada = reuniao.etapa === "concluida" || reuniao.etapa === "cancelada";
  const opcoesConvidaveis = usuarios
    .filter((u) => !convidados.some((c) => c.user_id === u.id))
    .map((u) => ({ value: u.id, label: u.display_name }));
  const opcoesUsuarios = usuarios.map((u) => ({ value: u.id, label: u.display_name }));

  const cancelar = async () => {
    if (!motivoCancelamento.trim()) return;
    if (await cancelarReuniao(motivoCancelamento.trim())) setMotivoCancelamento("");
  };

  const excluir = async () => {
    setExcluindo(true);
    const ok = await excluirReuniao();
    setExcluindo(false);
    if (ok) navigate("/app/central-servicos/reunioes");
  };

  const excluirSerie = async () => {
    if (!reuniao?.serie_recorrencia_id) return;
    const { data: reunioesDaSerie } = await (supabase as any)
      .from("reuniao")
      .select("id")
      .eq("serie_recorrencia_id", reuniao.serie_recorrencia_id)
      .eq("etapa", "agendada")
      .gt("data_hora", new Date().toISOString());
    const ids = ((reunioesDaSerie ?? []) as { id: string }[]).map((r) => r.id);
    if (ids.length === 0) return;
    await excluirLote.mutateAsync(ids);
  };

  const convidar = async () => {
    if (!novoConvidado) return;
    const nome = nomeUsuario(usuarios, novoConvidado) ?? undefined;
    const conflito = await verificarConflitoParticipante({
      userId: novoConvidado,
      dataHoraIso: reuniao.data_hora,
      duracaoMinutos: reuniao.duracao_minutos,
      reuniaoIdIgnorar: reuniao.id,
    });
    if (conflito) {
      toast({ title: "Conflito de horário", description: `${nome ?? "Este participante"} já está em outra reunião nesse horário (reunião "${conflito.titulo}").`, variant: "destructive" });
      return;
    }
    if (await adicionarConvidado(novoConvidado, nome, novoPapel)) { setNovoConvidado(""); setNovoPapel("convidado"); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={reuniao.titulo}
        module="Central de Serviços"
        breadcrumb={["Agenda de Reunião", reuniao.numero, "Detalhe"]}
        subtitle={reuniao.objetivo ?? undefined}
        actions={
          <>
            {push.suportado && push.inscrito && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <BellRing className="h-3.5 w-3.5" /> Notificações ativadas
              </span>
            )}
            {push.suportado && !push.inscrito && !push.precisaInstalar && (
              <Button
                variant="outline" size="sm" className="gap-1.5" disabled={push.ativando}
                onClick={async () => {
                  try {
                    const ok = await push.ativarNotificacoes();
                    toast(ok
                      ? { title: "Notificações ativadas" }
                      : { title: "Permissão negada", description: "Habilite notificações nas configurações do navegador.", variant: "destructive" });
                  } catch (e) {
                    toast({ title: "Erro ao ativar notificações", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
                  }
                }}
              >
                <Bell className="h-3.5 w-3.5" /> {push.ativando ? "Ativando…" : "Ativar notificações"}
              </Button>
            )}
            {podeGerenciar && reuniao.etapa === "agendada" && (
              <Button asChild size="sm" className="gap-1.5">
                <Link to={`/app/central-servicos/reunioes/${reuniao.id}/conducao`}><Play className="h-3.5 w-3.5" /> Iniciar Reunião</Link>
              </Button>
            )}
            {souParticipante && reuniao.etapa === "em_andamento" && (
              <Button asChild size="sm" className="gap-1.5">
                <Link to={`/app/central-servicos/reunioes/${reuniao.id}/conducao`}>
                  <Play className="h-3.5 w-3.5" /> {podeGerenciar ? "Conduzir Reunião" : "Marcar presença"}
                </Link>
              </Button>
            )}
            {podeGerenciar && reuniao.etapa === "em_andamento" && (
              <Button size="sm" variant="destructive" className="gap-1.5" onClick={() => encerrarReuniao(usuarios)}>
                Encerrar Reunião
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link to="/app/central-servicos/reunioes"><ArrowLeft className="mr-1 h-4 w-4" /> Voltar</Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={ETAPA_COR[reuniao.etapa]}>{ETAPA_LABEL[reuniao.etapa]}</Badge>
        {reuniao.tipo_reuniao && <Badge variant="outline">{TIPO_REUNIAO_LABEL[reuniao.tipo_reuniao]}</Badge>}
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.open(buildGoogleCalendarUrl(reuniao), "_blank", "noopener,noreferrer")}>
          <CalendarPlus className="h-3.5 w-3.5" /> Adicionar ao Google Calendar
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => baixarIcs(reuniao)}>
          <Download className="h-3.5 w-3.5" /> Baixar .ics
        </Button>
        {podeGerenciar && reuniao.serie_recorrencia_id && !reuniaoEncerrada && (
          <>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSerieOpen(true)}>
              <CalendarDays className="h-3.5 w-3.5" /> Editar série
            </Button>
            <EditarDiaHorarioDialog
              open={serieOpen}
              onOpenChange={setSerieOpen}
              titulo="Editar série recorrente"
              descricao="Muda o dia da semana e o horário de todas as próximas ocorrências dessa série que ainda não aconteceram. Reuniões passadas, em andamento, concluídas ou canceladas não são alteradas."
              salvando={editarSerie.isPending}
              onSalvar={async (novoDiaSemana, novoHorario) => {
                await editarSerie.mutateAsync({ serieId: reuniao.serie_recorrencia_id!, novoDiaSemana, novoHorario });
                setSerieOpen(false);
              }}
            />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /> Excluir série</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir as próximas reuniões desta série?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Apaga todas as ocorrências futuras ainda "agendada" dessa série (com tudo dentro — pauta, anexos, convidados). Reuniões passadas, em andamento ou já concluídas não são afetadas. Sem volta.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Voltar</AlertDialogCancel>
                  <AlertDialogAction disabled={excluirLote.isPending} onClick={excluirSerie}>
                    {excluirLote.isPending ? "Excluindo…" : "Confirmar exclusão"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
        {podeGerenciar && !reuniaoEncerrada && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:text-destructive"><X className="h-3.5 w-3.5" /> Cancelar reunião</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancelar esta reunião?</AlertDialogTitle>
                <AlertDialogDescription>Essa ação não pode ser desfeita.</AlertDialogDescription>
              </AlertDialogHeader>
              <Textarea placeholder="Motivo do cancelamento *" value={motivoCancelamento} onChange={(e) => setMotivoCancelamento(e.target.value)} />
              <AlertDialogFooter>
                <AlertDialogCancel>Voltar</AlertDialogCancel>
                <AlertDialogAction disabled={!motivoCancelamento.trim()} onClick={cancelar}>Confirmar cancelamento</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {podeGerenciar && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /> Excluir reunião</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir esta reunião?</AlertDialogTitle>
                <AlertDialogDescription>
                  Isso apaga a reunião, pauta, respostas, decisões e ações, anexos, convidados e histórico — tudo, sem volta. Ações já criadas no Plano de Ações não são apagadas de lá.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Voltar</AlertDialogCancel>
                <AlertDialogAction disabled={excluindo} onClick={excluir}>{excluindo ? "Excluindo…" : "Confirmar exclusão"}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      <Card className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <CampoEditavel
          icon={<CalendarDays className="h-4 w-4" />}
          label="Data e hora"
          valor={new Date(reuniao.data_hora).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
          editavel={podeGerenciar && !reuniaoEncerrada}
          editor={(fechar) => (
            <EditorDataHora
              dataHoraAtual={reuniao.data_hora}
              onSalvar={async (iso, justificativa) => {
                if (reuniao.tipo_local === "presencial" || reuniao.tipo_local === "hibrido") {
                  const conflito = await verificarConflitoSala({
                    local: reuniao.local_ou_link,
                    dataHoraIso: iso,
                    duracaoMinutos: reuniao.duracao_minutos,
                    reuniaoIdIgnorar: reuniao.id,
                  });
                  if (conflito) {
                    toast({ title: "Sala já reservada", description: `"${reuniao.local_ou_link}" já está reservada nesse horário (reunião "${conflito.titulo}").`, variant: "destructive" });
                    return;
                  }
                }
                const de = new Date(reuniao.data_hora).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
                const para = new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
                await atualizarCampos(
                  { data_hora: iso },
                  { acao: "horario_alterado", detalhe: `Horário alterado de ${de} para ${para}. Motivo: ${justificativa}` },
                );
                fechar();
              }}
            />
          )}
        />
        <CampoEditavel
          icon={<Users className="h-4 w-4" />}
          label="Organizador"
          valor={nomeUsuario(usuarios, reuniao.organizador_user_id) ?? "—"}
          editavel={podeGerenciar && !reuniaoEncerrada}
          editor={(fechar) => (
            <EditorOrganizador
              atual={reuniao.organizador_user_id}
              opcoes={opcoesUsuarios}
              onSalvar={async (userId) => {
                const de = nomeUsuario(usuarios, reuniao.organizador_user_id) ?? "—";
                const para = nomeUsuario(usuarios, userId) ?? "—";
                await atualizarCampos(
                  { organizador_user_id: userId },
                  { acao: "organizador_alterado", detalhe: `Organizador alterado de ${de} para ${para}` },
                );
                fechar();
              }}
            />
          )}
        />
        <CampoEditavel
          icon={<Users className="h-4 w-4" />}
          label="Responsável pela ata"
          valor={nomeUsuario(usuarios, reuniao.responsavel_preenchimento_user_id) ?? "—"}
          editavel={podeGerenciar && !reuniaoEncerrada}
          editor={(fechar) => (
            <EditorOrganizador
              atual={reuniao.responsavel_preenchimento_user_id}
              opcoes={opcoesUsuarios}
              onSalvar={async (userId) => {
                const de = nomeUsuario(usuarios, reuniao.responsavel_preenchimento_user_id) ?? "—";
                const para = nomeUsuario(usuarios, userId) ?? "—";
                await atualizarCampos(
                  { responsavel_preenchimento_user_id: userId },
                  { acao: "responsavel_alterado", detalhe: `Responsável pela ata alterado de ${de} para ${para}` },
                );
                fechar();
              }}
            />
          )}
        />
        <div className="flex items-start gap-2">
          <span className="mt-0.5 text-muted-foreground"><Users className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Participantes</p>
            <p className="text-sm font-medium">{convidados.length} participante{convidados.length === 1 ? "" : "s"}</p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setParticipantesOpen(true)}>Ver participantes</Button>
        </div>
        <CampoEditavel
          icon={reuniao.tipo_local === "online" ? <Video className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
          label="Local / Link"
          valor={reuniao.tipo_local === "hibrido" ? `${reuniao.local_ou_link} · ${reuniao.link_online ?? "—"}` : reuniao.local_ou_link}
          editavel={podeGerenciar && !reuniaoEncerrada}
          editor={(fechar) => (
            <EditorLocal
              tipoAtual={reuniao.tipo_local}
              localAtual={reuniao.local_ou_link}
              linkAtual={reuniao.link_online}
              onSalvar={async (tipo, local, linkOnline) => {
                if (tipo === "presencial" || tipo === "hibrido") {
                  const conflito = await verificarConflitoSala({
                    local,
                    dataHoraIso: reuniao.data_hora,
                    duracaoMinutos: reuniao.duracao_minutos,
                    reuniaoIdIgnorar: reuniao.id,
                  });
                  if (conflito) {
                    toast({ title: "Sala já reservada", description: `"${local}" já está reservada nesse horário (reunião "${conflito.titulo}").`, variant: "destructive" });
                    return;
                  }
                }
                await atualizarCampos(
                  { tipo_local: tipo, local_ou_link: local, link_online: linkOnline },
                  { acao: "local_alterado", detalhe: `Local alterado de "${reuniao.local_ou_link}" para "${local}"` },
                );
                fechar();
              }}
            />
          )}
        />
      </Card>

      <Card className="space-y-2 p-4">
        <p className="text-sm font-semibold">Confirmações</p>
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span className="flex-1 text-muted-foreground">Confirmados</span>
          <span className="font-semibold text-emerald-700 dark:text-emerald-400">{confirmacoes.confirmados}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <span className="flex-1 text-muted-foreground">Pendentes</span>
          <span className="font-semibold text-amber-700 dark:text-amber-400">{confirmacoes.pendentes}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <XCircle className="h-4 w-4 text-destructive" />
          <span className="flex-1 text-muted-foreground">Não poderão</span>
          <span className="font-semibold text-destructive">{confirmacoes.naoPoderao}</span>
        </div>
      </Card>
      </div>

      {reuniao.etapa === "cancelada" && reuniao.motivo_cancelamento && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Motivo do cancelamento: {reuniao.motivo_cancelamento}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="min-w-0 p-4">
          <Tabs defaultValue="pauta">
            <TabsList>
              <TabsTrigger value="pauta">Pautas da Reunião</TabsTrigger>
              <TabsTrigger value="anexos">Anexos</TabsTrigger>
              <TabsTrigger value="registro">Registro da Reunião</TabsTrigger>
              <TabsTrigger value="historico">Histórico</TabsTrigger>
            </TabsList>

            <TabsContent value="pauta">
              <PautaTabela
                pauta={pauta}
                respostas={respostas}
                pautaAnexos={pautaAnexos}
                usuarios={usuarios}
                podeGerenciarGeral={podeGerenciar}
                userId={user?.id}
                reuniaoEncerrada={reuniaoEncerrada}
                emAndamento={reuniao.etapa === "em_andamento"}
                onAdicionarTopico={salvarPautaItem}
                onAtualizarTopico={atualizarPautaItem}
                onReordenar={reordenarPauta}
                onRemoverTopico={removerPautaItem}
                onSalvarResposta={salvarResposta}
                onUploadPautaAnexo={uploadPautaAnexo}
                onDownloadAnexo={downloadAnexo}
                onRemoverPautaAnexo={removerPautaAnexo}
              />
            </TabsContent>

            <TabsContent value="anexos">
              <AnexosPainel anexos={anexos} onAnexar={uploadAnexo} onDownloadAnexo={downloadAnexo} onRemoverAnexo={removerAnexo} />
            </TabsContent>

            <TabsContent value="registro" className="space-y-6">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => exportarConvocacaoPdf(reuniao, pauta)}>
                  <FileDown className="h-3.5 w-3.5" /> PDF de convocação
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => exportarAtaFinalPdf(reuniao, pauta, respostas, assinaturas, usuarios)}>
                  <FileDown className="h-3.5 w-3.5" /> PDF final da ata
                </Button>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Assinaturas</p>
                <AssinaturasPanel
                  assinaturas={assinaturas}
                  usuarios={usuarios}
                  userId={user?.id}
                  nomePadrao={nomeUsuario(usuarios, user?.id ?? null) ?? ""}
                  onAssinar={salvarAssinatura}
                />
              </div>
            </TabsContent>

            <TabsContent value="historico">
              <HistoricoPainel logs={logs} usuarios={usuarios} />
            </TabsContent>
          </Tabs>
        </Card>

        <Card className="p-4">
          <ComentariosPainel
            comentarios={comentarios}
            usuarios={usuarios}
            userId={user?.id}
            podeGerenciar={podeGerenciar}
            onComentar={adicionarComentario}
            onRemoverComentario={removerComentario}
          />
        </Card>
      </div>

      <Dialog open={participantesOpen} onOpenChange={setParticipantesOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Participantes</DialogTitle></DialogHeader>
          <div className="space-y-2">
            {convidados.map((c) => {
              const nome = nomeUsuario(usuarios, c.user_id) ?? c.user_id;
              const avatarUrl = usuarios.find((u) => u.id === c.user_id)?.avatar_url ?? null;
              const podeConfirmar = c.user_id === user?.id || (podeGerenciar && !reuniaoEncerrada);
              return (
                <div key={c.id} className="space-y-1.5 rounded border border-border px-2 py-1.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <Avatar className="h-6 w-6 shrink-0">
                        {avatarUrl && <AvatarImage src={avatarUrl} alt={nome} />}
                        <AvatarFallback className="text-[9px]">{iniciaisUsuario(nome) || "?"}</AvatarFallback>
                      </Avatar>
                      <span className="truncate">{nome}</span>
                      <Badge variant="outline" className="text-[10px]">{c.papel === "observador" ? "Observador" : "Convidado"}</Badge>
                      <PresencaBadge presente={c.presente} />
                      {c.presente_marcado_em && (
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(c.presente_marcado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                        </span>
                      )}
                    </span>
                    {podeGerenciar && !reuniaoEncerrada && (
                      <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => removerConvidado(c.id, nome)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  {podeConfirmar && (
                    <div className="flex gap-1.5 pl-8">
                      <Button
                        type="button" size="sm" variant={c.presente === true ? "default" : "outline"} className="h-6 px-2 text-[10px]"
                        onClick={() => marcarPresenca(c.id, true, nome)}
                      >
                        Confirmar presença
                      </Button>
                      <Button
                        type="button" size="sm" variant={c.presente === false ? "destructive" : "outline"} className="h-6 px-2 text-[10px]"
                        onClick={() => marcarPresenca(c.id, false, nome)}
                      >
                        Não poderei comparecer
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            {convidados.length === 0 && <p className="text-xs text-muted-foreground">Nenhum participante adicionado.</p>}
          </div>
          {podeGerenciar && !reuniaoEncerrada && (
            <div className="flex gap-2">
              <SearchableSelect value={novoConvidado} onChange={setNovoConvidado} options={opcoesConvidaveis} placeholder="Selecionar usuário" className="flex-1" />
              <Select value={novoPapel} onValueChange={(v) => setNovoPapel(v as "convidado" | "observador")}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="convidado">Convidado</SelectItem>
                  <SelectItem value="observador">Observador</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={convidar} disabled={!novoConvidado}>
                <UserPlus className="h-3.5 w-3.5" /> Convidar
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
