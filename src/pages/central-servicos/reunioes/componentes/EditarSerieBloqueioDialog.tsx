import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MOTIVO_BLOQUEIO_LABEL, type MotivoBloqueioAgenda } from "../types";

export const DIAS_SEMANA = [
  { value: "0", label: "Domingo" },
  { value: "1", label: "Segunda-feira" },
  { value: "2", label: "Terça-feira" },
  { value: "3", label: "Quarta-feira" },
  { value: "4", label: "Quinta-feira" },
  { value: "5", label: "Sexta-feira" },
  { value: "6", label: "Sábado" },
];

export interface ValoresSerieBloqueio {
  diaSemana: number;
  dia_inteiro: boolean;
  hora_inicio: string | null;
  hora_fim: string | null;
  motivo: MotivoBloqueioAgenda;
  motivo_outro: string | null;
}

/** Diálogo de edição em massa de uma série de bloqueios de agenda — pré-preenchido com os valores atuais, a pessoa edita só o que quiser (dia da semana e/ou horário e/ou motivo são todos opcionais na prática, já que os campos não tocados só reenviam o valor atual). */
export function EditarSerieBloqueioDialog({
  open, onOpenChange, valoresAtuais, salvando, onSalvar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  valoresAtuais: ValoresSerieBloqueio;
  salvando: boolean;
  onSalvar: (dados: ValoresSerieBloqueio) => Promise<void> | void;
}) {
  const [diaSemana, setDiaSemana] = useState(String(valoresAtuais.diaSemana));
  const [diaInteiro, setDiaInteiro] = useState(valoresAtuais.dia_inteiro);
  const [horaInicio, setHoraInicio] = useState(valoresAtuais.hora_inicio ?? "");
  const [horaFim, setHoraFim] = useState(valoresAtuais.hora_fim ?? "");
  const [motivo, setMotivo] = useState<MotivoBloqueioAgenda>(valoresAtuais.motivo);
  const [motivoOutro, setMotivoOutro] = useState(valoresAtuais.motivo_outro ?? "");

  const valido = (diaInteiro || !!(horaInicio && horaFim && horaFim > horaInicio)) && (motivo !== "outro" || !!motivoOutro.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>Editar série de bloqueios</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Muda as ocorrências futuras dessa série. Passadas não são alteradas. Edita só o que precisar — o resto continua como está.
        </p>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Dia da semana</Label>
            <Select value={diaSemana} onValueChange={setDiaSemana}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DIAS_SEMANA.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={diaInteiro} onCheckedChange={(v) => setDiaInteiro(!!v)} />
            Marcar o dia todo
          </label>
          {!diaInteiro && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Horário início *</Label>
                <Input type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Horário fim *</Label>
                <Input type="time" value={horaFim} onChange={(e) => setHoraFim(e.target.value)} />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Motivo do bloqueio *</Label>
            <RadioGroup value={motivo} onValueChange={(v) => setMotivo(v as MotivoBloqueioAgenda)} className="space-y-1.5">
              {(Object.keys(MOTIVO_BLOQUEIO_LABEL) as MotivoBloqueioAgenda[]).map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value={m} />
                  {MOTIVO_BLOQUEIO_LABEL[m]}
                </label>
              ))}
            </RadioGroup>
          </div>

          {motivo === "outro" && (
            <div className="space-y-1.5">
              <Label>Outro motivo *</Label>
              <Textarea
                value={motivoOutro}
                maxLength={250}
                onChange={(e) => setMotivoOutro(e.target.value)}
                placeholder="Descreva o motivo do bloqueio..."
                className="min-h-16"
              />
            </div>
          )}
        </div>

        <Button
          className="w-full"
          disabled={!valido || salvando}
          onClick={() => onSalvar({
            diaSemana: Number(diaSemana),
            dia_inteiro: diaInteiro,
            hora_inicio: diaInteiro ? null : horaInicio,
            hora_fim: diaInteiro ? null : horaFim,
            motivo,
            motivo_outro: motivo === "outro" ? motivoOutro.trim() : null,
          })}
        >
          {salvando ? "Salvando…" : "Salvar"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
