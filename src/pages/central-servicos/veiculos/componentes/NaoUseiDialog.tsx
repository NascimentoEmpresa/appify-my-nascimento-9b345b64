import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatarData, useNaoUsei } from "@/hooks/useAgendamentoVeiculos";

/**
 * "Não usei o carro no dia" (05/11/2026): reservou, o dia passou e o carro
 * não saiu — fecha a pendência sem KM nem foto. O motivo é opcional; quem
 * marcou e quando ficam no histórico da reserva.
 */
export interface AlvoNaoUsei {
  id: string;
  numero: number;
  veiculo_nome: string;
  data_inicio: string;
  data_fim: string;
}

export function NaoUseiDialog({ alvo, onFechar }: { alvo: AlvoNaoUsei | null; onFechar: () => void }) {
  const [motivo, setMotivo] = useState("");
  const naoUsei = useNaoUsei();
  useEffect(() => { if (alvo) setMotivo(""); }, [alvo]);

  const confirmar = async () => {
    if (!alvo) return;
    await naoUsei.mutateAsync({ id: alvo.id, motivo });
    onFechar();
  };

  return (
    <Dialog open={!!alvo} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Não usei o carro no dia</DialogTitle>
          <DialogDescription>
            Agendamento nº {alvo?.numero} · {alvo?.veiculo_nome} ·{" "}
            {alvo && formatarData(alvo.data_inicio)}
            {alvo && alvo.data_fim !== alvo.data_inicio && ` a ${formatarData(alvo.data_fim)}`}.
            A viagem é fechada sem KM nem foto e sai das suas pendências.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="motivo-nao-usei">Motivo (opcional)</Label>
          <Textarea
            id="motivo-nao-usei"
            rows={3}
            autoFocus
            placeholder="Ex.: a visita foi remarcada e esqueci de cancelar"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Fica registrado no histórico, com o seu nome e o horário.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Voltar</Button>
          <Button disabled={naoUsei.isPending} onClick={confirmar}>
            {naoUsei.isPending ? "Registrando..." : "Confirmar: não usei"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
