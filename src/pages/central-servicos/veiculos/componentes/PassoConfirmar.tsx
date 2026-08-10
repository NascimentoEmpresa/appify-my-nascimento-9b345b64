import { Car, CalendarRange, Clock, FileText, MapPin, MessageSquare } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  LABEL_TURNO,
  HORARIO_TURNO,
  formatarData,
  type Turno,
  type VeiculoFrota,
} from "@/hooks/useAgendamentoVeiculos";

interface Props {
  veiculo: VeiculoFrota;
  dataInicio: string;
  dataFim: string;
  turno: Turno;
  contratos: string[];
  destino: string;
  motivo: string;
  observacoes: string;
  onMudar: (v: { observacoes: string }) => void;
}

/** Passo 4 — a conferida final antes de tomar o carro de alguém. */
export function PassoConfirmar({
  veiculo,
  dataInicio,
  dataFim,
  turno,
  contratos,
  destino,
  motivo,
  observacoes,
  onMudar,
}: Props) {
  const periodo =
    dataInicio === dataFim
      ? formatarData(dataInicio)
      : `${formatarData(dataInicio)} a ${formatarData(dataFim)}`;

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h3 className="text-lg font-bold text-foreground">Confirme o agendamento</h3>
        <p className="text-sm text-muted-foreground">Confira os dados antes de reservar o veículo.</p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-primary/30 bg-primary/5">
        <div className="flex items-center gap-3 border-b border-primary/20 bg-primary/10 p-4">
          <span className="flex h-12 w-12 animate-pop items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Car className="h-6 w-6" />
          </span>
          <div>
            <div className="font-bold text-foreground">{veiculo.nome}</div>
            {veiculo.identificador && (
              <div className="font-mono text-xs text-muted-foreground">{veiculo.identificador}</div>
            )}
          </div>
        </div>

        <dl className="divide-y divide-primary/15">
          <Linha icone={CalendarRange} rotulo="Período" valor={periodo} />
          <Linha icone={Clock} rotulo="Turno" valor={`${LABEL_TURNO[turno]} · ${HORARIO_TURNO[turno]}`} />
          <Linha icone={FileText} rotulo="Contratos" valor={contratos.join(", ")} />
          {destino.trim() && <Linha icone={MapPin} rotulo="Destino" valor={destino.trim()} />}
          {motivo.trim() && <Linha icone={MessageSquare} rotulo="Motivo" valor={motivo.trim()} />}
        </dl>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="observacoes">Observações (opcional)</Label>
        <Textarea
          id="observacoes"
          rows={3}
          placeholder="Algo que quem cuida da frota precise saber."
          value={observacoes}
          onChange={(e) => onMudar({ observacoes: e.target.value })}
        />
      </div>
    </div>
  );
}

function Linha({
  icone: Icone,
  rotulo,
  valor,
}: {
  icone: typeof Car;
  rotulo: string;
  valor: string;
}) {
  return (
    <div className="flex items-start gap-3 p-4">
      <Icone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <dt className="w-24 shrink-0 text-sm text-muted-foreground">{rotulo}</dt>
      <dd className="min-w-0 flex-1 text-sm font-medium text-foreground">{valor}</dd>
    </div>
  );
}
