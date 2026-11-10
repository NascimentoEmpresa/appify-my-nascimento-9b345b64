import { useMemo, useState } from "react";
import { AlertTriangle, Car, CheckCircle2, Clock, Gauge, MapPin, Navigation, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useChecklists } from "@/hooks/useChecklistVeiculo";
import {
  ROTULO_ESTADO, alertasKm, contarEstados, viagensDoDia, type EstadoDoDia, type ViagemDoDia,
} from "@/lib/veiculos/rotaDoDia";

// =====================================================================
// Dashboard › HOJE (10/11/2026, chamado do Cássio / Senilton).
//
// "Conforme os agendamentos diários precisa aparecer o agendamento do dia
// [...] quais os carros agendados estão realmente em rota no momento e com
// checklist de início realizado." E o KM que não bate com o último
// registrado: "saber se tem alguém que está utilizando o veículo e não está
// agendando ou não está fazendo checklist". Conta em lib/veiculos/rotaDoDia.ts.
// Não depende dos filtros do dashboard: é sempre o dia de hoje.
// =====================================================================

const ESTILO: Record<EstadoDoDia, { cls: string; icone: typeof Car }> = {
  em_rota: { cls: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200", icone: Navigation },
  saida_atrasada: { cls: "border-destructive/40 bg-destructive/10 text-destructive", icone: AlertTriangle },
  aguardando: { cls: "border-border bg-muted text-muted-foreground", icone: Clock },
  retornou: { cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", icone: CheckCircle2 },
  nao_utilizado: { cls: "border-border bg-muted/50 text-muted-foreground", icone: XCircle },
};
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");
const dataBr = (s: string) => s.split("-").reverse().join("/");

export function PainelDoDia({ agendamentos, onAbrir }: { agendamentos: ViagemDoDia[]; onAbrir: (id: string) => void }) {
  const checklists = useChecklists();
  const [filtro, setFiltro] = useState<EstadoDoDia | "">("");
  const linhas = useMemo(() => viagensDoDia(agendamentos, checklists.data ?? []), [agendamentos, checklists.data]);
  const cont = contarEstados(linhas);
  const visiveis = filtro ? linhas.filter((l) => l.estado === filtro) : linhas;
  const desde = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); }, []);
  const alertas = useMemo(() => alertasKm(agendamentos, desde), [agendamentos, desde]);

  return (
    <div className="grid gap-4 2xl:grid-cols-3">
      <Card className="p-4 2xl:col-span-2">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-foreground">Agendamentos de hoje</h3>
            <p className="text-xs text-muted-foreground">Em rota = saiu com checklist de saída (ou KM de saída) e ainda não voltou.</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["em_rota", "saida_atrasada", "aguardando", "retornou", "nao_utilizado"] as EstadoDoDia[]).map((e) => {
              const I = ESTILO[e].icone;
              return (
                <button key={e} type="button" onClick={() => setFiltro(filtro === e ? "" : e)} aria-pressed={filtro === e}
                  className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold", ESTILO[e].cls, filtro === e && "ring-2 ring-primary/40")}>
                  <I className="h-3.5 w-3.5" /> {ROTULO_ESTADO[e]} <span className="tabular-nums">{cont[e]}</span>
                </button>
              );
            })}
          </div>
        </div>
        {visiveis.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{linhas.length ? "Nenhum neste filtro." : "Nenhum agendamento para hoje."}</p>
        ) : (
          <ul className="divide-y divide-border">
            {visiveis.map((l) => {
              const a = l.viagem;
              const I = ESTILO[l.estado].icone;
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => onAbrir(a.id)} className="flex w-full flex-wrap items-center gap-3 px-1 py-2.5 text-left hover:bg-muted/40">
                    <span className={cn("inline-flex w-40 shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold", ESTILO[l.estado].cls)}>
                      <I className="h-3.5 w-3.5 shrink-0" /> {ROTULO_ESTADO[l.estado]}{l.estado === "em_rota" && l.saiuEm ? ` · ${hora(l.saiuEm)}` : ""}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {a.veiculo_nome}{a.veiculo_identificador ? ` · ${a.veiculo_identificador}` : ""} <span className="font-normal text-muted-foreground">nº {a.numero}</span>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {a.solicitante_nome ?? "—"}{a.destino ? <> · <MapPin className="inline h-3 w-3" /> {a.destino}</> : null}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-xs">
                      {(l.estado === "em_rota" || l.estado === "retornou") && (
                        <span className={cn("block font-semibold", l.saidaCompleta ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>
                          {l.saidaCompleta ? "Checklist de saída ok" : "Checklist de saída incompleto"}
                        </span>
                      )}
                      {a.km_inicial != null && <span className="block text-muted-foreground">Saída {a.km_inicial.toLocaleString("pt-BR")} km</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-foreground"><Gauge className="h-4 w-4 text-primary" /> KM sem registro (30 dias)</h3>
        <p className="mb-3 text-xs text-muted-foreground">KM de saída diferente do último KM informado do carro: alguém andou sem agendar ou sem checklist — ou digitou errado.</p>
        {alertas.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma diferença. Todo KM bateu com o anterior.</p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {alertas.map((x) => (
              <li key={x.viagem.id}>
                <button type="button" onClick={() => onAbrir(x.viagem.id)}
                  className={cn("w-full rounded-lg border px-3 py-2 text-left text-xs", x.tipo === "sem_registro" ? "border-amber-500/40 bg-amber-500/10" : "border-destructive/40 bg-destructive/5")}>
                  <span className="block text-sm font-bold text-foreground">
                    {x.tipo === "sem_registro" ? `+${x.diferenca.toLocaleString("pt-BR")} km sem registro` : `${x.diferenca.toLocaleString("pt-BR")} km (saída menor)`}
                  </span>
                  <span className="block text-muted-foreground">
                    {x.viagem.veiculo_nome} · nº {x.viagem.numero} ({x.viagem.solicitante_nome ?? "—"}, {dataBr(x.viagem.data_inicio)}) saiu com {x.viagem.km_inicial?.toLocaleString("pt-BR")} km;
                    {" "}antes: {x.viagem.km_anterior?.toLocaleString("pt-BR")} km na nº {x.viagem.km_anterior_numero ?? "?"} ({x.viagem.km_anterior_condutor ?? "—"}).
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
