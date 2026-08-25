import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext, type DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { supabase } from "@/integrations/supabase/client";
import { useChamadoPerms } from "./useChamadoPerms";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Send, ShieldAlert, XCircle, CheckCircle2, FileText, GripVertical, Info,
  ChevronRight, MessageSquareMore, ClipboardList,
} from "lucide-react";
import {
  StatusBadge, PrioridadeBadge, PRIORIDADES, CATEGORIAS, AMBIENTES, URGENCIAS, labelDe,
  iniciais, fmtDataHora, moduloLabel, chamadoAtivo, type Chamado, type Evento,
} from "./types";

interface Dev { id: string; display_name: string; em_andamento: number; abertos: number; }

/** Linha arrastável da fila do responsável selecionado. */
function TarefaRow({ c, indice, podeArrastar, atual }: { c: Chamado; indice: number; podeArrastar: boolean; atual: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: c.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <tr ref={setNodeRef} style={style} className={`border-b border-border/60 last:border-0 ${atual ? "bg-primary/5" : ""}`}>
      <td className="w-8 py-2 pl-1">
        {podeArrastar && (
          <button type="button" {...attributes} {...listeners} className="cursor-grab text-muted-foreground active:cursor-grabbing">
            <GripVertical className="h-4 w-4" />
          </button>
        )}
      </td>
      <td className="w-14 py-2 text-center">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-muted text-xs font-bold">{indice + 1}</span>
      </td>
      <td className="min-w-[180px] py-2 pr-3">
        <p className="text-sm font-medium">{c.assunto}</p>
        <p className="font-mono text-[10px] text-muted-foreground">
          #{c.numero}
          {atual && <span className="ml-1.5 rounded bg-primary/10 px-1.5 font-sans text-[9px] font-semibold uppercase text-primary">este chamado</span>}
        </p>
      </td>
      <td className="min-w-[200px] py-2 pr-3">
        <p className="line-clamp-2 text-xs text-muted-foreground">{c.descricao || "—"}</p>
      </td>
      <td className="py-2 pr-3"><PrioridadeBadge prioridade={c.prioridade} /></td>
      <td className="py-2"><StatusBadge status={c.status} /></td>
    </tr>
  );
}

