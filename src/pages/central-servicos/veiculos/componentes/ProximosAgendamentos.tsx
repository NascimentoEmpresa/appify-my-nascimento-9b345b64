import { CalendarDays, Truck, User } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  LABEL_TURNO,
  formatarData,
  hojeISO,
  type Agendamento,
} from "@/hooks/useAgendamentoVeiculos";

interface Props {
  agendamentos: Agendamento[];
  limite?: number;
}

/** As próximas saídas da frota, em ordem de data. */
export function ProximosAgendamentos({ agendamentos, limite = 8 }: Props) {
  const hoje = hojeISO();
  const proximos = agendamentos
    .filter((a) => a.status === "confirmado" && a.data_fim >= hoje)
    .sort((a, b) => a.data_inicio.localeCompare(b.data_inicio))
    .slice(0, limite);

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">Próximos Agendamentos</h2>
      </div>

      {proximos.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma saída marcada.</p>
      ) : (
        <div className="space-y-2">
          {proximos.map((a, i) => (
            <div
              key={a.id}
              className="animate-rise-in rounded-xl border border-border bg-muted/30 p-3 transition-colors hover:border-primary/40"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Truck className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold text-foreground">{a.veiculo_nome}</span>
                    {a.veiculo_identificador && (
                      <span className="font-mono text-[11px] text-muted-foreground">{a.veiculo_identificador}</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {formatarData(a.data_inicio)}
                      {a.data_fim !== a.data_inicio && ` – ${formatarData(a.data_fim)}`}
                    </span>
                    <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">
                      {LABEL_TURNO[a.turno]}
                    </span>
                  </div>
                  {a.contratos?.length > 0 && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">
                      {a.contratos.map((c) => c.contrato_nome).join(", ")}
                    </p>
                  )}
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <User className="h-3 w-3" />
                    {a.solicitante_nome ?? "—"}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
