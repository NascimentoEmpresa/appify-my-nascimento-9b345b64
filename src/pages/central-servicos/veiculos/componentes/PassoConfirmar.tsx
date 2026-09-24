import { Camera, Car, CalendarRange, Clock, FileText, Gauge, MapPin, MessageSquare } from "lucide-react";
import { Input } from "@/components/ui/input";
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
  kmInicial: string;
  fotoKm: File | null;
  onMudar: (v: Partial<{ observacoes: string; kmInicial: string; fotoKm: File | null }>) => void;
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
  kmInicial,
  fotoKm,
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

      {/* KM + foto do painel (22/09/2026): é o que permite auditar depois
          quanto o carro rodou em cada viagem e por qual contrato. */}
      <div className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50/60 p-4 dark:bg-amber-500/10">
        <div className="flex items-start gap-2">
          <Gauge className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <p className="text-sm text-foreground">
            <b>KM do painel na retirada:</b> se já estiver com o carro, registre agora; se não, deixe em
            branco e preencha depois na viagem, em <b>Meus Agendamentos</b>. Ao voltar, informe o KM final
            e outra foto — sem isso não dá para agendar outro veículo.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="km-inicial">KM inicial (painel) — opcional agora</Label>
            <Input id="km-inicial" inputMode="numeric" placeholder="Ex.: 84512" value={kmInicial}
                   onChange={(e) => onMudar({ kmInicial: e.target.value.replace(/\D/g, "") })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="foto-km">Foto do painel — opcional agora</Label>
            <label htmlFor="foto-km"
                   className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground hover:bg-muted/50">
              <Camera className="h-4 w-4 shrink-0 text-amber-600" />
              <span className="truncate">{fotoKm ? fotoKm.name : "Tirar foto / escolher imagem"}</span>
            </label>
            <input id="foto-km" type="file" accept="image/*" capture="environment" className="hidden"
                   onChange={(e) => onMudar({ fotoKm: e.target.files?.[0] ?? null })} />
          </div>
        </div>
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