export default function CoordenarChamado() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { gestor, canCoordenar, canAprovar } = useChamadoPerms();

  const [responsavel, setResponsavel] = useState<string | null>(null);
  const [posicao, setPosicao] = useState<string>("");           // posição escolhida na fila do dev
  const [prioridade, setPrioridade] = useState<string>("");     // prioridade da tarefa (carrega do chamado)
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [reprovando, setReprovando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pedindoInfo, setPedindoInfo] = useState(false);
  const [textoInfo, setTextoInfo] = useState("");
  const [obsInterna, setObsInterna] = useState(false);
  const [textoObs, setTextoObs] = useState("");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

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
      const { data, error } = await (supabase as any).from("CHAMADO_SISTEMA").select("*").eq("id", id).single();
      if (error) throw error;
      const c = data as Chamado;
      setResponsavel((cur) => cur ?? c.responsavel_id ?? null);
      setObservacao((cur) => cur || c.observacao_gerente || "");
      setPrioridade((cur) => cur || c.prioridade);
      return c;
    },
  });

  const { data: eventos = [] } = useQuery({
    queryKey: ["chamado-eventos", id],
    enabled: !!id && gestor,
    queryFn: async () => {
      const { data } = await (supabase as any).from("CHAMADO_SISTEMA_EVENTO")
        .select("*").eq("chamado_id", id).order("created_at", { ascending: false }).limit(1);
      return (data ?? []) as Evento[];
    },
  });

  const { data: usuarios = [] } = useQuery({
    queryKey: ["chamados-usuarios"],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("listar_usuarios_ativos");
      return (data ?? []) as Array<{ id: string; display_name: string }>;
    },
  });
  const nomeDe = (uid: string | null) => (uid ? usuarios.find((u) => u.id === uid)?.display_name ?? "—" : "—");

  // Fila atual do responsável selecionado (as "tarefas" dele). Inclui ESTE
  // chamado quando ele já está designado para o dev — é uma tarefa dele.
  const { data: fila = [] } = useQuery({
    queryKey: ["chamados-fila-dev", responsavel],
    enabled: !!responsavel && gestor,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("CHAMADO_SISTEMA")
        .select("*")
        .eq("responsavel_id", responsavel)
        .in("status", ["aberto", "em_andamento", "aguardando_retorno"])
        .order("posicao_dev", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Chamado[];
    },
  });

  const nomeResponsavel = devs.find((d) => d.id === responsavel)?.display_name ?? nomeDe(responsavel);

  // Este chamado já é tarefa do dev selecionado? Em que posição ele está hoje?
  const jaDesignado = !!responsavel && chamado?.responsavel_id === responsavel;
  const posicaoAtual = useMemo(() => {
    const i = fila.findIndex((c) => c.id === id);
    return i === -1 ? null : i + 1;
  }, [fila, id]);

  // Opções de posição: 1..n+1 (n = nº de OUTRAS tarefas na fila do dev).
  const opcoesPosicao = useMemo(() => {
    const n = fila.filter((c) => c.id !== id).length;
    return Array.from({ length: n + 1 }, (_, i) => {
      const p = i + 1;
      const label =
        n === 0 ? "1º lugar (única tarefa da fila)"
        : p === 1 ? "1º lugar (antes de todas)"
        : p === n + 1 ? `Último lugar (após a tarefa ${n})`
        : `${p}º lugar (entre a tarefa ${p - 1} e ${p})`;
      return { value: String(p), label };
    });
  }, [fila, id]);

  // Padrão: a posição atual (se já designado) ou o fim da fila do responsável.
  useEffect(() => {
    setPosicao(String(posicaoAtual ?? fila.filter((c) => c.id !== id).length + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responsavel, posicaoAtual, fila.length]);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["chamado", id] });
    qc.invalidateQueries({ queryKey: ["chamado-eventos", id] });
    qc.invalidateQueries({ queryKey: ["chamados-todos"] });
    qc.invalidateQueries({ queryKey: ["chamados-fila-dev"] });
    qc.invalidateQueries({ queryKey: ["chamados-devs"] });
  };

  // Arrastar reordena a fila de execução do responsável (grava na hora).
  const reordenar = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id || !responsavel) return;
    const de = fila.findIndex((c) => c.id === active.id);
    const para = fila.findIndex((c) => c.id === over.id);
    if (de === -1 || para === -1) return;
    const nova = arrayMove(fila, de, para);
    const ordem = nova.map((c) => c.id);
    qc.setQueryData(["chamados-fila-dev", responsavel], nova);
    const { error } = await (supabase as any).rpc("chamado_reordenar_fila_dev", {
      p_responsavel_id: responsavel, p_ordem: ordem,
    });
    if (error) {
      toast({ title: "Erro ao reordenar a fila", description: error.message, variant: "destructive" });
    } else {
      const novaPos = ordem.indexOf(String(id)) + 1;
      toast(novaPos > 0
        ? { title: "Tarefa designada atualizada", description: `Este chamado ficou em ${novaPos}º lugar na fila de ${nomeResponsavel}.` }
        : { title: "Fila de execução atualizada" });
    }
    qc.invalidateQueries({ queryKey: ["chamados-fila-dev", responsavel] });
    qc.invalidateQueries({ queryKey: ["chamados-todos"] });
  };

  const atribuir = async () => {
    if (!responsavel) { toast({ title: "Escolha o responsável pela execução.", variant: "destructive" }); return; }

    const novaPosicao = Number(posicao) || fila.filter((c) => c.id !== id).length + 1;
    const mudouPosicao = posicaoAtual !== novaPosicao;
    const mudouObs = (observacao.trim() || null) !== (chamado?.observacao_gerente || null);
    const mudouPrioridade = !!prioridade && prioridade !== chamado?.prioridade;

    // Já é tarefa deste dev e nada mudou → só avisa, não reescreve a fila.
    if (jaDesignado && !mudouPosicao && !mudouObs && !mudouPrioridade) {
      toast({
        title: "Essa tarefa já está designada para esse desenvolvedor selecionado.",
        description: `${nomeResponsavel} — ${posicaoAtual}º lugar na fila. Altere a posição/fila ou a observação para atualizar.`,
      });
      return;
    }

    setSalvando(true);
    if (mudouPrioridade) {
      const { error: erroPrio } = await (supabase as any).from("CHAMADO_SISTEMA").update({ prioridade }).eq("id", id);
      if (erroPrio) { setSalvando(false); toast({ title: "Erro ao alterar prioridade", description: erroPrio.message, variant: "destructive" }); return; }
      await (supabase as any).from("CHAMADO_SISTEMA_EVENTO").insert({
        chamado_id: id, tipo: "evento", texto: `Prioridade alterada para ${PRIORIDADES[prioridade]?.label ?? prioridade}`,
      });
    }
    const { error } = await (supabase as any).rpc("chamado_direcionar", {
      p_chamado_id: id, p_responsavel_id: responsavel,
      p_posicao: novaPosicao,
      p_observacao: observacao.trim() || null,
    });
    setSalvando(false);
    if (error) { toast({ title: "Erro ao direcionar", description: error.message, variant: "destructive" }); return; }
    supabase.functions.invoke("enviar-notificacao-push", { body: { chamado_id: id, evento: "atribuido" } }).catch(() => {});
    supabase.functions.invoke("notificar-chamado-whatsapp", { body: { chamado_id: id, evento: "atribuido" } }).catch(() => {});
    toast({
      title: jaDesignado ? "Tarefa designada atualizada" : "Chamado direcionado",
      description: `${nomeResponsavel} — ${novaPosicao}º lugar na fila`,
    });
    invalidar();
    nav("/app/sistemas/chamados/painel");
  };

  const reprovar = async () => {
    if (!motivo.trim()) { toast({ title: "Informe o motivo da reprovação.", variant: "destructive" }); return; }
    const { error } = await (supabase as any).from("CHAMADO_SISTEMA").update({
      status: "reprovado", motivo_reprovacao: motivo.trim(),
    }).eq("id", id);
    if (error) { toast({ title: "Erro ao reprovar", description: error.message, variant: "destructive" }); return; }
    await (supabase as any).from("CHAMADO_SISTEMA_EVENTO").insert({
      chamado_id: id, tipo: "evento", texto: "Chamado reprovado: " + motivo.trim(),
    });
    supabase.functions.invoke("enviar-notificacao-push", { body: { chamado_id: id, evento: "reprovado" } }).catch(() => {});
    toast({ title: "Chamado reprovado" });
    setReprovando(false); setMotivo("");
    nav("/app/sistemas/chamados/painel");
  };

  // Mensagem ao solicitante pedindo complementos (chamado fica aguardando retorno).
  const solicitarInfo = async () => {
    if (!textoInfo.trim()) { toast({ title: "Escreva o que falta no chamado.", variant: "destructive" }); return; }
    const { error } = await (supabase as any).from("CHAMADO_SISTEMA_EVENTO").insert({
      chamado_id: id, tipo: "comentario", texto: textoInfo.trim(),
    });
    if (error) { toast({ title: "Erro ao enviar", description: error.message, variant: "destructive" }); return; }
    await (supabase as any).from("CHAMADO_SISTEMA").update({ status: "aguardando_retorno" }).eq("id", id);
    supabase.functions.invoke("enviar-notificacao-push", { body: { chamado_id: id, evento: "solicitar_info" } }).catch(() => {});
    toast({ title: "Solicitação enviada ao solicitante" });
    setPedindoInfo(false); setTextoInfo("");
    invalidar();
  };

  const salvarObsInterna = async () => {
    if (!textoObs.trim()) return;
    const { error } = await (supabase as any).from("CHAMADO_SISTEMA_EVENTO").insert({
      chamado_id: id, tipo: "observacao_interna", texto: textoObs.trim(),
    });
    if (error) { toast({ title: "Erro ao salvar observação", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Observação interna registrada" });
    setObsInterna(false); setTextoObs("");
    qc.invalidateQueries({ queryKey: ["chamado-eventos", id] });
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

  const encerrado = !chamadoAtivo(chamado.status);
  const categoriaLabel = chamado.categorias.map((x) => labelDe(CATEGORIAS, x)).join(", ") || "—";
  const ultimaAtualizacao = eventos[0];

  const acoes = [
    canAprovar && !encerrado && {
      key: "reprovar", icon: XCircle, tone: "text-destructive", bg: "bg-destructive/10",
      titulo: "Reprovar chamado", desc: "Encerrar o chamado informando o motivo.",
      onClick: () => setReprovando(true),
    },
    !encerrado && {
      key: "info", icon: MessageSquareMore, tone: "text-warning", bg: "bg-warning/10",
      titulo: "Solicitar mais informações", desc: "Enviar mensagem ao solicitante solicitando complementos.",
      onClick: () => setPedindoInfo(true),
    },
    {
      key: "obs", icon: ClipboardList, tone: "text-info", bg: "bg-info/10",
      titulo: "Adicionar observação interna", desc: "Registrar observações visíveis apenas à equipe.",
      onClick: () => setObsInterna(true),
    },
  ].filter(Boolean) as Array<{ key: string; icon: typeof XCircle; tone: string; bg: string; titulo: string; desc: string; onClick: () => void }>;

  return (
    <div>
      <PageHeader
        title={`#${chamado.numero}`}
        subtitle={chamado.assunto}
        module="Sistemas"
        breadcrumb={["Chamados de Sistemas", `#${chamado.numero}`]}
        actions={<Button variant="outline" onClick={() => nav("/app/sistemas/chamados/painel")}>Voltar ao painel</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {/* Cabeçalho do chamado */}
          <Card className="p-4">
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileText className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-lg font-bold">#{chamado.numero}</p>
                  <StatusBadge status={chamado.status} />
                </div>
                <p className="mt-0.5 text-sm font-semibold">{chamado.assunto}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Categoria: {categoriaLabel} · Prioridade: {PRIORIDADES[chamado.prioridade]?.label ?? chamado.prioridade} · Aberto em: {fmtDataHora(chamado.created_at)}
                </p>
              </div>
              <div className="grid gap-4 text-xs sm:grid-cols-3">
                <div>
                  <p className="text-[11px] text-muted-foreground">Solicitante</p>
                  <p className="font-medium">{chamado.solicitante_nome || "—"}</p>
                  <p className="text-[11px] text-muted-foreground">{chamado.setor || "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Setor</p>
                  <p className="font-medium">{chamado.setor || "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Última atualização</p>
                  <p className="font-medium">{fmtDataHora(chamado.updated_at)}</p>
                  {ultimaAtualizacao && <p className="text-[11px] text-muted-foreground">por {nomeDe(ultimaAtualizacao.autor_id)}</p>}
                </div>
              </div>
            </div>
          </Card>

          <Card className="divide-y divide-border">
            {/* 1. Responsável pela execução */}
            <div className="p-4">
              <p className="mb-3 text-sm font-bold">1. Coordenação do chamado</p>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Responsável pela execução</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {devs.map((d) => (
                  <button
                    key={d.id} type="button" onClick={() => setResponsavel(d.id)}
                    className={`rounded-lg border p-3 text-left transition-colors ${responsavel === d.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/40"}`}
                  >
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8"><AvatarFallback className="text-[10px]">{iniciais(d.display_name)}</AvatarFallback></Avatar>
                      {responsavel === d.id && <CheckCircle2 className="ml-auto h-4 w-4 text-primary" />}
                    </div>
                    <p className="mt-2 truncate text-xs font-semibold">{d.display_name}</p>
                    <p className="text-[10px] text-muted-foreground">Desenvolvedor de Sistemas</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">Chamados abertos: {d.abertos}</p>
                  </button>
                ))}
                {devs.length === 0 && <p className="text-xs text-muted-foreground">Nenhum desenvolvedor liberado (código <b>chamados_sistemas_dev</b>).</p>}
              </div>
            </div>

            {/* 2. Fila atual do responsável selecionado */}
            <div className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold">
                  2. Tarefas do responsável selecionado:{" "}
                  <span className="text-primary">{responsavel ? nomeResponsavel : "—"}</span>
                </p>
                <p className="text-xs text-muted-foreground">Fila atual ordenada por prioridade</p>
              </div>
              {!responsavel ? (
                <p className="py-6 text-center text-xs text-muted-foreground">Selecione o responsável acima para ver a fila de execução dele.</p>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          <th className="w-8 py-2 pl-1" />
                          <th className="w-14 py-2 text-center">Ordem</th>
                          <th className="py-2 pr-3">Tarefa</th>
                          <th className="py-2 pr-3">Descrição</th>
                          <th className="py-2 pr-3">Prioridade</th>
                          <th className="py-2">Status</th>
                        </tr>
                      </thead>
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reordenar}>
                        <SortableContext items={fila.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                          <tbody>
                            {fila.map((c, i) => (
                              <TarefaRow key={c.id} c={c} indice={i} podeArrastar={canCoordenar} atual={c.id === id} />
                            ))}
                          </tbody>
                        </SortableContext>
                      </DndContext>
                    </table>
                    {fila.length === 0 && (
                      <p className="py-4 text-center text-xs text-muted-foreground">Nenhuma tarefa pendente — este chamado será o 1º da fila.</p>
                    )}
                  </div>
                  {jaDesignado && (
                    <p className="mt-2 flex items-center gap-1.5 rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-[11px] text-muted-foreground">
                      <Info className="h-3.5 w-3.5 shrink-0 text-info" />
                      Essa tarefa já está designada para esse desenvolvedor selecionado
                      {posicaoAtual ? ` (${posicaoAtual}º lugar na fila dele)` : ""} — altere a fila, a posição ou a prioridade para atualizar.
                    </p>
                  )}
                  {canCoordenar && fila.length > 1 && (
                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Info className="h-3.5 w-3.5 text-info" /> Arraste as tarefas para reordenar a fila de execução.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* 3. Posição da tarefa na fila do responsável */}
            <div className="p-4">
              <p className="text-sm font-bold">3. Definir posição {jaDesignado ? "da tarefa" : "da nova tarefa"} na fila</p>
              <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
                Selecione em qual posição da fila (ordem de prioridade) {jaDesignado ? "a tarefa vai ficar" : "a nova tarefa será inserida"}.
              </p>
              <div className="grid gap-3 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] md:items-center">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="whitespace-nowrap text-xs font-medium">{jaDesignado ? "Mover a tarefa para a posição:" : "Inserir nova tarefa na posição:"}</span>
                    <Select value={posicao} onValueChange={setPosicao} disabled={!responsavel}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Posição" /></SelectTrigger>
                      <SelectContent>
                        {opcoesPosicao.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="whitespace-nowrap text-xs font-medium">Prioridade da tarefa:</span>
                    <Select value={prioridade} onValueChange={setPrioridade}>
                      <SelectTrigger className="h-9 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="alta">Alta</SelectItem>
                        <SelectItem value="media">Média</SelectItem>
                        <SelectItem value="baixa">Baixa</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-[11px] text-muted-foreground">
                  A tarefa será inserida na posição selecionada e as demais serão deslocadas para baixo.
                </div>
              </div>
            </div>

            {/* 4. Observação + direcionar */}
            <div className="p-4">
              <p className="text-sm font-bold">4. Observação para o responsável <span className="font-normal text-muted-foreground">(opcional)</span></p>
              <p className="mb-2 mt-0.5 text-xs text-muted-foreground">Informe orientações, contexto ou observações importantes para o responsável pela execução do chamado.</p>
              <Textarea
                rows={3} maxLength={1000} placeholder="Digite sua observação…"
                value={observacao} onChange={(e) => setObservacao(e.target.value)}
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">{observacao.length}/1000 caracteres</span>
                {canCoordenar && (
                  <Button className="gap-1.5" disabled={salvando || encerrado} onClick={atribuir}>
                    <Send className="h-4 w-4" /> {salvando ? "Direcionando…" : "Atribuir tarefas e direcionar chamado"}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* Coluna direita */}
        <div className="space-y-4">
          <Card className="space-y-1 p-4">
            <p className="mb-2 text-sm font-bold">Resumo do chamado</p>
            {([
              ["ID", `#${chamado.numero}`],
              ["Assunto", chamado.assunto],
              ["Categoria", categoriaLabel],
              ["Prioridade", <PrioridadeBadge key="p" prioridade={chamado.prioridade} />],
              ["Status", <StatusBadge key="s" status={chamado.status} />],
              ["Solicitante", chamado.solicitante_nome || "—"],
              ["Setor", chamado.setor || "—"],
              ["Aberto em", fmtDataHora(chamado.created_at)],
              ["Última atualização", fmtDataHora(chamado.updated_at)],
            ] as Array<[string, React.ReactNode]>).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 border-b border-border/60 py-1 last:border-0">
                <span className="shrink-0 text-xs text-muted-foreground">{k}</span>
                <span className="text-right text-xs font-medium">{v}</span>
              </div>
            ))}
            {chamado.descricao && (
              <div className="pt-2">
                <p className="text-xs text-muted-foreground">Descrição</p>
                <p className="whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">{chamado.descricao}</p>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <p className="mb-3 text-sm font-bold">Ações para o chamado</p>
            <div className="space-y-2">
              {acoes.map((a) => (
                <button
                  key={a.key} type="button" onClick={a.onClick}
                  className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40"
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${a.bg} ${a.tone}`}>
                    <a.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-xs font-semibold ${a.tone}`}>{a.titulo}</span>
                    <span className="block text-[11px] text-muted-foreground">{a.desc}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
              {acoes.length === 0 && <p className="text-xs text-muted-foreground">Chamado encerrado — sem ações disponíveis.</p>}
            </div>
          </Card>

          <Card className="p-4">
            <p className="mb-3 text-sm font-bold">Informações adicionais</p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              {([
                ["Módulo / Sistema", moduloLabel(chamado)],
                ["Ambiente", labelDe(AMBIENTES, chamado.ambiente)],
                ["Afeta quantos usuários?", chamado.afeta_usuarios != null ? `${chamado.afeta_usuarios} usuários` : "—"],
                ["Urgência informada?", labelDe(URGENCIAS, chamado.urgencia)],
              ] as Array<[string, React.ReactNode]>).map(([k, v]) => (
                <div key={k}>
                  <p className="text-[11px] text-muted-foreground">{k}</p>
                  <p className="font-medium">{v}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
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

      <Dialog open={pedindoInfo} onOpenChange={setPedindoInfo}>
        <DialogContent>
          <DialogHeader><DialogTitle>Solicitar mais informações</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">O solicitante recebe a mensagem no histórico e o chamado fica <b>aguardando retorno</b> até ele responder.</p>
          <Textarea rows={4} maxLength={2000} placeholder="Descreva o que falta (prints, número do documento, passo a passo…)" value={textoInfo} onChange={(e) => setTextoInfo(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPedindoInfo(false)}>Cancelar</Button>
            <Button className="gap-1.5" onClick={solicitarInfo}><Send className="h-4 w-4" /> Enviar</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={obsInterna} onOpenChange={setObsInterna}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adicionar observação interna</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Fica no histórico do chamado, visível apenas à equipe (o solicitante não vê).</p>
          <Textarea rows={4} maxLength={1000} placeholder="Observações sobre o andamento, decisões técnicas, combinados…" value={textoObs} onChange={(e) => setTextoObs(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setObsInterna(false)}>Cancelar</Button>
            <Button onClick={salvarObsInterna} disabled={!textoObs.trim()}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
