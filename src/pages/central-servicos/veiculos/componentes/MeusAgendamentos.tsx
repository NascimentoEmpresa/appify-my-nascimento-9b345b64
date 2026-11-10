import { useState } from "react";
import { Ban, CalendarRange, Car, CheckCircle2, ClipboardCheck, Clock, FileText, Fuel, Gauge, Lock, MapPin } from "lucide-react";
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
  podeMarcarNaoUsei,
  useCancelarAgendamento,
  type Agendamento,
} from "@/hooks/useAgendamentoVeiculos";
import { LABEL_STATUS_AGENDAMENTO } from "@/lib/veiculos/concluirAgendamento";
import { ViagemDialog } from "./ViagemDialog";
import { NaoUseiDialog } from "./NaoUseiDialog";
import { ChecklistDialog } from "./ChecklistDialog";
import { usePrestacoesPendentes } from "@/hooks/useChecklistVeiculo";
import {
  LABEL_TIPO_CHECKLIST, situacaoChecklist,
  type ChecklistVeiculo, type SituacaoChecklist, type TipoChecklist,
} from "@/lib/checklistVeiculo";

interface Props {
  agendamentos: Agendamento[];
  /** Passa a valer para reservas de terceiros quando o usuário é gestor da frota. */
  podeCancelarDeTerceiros: boolean;
  usuarioId: string | null;
  /** Checklists de saída/chegada que a RLS deixa ver (04/11/2026). */
  checklists: ChecklistVeiculo[];
}

