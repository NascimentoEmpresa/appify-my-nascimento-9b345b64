import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const DIAS_SEMANA = [
  { value: "0", label: "Domingo" },
  { value: "1", label: "Segunda-feira" },
  { value: "2", label: "Terça-feira" },
  { value: "3", label: "Quarta-feira" },
  { value: "4", label: "Quinta-feira" },
  { value: "5", label: "Sexta-feira" },
  { value: "6", label: "Sábado" },
];

/** Diálogo compartilhado de edição em massa (dia da semana + horário) — usado tanto por "Editar série" quanto pela seleção manual na lista de reuniões. */
export function EditarDiaHorarioDialog({
  open, onOpenChange, titulo, descricao, salvando, onSalvar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titulo: string;
  descricao: string;
  salvando: boolean;
  onSalvar: (novoDiaSemana: number, novoHorario: string) => Promise<void> | void;
}) {
  const [novoDiaSemana, setNovoDiaSemana] = useState("1");
  const [novoHorario, setNovoHorario] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{titulo}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{descricao}</p>
        <div className="space-y-1.5">
          <Label>Novo dia da semana</Label>
          <Select value={novoDiaSemana} onValueChange={setNovoDiaSemana}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DIAS_SEMANA.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Novo horário</Label>
          <Input type="time" value={novoHorario} onChange={(e) => setNovoHorario(e.target.value)} />
        </div>
        <Button
          className="w-full"
          disabled={!novoHorario || salvando}
          onClick={async () => {
            await onSalvar(Number(novoDiaSemana), novoHorario);
            setNovoHorario("");
          }}
        >
          {salvando ? "Salvando…" : "Salvar"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
