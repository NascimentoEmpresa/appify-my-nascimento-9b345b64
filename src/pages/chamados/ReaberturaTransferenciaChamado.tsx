import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRightLeft, CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { fmtDataHora } from "./types";
import {
  MIN_MOTIVO, motivoValido, opcoesDesenvolvedor, destinosTransferencia, reaberturaEmDestaque,
  type Reabertura, type Transferencia,
} from "@/lib/chamados/reabertura";

// =====================================================================
// CHAMADO REABERTO / PEDIDO DE TRANSFERÊNCIA (mig 20261112190000).
//
// · CardReaberturaChamado — o destaque no meio da página: quem pediu para
//   reabrir, quando e por quê. Quem decide (Gestor de Sistemas ou Coordenar)
//   nega com motivo ou confirma escolhendo o dev (o atual vem primeiro =
//   "manter o mesmo"). O dev atual e o solicitante veem o mesmo card, sem os
//   botões. Decidido, fica visível uma semana mostrando o desfecho.
// · CardTransferenciaChamado — pedido pendente do dev; quem decide aprova
//   ou recusa (motivo obrigatório); quem pediu pode desistir.
// · PedirTransferenciaDialog — o dev responsável escolhe o outro dev e conta
//   por quê. Só depois da aprovação o responsável muda; o chat ganha
//   "Transferido para <dev>" pelo gatilho do banco.
// Tudo passa por RPC; as tabelas não aceitam escrita direta.
// =====================================================================

type Dev = { id: string; display_name: string | null };
type NomeDe = (uid: string | null) => string;
type ChamadoBase = { id: string; numero: string; status: string; responsavel_id: string | null };

const chaveReabertura = (id: string) => ["chamado-reabertura", id];
const chaveTransferencia = (id: string) => ["chamado-transferencia", id];

/** Recarrega tudo que muda junto: o chamado, o chat, filas e as listas de chamados. */
function useInvalidarChamado() {
  const qc = useQueryClient();
  return (id: string) => {
    qc.invalidateQueries({ queryKey: chaveReabertura(id) });
    qc.invalidateQueries({ queryKey: chaveTransferencia(id) });
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("chamado") });
  };
}

export function useDevsTransferencia(enabled: boolean) {
  return useQuery({
    queryKey: ["chamado-devs-transferencia"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("chamado_devs_transferencia");
      if (error) throw error;
      return (data ?? []) as Dev[];
    },
  });
}

export function useReaberturaChamado(chamadoId: string | undefined) {
  return useQuery({
    queryKey: chaveReabertura(chamadoId ?? ""),
    enabled: !!chamadoId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("CHAMADO_SISTEMA_REABERTURA").select("*")
        .eq("chamado_id", chamadoId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      // Antes da migration entrar, a tabela não existe: sem card, sem erro na tela.
      if (error) return null;
      return (data ?? null) as Reabertura | null;
    },
  });
}

export function useTransferenciaPendente(chamadoId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: chaveTransferencia(chamadoId ?? ""),
    enabled: !!chamadoId && enabled,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("CHAMADO_SISTEMA_TRANSFERENCIA").select("*")
        .eq("chamado_id", chamadoId).eq("status", "pendente").maybeSingle();
      if (error) return null;
      return (data ?? null) as Transferencia | null;
    },
  });
}

const ROTULO_DESFECHO = {
  confirmada: { titulo: "Reabertura confirmada", cls: "border-success/40 bg-success/5", tone: "text-success" },
  negada: { titulo: "Reabertura negada", cls: "border-muted-foreground/30 bg-muted/40", tone: "text-muted-foreground" },
} as const;

