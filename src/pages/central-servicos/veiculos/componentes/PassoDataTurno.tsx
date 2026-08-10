import { AlertTriangle, Sun, Sunset, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  HORARIO_TURNO,
  LABEL_TURNO,
  conflitoNaAgenda,
  formatarData,
  hojeISO,
  type Agendamento,
  type Turno,
  type VeiculoFrota,
} from "@/hooks/useAgendamentoVeiculos";

interface Props {
  veiculo: VeiculoFrota;
  agendamentos: Agendamento[];
  dataInicio: string;
  dataFim: string;
  turno: Turno;
  onMudar: (v: { dataInicio?: string; dataFim?: string; turno?: Turno }) => void;
}

const ICONE_TURNO: Record<Turno, typeof Sun> = { manha: Sun, tarde: Sunset, dia_todo: Clock };
const ORDEM_TURNOS: Turno[] = ["manha", "tarde", "dia_todo"];

/**
 * Passo 2 — quando. O conflito com outra reserva aparece aqui, enquanto o
 * usuário ainda está escolhendo, e não como erro depois de confirmar: cada
 * turno mostra na hora se já está tomado.
 */
export function PassoDataTurno({ veiculo, agendamentos, dataInicio, dataFim, turno, onMudar }: Props) {
  const conflito = conflitoNaAgenda(agendamentos, veiculo.id, dataInicio, dataFim, turno);
  const periodoInvalido = !!dataInicio && !!dataFim && dataFim < dataInicio;

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h3 className="text-lg font-bold text-foreground">Data e Turno</h3>
        <p className="text-sm text-muted-foreground">
          Quando você precisa do <span className="font-medium text-foreground">{veiculo.nome}</span>?
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="data-inicio">Data de saída</Label>
          <Input
            id="data-inicio"
            type="date"
            value={dataInicio}
            min={hojeISO()}
            onChange={(e) => {
              const nova = e.target.value;
              // A volta acompanha a ida quando ficaria antes dela — mexer numa
              // data e ver a outra virar inválida sozinha é irritante.
              onMudar({ dataInicio: nova, ...(dataFim < nova ? { dataFim: nova } : {}) });
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="data-fim">Data de retorno</Label>
          <Input
            id="data-fim"
            type="date"
            value={dataFim}
            min={dataInicio || hojeISO()}
            onChange={(e) => onMudar({ dataFim: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Turno</Label>
        <div className="grid gap-3 sm:grid-cols-3">
          {ORDEM_TURNOS.map((t, i) => {
            const Icone = ICONE_TURNO[t];
            const ocupado = !!conflitoNaAgenda(agendamentos, veiculo.id, dataInicio, dataFim, t);
            const ativo = turno === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => onMudar({ turno: t })}
                className={cn(
                  "group flex animate-rise-in flex-col items-start gap-1 rounded-xl border p-4 text-left transition-all duration-300",
                  ativo
                    ? "border-primary bg-primary/5 shadow-md shadow-primary/10 ring-2 ring-primary/30"
                    : "border-border bg-card hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
                  ocupado && !ativo && "opacity-60",
                )}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                    ativo ? "animate-pop bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
                  )}
                >
                  <Icone className="h-4 w-4" />
                </span>
                <span className="font-semibold text-foreground">{LABEL_TURNO[t]}</span>
                <span className="text-xs text-muted-foreground">{HORARIO_TURNO[t]}</span>
                {ocupado && (
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Já reservado</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {periodoInvalido && (
        <Aviso texto="A data de retorno não pode ser anterior à data de saída." />
      )}
      {!periodoInvalido && conflito && (
        <Aviso
          texto={`O ${veiculo.nome} já está reservado para ${formatarData(conflito.data_inicio)}${
            conflito.data_fim !== conflito.data_inicio ? ` a ${formatarData(conflito.data_fim)}` : ""
          } (${LABEL_TURNO[conflito.turno]}) por ${conflito.solicitante_nome ?? "outro colaborador"}. Escolha outra data, outro turno ou outro veículo.`}
        />
      )}
    </div>
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="flex animate-fade-in items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-sm text-amber-700 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{texto}</span>
    </div>
  );
}
