import { useState } from "react";
import { Ban, CalendarRange, Car, CheckCircle2, Clock, FileText, MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  LABEL_TURNO,
  formatarData,
  hojeISO,
  useCancelarAgendamento,
  type Agendamento,
} from "@/hooks/useAgendamentoVeiculos";

interface Props {
  agendamentos: Agendamento[];
  /** Passa a valer para reservas de terceiros quando o usuário é gestor da frota. */
  podeCancelarDeTerceiros: boolean;
  usuarioId: string | null;
}

const ESTILO_STATUS: Record<string, string> = {
  confirmado: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  cancelado: "border-destructive/40 bg-destructive/10 text-destructive",
  concluido: "border-border bg-muted text-muted-foreground",
};

export function MeusAgendamentos({ agendamentos, podeCancelarDeTerceiros, usuarioId }: Props) {
  const [cancelando, setCancelando] = useState<Agendamento | null>(null);
  const [motivo, setMotivo] = useState("");
  const cancelar = useCancelarAgendamento();
  const hoje = hojeISO();

  // Mais recente primeiro: quem abre esta aba quer ver o que acabou de marcar.
  const lista = [...agendamentos].sort((a, b) => b.data_inicio.localeCompare(a.data_inicio));

  const confirmarCancelamento = async () => {
    if (!cancelando) return;
    await cancelar.mutateAsync({ id: cancelando.id, motivo });
    setCancelando(null);
    setMotivo("");
  };

  if (lista.length === 0) {
    return (
      <Card className="p-10 text-center">
        <Car className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
        <p className="font-medium text-foreground">Nenhum agendamento ainda</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Use a aba <span className="font-medium">Novo Agendamento</span> para reservar um veículo.
        </p>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {lista.map((a, i) => {
          const meu = a.solicitante_id === usuarioId;
          const futuro = a.data_fim >= hoje;
          const podeCancelar = a.status === "confirmado" && futuro && (meu || podeCancelarDeTerceiros);

          return (
            <Card
              key={a.id}
              className="animate-rise-in p-4 transition-colors hover:border-primary/30"
              style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                      a.status === "confirmado" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Car className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground">{a.veiculo_nome}</span>
                      {a.veiculo_identificador && (
                        <span className="rounded border border-border bg-muted/60 px-1.5 font-mono text-[11px] text-muted-foreground">
                          {a.veiculo_identificador}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">nº {a.numero}</span>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <CalendarRange className="h-3.5 w-3.5" />
                        {formatarData(a.data_inicio)}
                        {a.data_fim !== a.data_inicio && ` – ${formatarData(a.data_fim)}`}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        {LABEL_TURNO[a.turno]}
                      </span>
                      {a.destino && (
                        <span className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5" />
                          {a.destino}
                        </span>
                      )}
                    </div>

                    {a.contratos?.length > 0 && (
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                        <FileText className="mt-0.5 h-3 w-3 shrink-0" />
                        {a.contratos.map((c) => c.contrato_nome).join(", ")}
                      </p>
                    )}
                    {!meu && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Solicitado por {a.solicitante_nome ?? "—"}
                      </p>
                    )}
                    {a.status === "cancelado" && a.motivo_cancelamento && (
                      <p className="mt-1.5 text-xs text-destructive">
                        Cancelado: {a.motivo_cancelamento}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold capitalize",
                      ESTILO_STATUS[a.status],
                    )}
                  >
                    {a.status === "confirmado" && <CheckCircle2 className="h-3 w-3" />}
                    {a.status === "cancelado" && <Ban className="h-3 w-3" />}
                    {a.status}
                  </span>
                  {podeCancelar && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => { setCancelando(a); setMotivo(""); }}
                    >
                      Cancelar
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!cancelando} onOpenChange={(o) => !o && setCancelando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar agendamento nº {cancelando?.numero}</DialogTitle>
            <DialogDescription>
              O {cancelando?.veiculo_nome} volta a ficar livre para outras pessoas neste período.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="motivo-cancelamento">Motivo do cancelamento</Label>
            <Textarea
              id="motivo-cancelamento"
              rows={3}
              autoFocus
              placeholder="Ex.: viagem adiada pelo cliente"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Obrigatório — fica no histórico da reserva.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelando(null)}>Voltar</Button>
            <Button
              variant="destructive"
              disabled={!motivo.trim() || cancelar.isPending}
              onClick={confirmarCancelamento}
            >
              {cancelar.isPending ? "Cancelando..." : "Cancelar agendamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