export function CardReaberturaChamado({
  chamado, nomeDe, podeDecidir,
}: { chamado: ChamadoBase; nomeDe: NomeDe; podeDecidir: boolean }) {
  const { toast } = useToast();
  const invalidar = useInvalidarChamado();
  const { data: reabertura } = useReaberturaChamado(chamado.id);
  const pendente = reabertura?.status === "pendente";
  const { data: devs = [] } = useDevsTransferencia(podeDecidir && pendente);

  const [acao, setAcao] = useState<"negar" | "confirmar" | null>(null);
  const [motivo, setMotivo] = useState("");
  const [devEscolhido, setDevEscolhido] = useState<string>("");
  const [enviando, setEnviando] = useState(false);

  if (!reabertura || !reaberturaEmDestaque(reabertura)) return null;

  const atual = chamado.responsavel_id ?? reabertura.responsavel_anterior;
  const opcoes = opcoesDesenvolvedor(devs, atual);
  const devFinal = devEscolhido || (opcoes.find((o) => o.atual)?.id ?? "");

  const fechar = () => { if (enviando) return; setAcao(null); setMotivo(""); setDevEscolhido(""); };

  const decidir = async () => {
    if (!acao || enviando) return;
    if (acao === "negar" && !motivoValido(motivo)) return;
    if (acao === "confirmar" && !devFinal) return;
    setEnviando(true);
    const { error } = await (supabase as any).rpc("chamado_reabertura_decidir", {
      p_reabertura_id: reabertura.id,
      p_confirmar: acao === "confirmar",
      p_responsavel_id: acao === "confirmar" ? devFinal : null,
      p_motivo: motivo.trim() || null,
    });
    setEnviando(false);
    if (error) {
      toast({ title: acao === "negar" ? "Erro ao negar a reabertura" : "Erro ao confirmar a reabertura", description: error.message, variant: "destructive" });
      return;
    }
    if (acao === "confirmar") {
      supabase.functions.invoke("enviar-notificacao-push", { body: { chamado_id: chamado.id, evento: "reaberto" } }).catch(() => {});
      toast({ title: `Chamado #${chamado.numero} reaberto`, description: `Voltou para o desenvolvimento com ${nomeDe(devFinal)}.` });
    } else {
      toast({ title: "Reabertura negada", description: "O solicitante foi avisado do motivo." });
    }
    setAcao(null); setMotivo(""); setDevEscolhido("");
    invalidar(chamado.id);
  };

  const desfecho = !pendente ? ROTULO_DESFECHO[reabertura.status as "confirmada" | "negada"] : null;

  return (
    <>
      <Card className={`space-y-3 border-2 p-4 ${pendente ? "border-warning bg-warning/5" : desfecho?.cls ?? ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <RotateCcw className={`h-5 w-5 ${pendente ? "text-warning" : desfecho?.tone}`} />
          <p className={`text-sm font-extrabold uppercase tracking-wider ${pendente ? "text-warning" : desfecho?.tone}`}>
            {pendente ? "Chamado reaberto" : desfecho?.titulo}
          </p>
          {pendente && (
            <span className="rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">
              Aguardando o Gestor de Sistemas
            </span>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Reaberto por</p>
            <p className="text-sm font-medium">{nomeDe(reabertura.solicitado_por)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Quando</p>
            <p className="text-sm font-medium">{fmtDataHora(reabertura.created_at)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Desenvolvedor atual</p>
            <p className="text-sm font-medium">{nomeDe(atual)}</p>
          </div>
        </div>
        <div className="rounded-md border-l-2 border-warning/60 bg-background/60 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Por quê — não atendeu o solicitado</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{reabertura.motivo}</p>
        </div>

        {!pendente && (
          <p className="text-xs text-muted-foreground">
            {reabertura.status === "confirmada"
              ? <>Confirmada por {nomeDe(reabertura.decidido_por)} em {fmtDataHora(reabertura.decidido_em!)} — com {nomeDe(reabertura.responsavel_novo)}.</>
              : <>Negada por {nomeDe(reabertura.decidido_por)} em {fmtDataHora(reabertura.decidido_em!)}: {reabertura.motivo_decisao}</>}
          </p>
        )}

        {pendente && podeDecidir && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setAcao("negar")}>
              <XCircle className="h-4 w-4" /> Negar reabertura
            </Button>
            <Button className="gap-1.5" onClick={() => setAcao("confirmar")}>
              <CheckCircle2 className="h-4 w-4" /> Confirmar reabertura
            </Button>
          </div>
        )}
        {pendente && !podeDecidir && (
          <p className="text-xs text-muted-foreground">O chamado continua como estava até o Gestor de Sistemas confirmar ou negar a reabertura.</p>
        )}
      </Card>

      <Dialog open={acao !== null} onOpenChange={(v) => { if (!v) fechar(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{acao === "negar" ? "Negar a reabertura" : "Confirmar a reabertura"} — #{chamado.numero}</DialogTitle>
          </DialogHeader>
          {acao === "confirmar" && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Quem atende a reabertura</Label>
              <Select value={devFinal} onValueChange={setDevEscolhido}>
                <SelectTrigger><SelectValue placeholder="Escolha o desenvolvedor" /></SelectTrigger>
                <SelectContent>
                  {opcoes.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.display_name ?? "—"}{d.atual ? " (manter o mesmo)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                O chamado volta para <b>Em andamento</b>, no fim da fila do desenvolvedor escolhido.
                {devFinal && atual && devFinal !== atual ? " O chat registra a transferência." : ""}
              </p>
            </div>
          )}
          <Textarea
            rows={3}
            autoFocus={acao === "negar"}
            placeholder={acao === "negar"
              ? "Por que a reabertura foi negada? O solicitante recebe este motivo. (obrigatório)"
              : "Observação (opcional)"}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          {acao === "negar" && motivo.trim().length > 0 && !motivoValido(motivo) && (
            <p className="text-xs text-destructive">Escreva pelo menos {MIN_MOTIVO} caracteres.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={fechar} disabled={enviando}>Cancelar</Button>
            <Button
              variant={acao === "negar" ? "destructive" : "default"}
              onClick={decidir}
              disabled={enviando || (acao === "negar" ? !motivoValido(motivo) : !devFinal)}
            >
              {enviando ? "Gravando…" : acao === "negar" ? "Negar reabertura" : "Confirmar reabertura"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CardTransferenciaChamado({
  chamado, nomeDe, podeDecidir,
}: { chamado: ChamadoBase; nomeDe: NomeDe; podeDecidir: boolean }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const invalidar = useInvalidarChamado();
  const { data: t } = useTransferenciaPendente(chamado.id);
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  if (!t) return null;
  const meu = t.solicitado_por === user?.id;
  if (!podeDecidir && !meu && chamado.responsavel_id !== user?.id) return null;

  const rodar = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setEnviando(true);
    const { error } = await (supabase as any).rpc(fn, args);
    setEnviando(false);
    if (error) { toast({ title: "Não deu certo", description: error.message, variant: "destructive" }); return false; }
    toast({ title: ok });
    invalidar(chamado.id);
    return true;
  };

  const aprovar = async () => {
    if (await rodar("chamado_transferencia_decidir", { p_transferencia_id: t.id, p_aprovar: true, p_motivo: null },
      `Chamado transferido para ${nomeDe(t.para_responsavel)}`)) {
      supabase.functions.invoke("enviar-notificacao-push", { body: { chamado_id: chamado.id, evento: "atribuido" } }).catch(() => {});
    }
  };
  const recusar = async () => {
    if (!motivoValido(motivo)) return;
    if (await rodar("chamado_transferencia_decidir", { p_transferencia_id: t.id, p_aprovar: false, p_motivo: motivo.trim() },
      "Transferência recusada")) { setRecusando(false); setMotivo(""); }
  };
  const desistir = () => rodar("chamado_transferencia_cancelar", { p_transferencia_id: t.id }, "Pedido de transferência cancelado");

  return (
    <>
      <Card className="space-y-3 border-2 border-info bg-info/5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <ArrowRightLeft className="h-5 w-5 text-info" />
          <p className="text-sm font-extrabold uppercase tracking-wider text-info">Pedido de transferência</p>
          <span className="rounded-full border border-info/50 bg-info/10 px-2 py-0.5 text-[10px] font-semibold text-info">
            Aguardando o Gestor de Sistemas
          </span>
        </div>
        <p className="text-sm">
          <b>{nomeDe(t.de_responsavel)}</b> pediu para passar o chamado para <b>{nomeDe(t.para_responsavel)}</b>
          <span className="text-muted-foreground"> · {fmtDataHora(t.created_at)}</span>
        </p>
        <div className="rounded-md border-l-2 border-info/60 bg-background/60 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Motivo</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{t.motivo}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {meu && (
            <Button variant="ghost" onClick={desistir} disabled={enviando}>Desistir do pedido</Button>
          )}
          {podeDecidir && (
            <>
              <Button variant="outline" className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => setRecusando(true)} disabled={enviando}>
                <XCircle className="h-4 w-4" /> Recusar
              </Button>
              <Button className="gap-1.5" onClick={aprovar} disabled={enviando}>
                <CheckCircle2 className="h-4 w-4" /> Aprovar transferência
              </Button>
            </>
          )}
        </div>
      </Card>

      <Dialog open={recusando} onOpenChange={(v) => { if (!enviando) { setRecusando(v); if (!v) setMotivo(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Recusar a transferência — #{chamado.numero}</DialogTitle></DialogHeader>
          <Textarea rows={3} autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder="Por que o chamado continua com o desenvolvedor atual? (obrigatório)" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRecusando(false)} disabled={enviando}>Cancelar</Button>
            <Button variant="destructive" onClick={recusar} disabled={enviando || !motivoValido(motivo)}>
              {enviando ? "Gravando…" : "Recusar transferência"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PedirTransferenciaDialog({
  open, onOpenChange, chamado,
}: { open: boolean; onOpenChange: (v: boolean) => void; chamado: ChamadoBase }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const invalidar = useInvalidarChamado();
  const { data: devs = [] } = useDevsTransferencia(open);
  const [para, setPara] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const destinos = opcoesDesenvolvedor(destinosTransferencia(devs, user?.id), null);

  const fechar = (v: boolean) => {
    if (enviando) return;
    if (!v) { setPara(""); setMotivo(""); }
    onOpenChange(v);
  };

  const pedir = async () => {
    if (!para || !motivoValido(motivo) || enviando) return;
    setEnviando(true);
    const { error } = await (supabase as any).rpc("chamado_transferencia_solicitar", {
      p_chamado_id: chamado.id, p_para: para, p_motivo: motivo.trim(),
    });
    setEnviando(false);
    if (error) { toast({ title: "Erro ao pedir a transferência", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Pedido enviado ao Gestor de Sistemas", description: "O chamado continua com você até ele aprovar." });
    setPara(""); setMotivo("");
    onOpenChange(false);
    invalidar(chamado.id);
  };

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" /> Pedir transferência — #{chamado.numero}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Para qual desenvolvedor</Label>
          <Select value={para} onValueChange={setPara}>
            <SelectTrigger><SelectValue placeholder="Escolha o desenvolvedor" /></SelectTrigger>
            <SelectContent>
              {destinos.map((d) => <SelectItem key={d.id} value={d.id}>{d.display_name ?? "—"}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)}
          placeholder="Por que o chamado deve ir para outro desenvolvedor? (obrigatório)" />
        <p className="text-xs text-muted-foreground">
          O Gestor de Sistemas aprova ou recusa. Até lá o chamado continua com você.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => fechar(false)} disabled={enviando}>Cancelar</Button>
          <Button onClick={pedir} disabled={enviando || !para || !motivoValido(motivo)}>
            {enviando ? "Enviando…" : "Pedir transferência"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Pendencia = {
  tipo: "reabertura" | "transferencia"; pedido_id: number; chamado_id: string; numero: string; assunto: string;
  solicitado_por: string | null; motivo: string; para_responsavel: string | null; created_at: string;
};

/**
 * Painel de Distribuição: reaberturas e transferências esperando decisão.
 * A RPC devolve vazio para quem não decide — o aviso some sozinho.
 */
export function AvisoPendenciasGestao({ onAbrir, nomeDe }: { onAbrir: (chamadoId: string) => void; nomeDe: NomeDe }) {
  const { data: pendencias = [] } = useQuery({
    queryKey: ["chamado-pendencias-gestao"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("chamado_pendencias_gestao");
      if (error) return [];  // migration ainda não entrou: sem aviso
      return (data ?? []) as Pendencia[];
    },
  });
  if (pendencias.length === 0) return null;
  return (
    <Card className="mb-4 space-y-2 border-2 border-warning bg-warning/5 p-4">
      <p className="flex items-center gap-2 text-sm font-bold text-warning">
        <RotateCcw className="h-4 w-4" /> {pendencias.length === 1 ? "1 pedido aguardando" : `${pendencias.length} pedidos aguardando`} a sua decisão
      </p>
      <div className="space-y-1.5">
        {pendencias.map((p) => (
          <button key={`${p.tipo}-${p.pedido_id}`} type="button" onClick={() => onAbrir(p.chamado_id)}
            className="flex w-full flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-xs transition-colors hover:border-primary/40">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.tipo === "reabertura" ? "bg-warning/15 text-warning" : "bg-info/15 text-info"}`}>
              {p.tipo === "reabertura" ? "Chamado reaberto" : "Transferência"}
            </span>
            <b>#{p.numero}</b>
            <span className="min-w-0 flex-1 truncate">{p.assunto}</span>
            <span className="text-muted-foreground">
              {nomeDe(p.solicitado_por)}{p.tipo === "transferencia" ? ` → ${nomeDe(p.para_responsavel)}` : ""} · {fmtDataHora(p.created_at)}
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}