const ESTILO_CHECKLIST: Record<SituacaoChecklist, { classe: string; texto: string }> = {
  preenchido: { classe: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", texto: "preenchido" },
  incompleto: { classe: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400", texto: "incompleto" },
  pendente: { classe: "border-destructive/50 bg-destructive/10 text-destructive", texto: "pendente" },
  aguardando: { classe: "border-border bg-muted/60 text-muted-foreground", texto: "a preencher" },
  nao_exigido: { classe: "border-border bg-muted/40 text-muted-foreground", texto: "opcional" },
};

const ESTILO_STATUS: Record<string, string> = {
  confirmado: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  cancelado: "border-destructive/40 bg-destructive/10 text-destructive",
  concluido: "border-border bg-muted text-muted-foreground",
};

export function MeusAgendamentos({ agendamentos, podeCancelarDeTerceiros, usuarioId, checklists }: Props) {
  const [cancelando, setCancelando] = useState<Agendamento | null>(null);
  const [checklistAberto, setChecklistAberto] = useState<{ agendamento: Agendamento; tipo: TipoChecklist } | null>(null);
  const checklistDe = (id: string, tipo: TipoChecklist) =>
    checklists.find((c) => c.agendamento_id === id && c.tipo === tipo) ?? null;
  const agora = new Date();
  // Clicar no card abre A VIAGEM: KM, contratos e notas de abastecimento
  // (22/09/2026 — chamado dos abastecimentos).
  const [viagem, setViagem] = useState<Agendamento | null>(null);
  const [motivo, setMotivo] = useState("");
  const [naoUsei, setNaoUsei] = useState<Agendamento | null>(null);
  const cancelar = useCancelarAgendamento();
  const hoje = hojeISO();
  // Prestação pendente (mig 20261110200000): enquanto houver, a próxima viagem não sai.
  const pendentes = usePrestacoesPendentes(null, null);

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
        {(pendentes.data?.length ?? 0) > 0 && (
          <Card className="space-y-2 border-destructive/40 bg-destructive/5 p-4">
            <p className="flex items-center gap-2 font-bold text-destructive">
              <Lock className="h-4 w-4" /> Complete a prestação da viagem para poder sair com outro carro
            </p>
            <ul className="space-y-1.5 text-sm">
              {pendentes.data!.map((p) => {
                const ag = agendamentos.find((x) => x.id === p.agendamento_id);
                return (
                  <li key={p.agendamento_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background/80 px-3 py-2">
                    <span className="min-w-0">
                      <b>nº {p.numero}</b> · {p.veiculo}{p.placa ? ` ${p.placa}` : ""} · {p.data_inicio.split("-").reverse().join("/")}
                      {!p.iniciada && <span className="text-amber-700 dark:text-amber-300"> · não iniciada (se não usou, marque "Não usei o carro")</span>}
                      <span className="block text-xs text-destructive">Falta: {p.faltando.join(", ")}</span>
                    </span>
                    {ag && p.iniciada && (
                      <span className="flex shrink-0 gap-1.5">
                        <Button size="sm" variant="outline" className="h-8" onClick={() => setChecklistAberto({ agendamento: ag, tipo: "chegada" })}>Checklist de chegada</Button>
                        <Button size="sm" variant="outline" className="h-8" onClick={() => setViagem(ag)}>Viagem (KM e nota)</Button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
        {lista.map((a, i) => {
          const meu = a.solicitante_id === usuarioId;
          const futuro = a.data_fim >= hoje;
          const podeCancelar = a.status === "confirmado" && futuro && (meu || podeCancelarDeTerceiros);
          // Já começou e não foi finalizada: dá para dizer que o carro nem saiu
          // (05/11/2026) — sem isso a pessoa ficava presa a um KM que não existe.
          const podeNaoUsei = podeMarcarNaoUsei(a, hoje) && (meu || podeCancelarDeTerceiros);

          return (
            <Card
              key={a.id}
              role="button"
              tabIndex={0}
              onClick={() => setViagem(a)}
              onKeyDown={(e) => { if (e.key === "Enter") setViagem(a); }}
              className="animate-rise-in cursor-pointer p-4 transition-colors hover:border-primary/30"
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
                    {/* Agendou com checklist atrasado de outro agendamento —
                        não barra nada, mas fica escrito (04/11/2026). */}
                    {a.checklist_pendente_ao_agendar && (
                      <div className="mt-1.5 space-y-0.5 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] font-semibold text-destructive">
                        {a.checklist_pendente_ao_agendar.split("\n").map((linha) => <p key={linha}>{linha}</p>)}
                      </div>
                    )}
                    {/* Checklist de saída e de chegada: cada chip abre o seu. */}
                    {a.status !== "cancelado" && !a.nao_utilizado_em && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {(["saida", "chegada"] as TipoChecklist[]).map((tipo) => {
                          const sit = situacaoChecklist(a, tipo, checklistDe(a.id, tipo), agora);
                          const estilo = ESTILO_CHECKLIST[sit];
                          return (
                            <button
                              key={tipo}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setChecklistAberto({ agendamento: a, tipo }); }}
                              className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors hover:opacity-80", estilo.classe)}
                            >
                              <ClipboardCheck className="h-3.5 w-3.5" />
                              {LABEL_TIPO_CHECKLIST[tipo]}: {estilo.texto}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {a.nao_utilizado_em ? (
                      <p className="mt-1.5 text-xs font-medium text-muted-foreground">
                        Carro não utilizado — marcado por {a.nao_utilizado_por_nome ?? "—"} em{" "}
                        {new Date(a.nao_utilizado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                        {a.nao_utilizado_motivo && ` · ${a.nao_utilizado_motivo}`}
                      </p>
                    ) : (
                      /* KM e notas ficam a um clique: o card inteiro abre a viagem. */
                      <p className="mt-2 flex flex-wrap items-center gap-3 text-xs font-semibold text-primary">
                        <span className="inline-flex items-center gap-1"><Gauge className="h-3.5 w-3.5" /> KM da viagem</span>
                        <span className="inline-flex items-center gap-1"><Fuel className="h-3.5 w-3.5" /> Anexar nota de gasolina</span>
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {podeNaoUsei && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); setNaoUsei(a); }}
                    >
                      Não usei o carro no dia
                    </Button>
                  )}
                  <span
                    className={cn(
                      "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold capitalize",
                      ESTILO_STATUS[a.status],
                    )}
                  >
                    {a.status === "confirmado" && <CheckCircle2 className="h-3 w-3" />}
                    {a.status === "cancelado" && <Ban className="h-3 w-3" />}
                    {a.status === "concluido" && <CheckCircle2 className="h-3 w-3" />}
                    {LABEL_STATUS_AGENDAMENTO[a.status] ?? a.status}
                  </span>
                  {podeCancelar && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); setCancelando(a); setMotivo(""); }}
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

      <ViagemDialog
        agendamentoId={viagem?.id ?? null}
        aberto={!!viagem}
        onFechar={() => setViagem(null)}
        souDono={!!viagem && (viagem.solicitante_id === usuarioId || podeCancelarDeTerceiros)}
      />

      <NaoUseiDialog alvo={naoUsei} onFechar={() => setNaoUsei(null)} />
      <ChecklistDialog
        agendamento={checklistAberto?.agendamento ?? null}
        tipo={checklistAberto?.tipo ?? "saida"}
        checklist={checklistAberto ? checklistDe(checklistAberto.agendamento.id, checklistAberto.tipo) : null}
        aberto={!!checklistAberto}
        onFechar={() => setChecklistAberto(null)}
        podeEditar={!!checklistAberto && (checklistAberto.agendamento.solicitante_id === usuarioId || podeCancelarDeTerceiros)}
      />

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
