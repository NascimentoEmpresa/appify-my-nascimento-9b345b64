import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useChamadoPerms } from "./useChamadoPerms";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Send, ShieldAlert, XCircle, CheckCircle2 } from "lucide-react";
import {
  StatusBadge, PrioridadeBadge, iniciais, fmtDataHora, moduloLabel, type Chamado,
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
      const { data, error } = await (supabase as any).from("CHAMADO_SISTEMA").select("*").eq("id", id).single();
      if (error) throw error;
      const c = data as Chamado;
      setResponsavel((cur) => cur ?? c.responsavel_id ?? null);
      setObservacao((cur) => cur || c.observacao_gerente || "");
      return c;
    },
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["chamado", id] });
    qc.invalidateQueries({ queryKey: ["chamados-todos"] });
  };

  const atribuir = async () => {
    if (!responsavel) { toast({ title: "Escolha o responsável pela execução.", variant: "destructive" }); return; }
    setSalvando(true);
    const nomeDev = devs.find((d) => d.id === responsavel)?.display_name ?? "";
    const { error } = await (supabase as any).from("CHAMADO_SISTEMA").update({
      responsavel_id: responsavel, status: "em_andamento", observacao_gerente: observacao.trim() || null,
    }).eq("id", id);
    if (error) { setSalvando(false); toast({ title: "Erro ao atribuir", description: error.message, variant: "destructive" }); return; }
    await (supabase as any).from("CHAMADO_SISTEMA_EVENTO").insert({
      chamado_id: id, tipo: "evento", texto: `Chamado direcionado a ${nomeDev}`,
    });
    supabase.functions.invoke("enviar-notificacao-push", { body: { chamado_id: id, evento: "atribuido" } }).catch(() => {});
    setSalvando(false);
    toast({ title: "Chamado direcionado", description: `Responsável: ${nomeDev}` });
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
              {devs.length === 0 && <p className="text-xs text-muted-foreground">Nenhum desenvolvedor liberado (código <b>chamados_sistemas_dev</b> ou <b>sistemas_desenvolvedores</b>).</p>}
            </div>
          </Card>

          {/* 2. Observação + ações */}
          <Card className="space-y-3 p-4">
            <p className="text-sm font-bold">2. Observação para o responsável <span className="font-normal text-muted-foreground">(opcional)</span></p>
            <Textarea rows={3} maxLength={1000} placeholder="Informe orientações, contexto ou observações importantes…" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
            <div className="flex items-center justify-between">
              {canAprovar
                ? <Button variant="outline" className="gap-1.5 text-destructive" onClick={() => setReprovando(true)}><XCircle className="h-4 w-4" /> Reprovar chamado</Button>
                : <span />}
              {canCoordenar && <Button className="gap-1.5" disabled={salvando} onClick={atribuir}><Send className="h-4 w-4" /> Direcionar chamado</Button>}
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
