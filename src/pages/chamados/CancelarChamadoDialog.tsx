import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { XCircle } from "lucide-react";
import type { Chamado } from "./types";

// =====================================================================
// CANCELAR CHAMADO — o SOLICITANTE desiste do próprio chamado enquanto ele
// não foi encerrado (29/09/2026, mig 260).
//
// Vai pela RPC chamado_cancelar_pelo_solicitante: o gatilho do banco não
// deixa o solicitante mudar status direto. A RPC grava o status
// 'cancelado', o motivo (motivo_cancelamento) e o "Chamado cancelado:
// motivo" na conversa — que o ChatChamado traduz para "Fulano cancelou o
// chamado — motivo" — e tira o chamado da fila do responsável.
//
// Motivo obrigatório: é o que o time lê pra entender por que o trabalho
// parou (e se dá pra aproveitar algo). Cancelado ainda pode ser reaberto
// pelo próprio solicitante (ReabrirChamadoDialog).
// =====================================================================
export function CancelarChamadoDialog({
  open,
  onOpenChange,
  chamado,
  onCancelado,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  chamado: Pick<Chamado, "id" | "numero"> | null;
  onCancelado?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [motivo, setMotivo] = useState("");
  const [cancelando, setCancelando] = useState(false);

  const fechar = (v: boolean) => {
    if (cancelando) return;
    if (!v) setMotivo("");
    onOpenChange(v);
  };

  const cancelar = async () => {
    if (!chamado || cancelando) return;
    if (motivo.trim().length < 5) {
      toast({ title: "Conte por que está cancelando", description: "O time lê o motivo na conversa do chamado.", variant: "destructive" });
      return;
    }
    setCancelando(true);
    const { error } = await (supabase as any)
      .rpc("chamado_cancelar_pelo_solicitante", { p_chamado_id: chamado.id, p_motivo: motivo.trim() });
    if (error) {
      setCancelando(false);
      toast({ title: "Erro ao cancelar", description: error.message, variant: "destructive" });
      return;
    }
    // Avisa o responsável (o push vai também pro solicitante, que ignora).
    supabase.functions
      .invoke("enviar-notificacao-push", { body: { chamado_id: chamado.id, evento: "cancelado" } })
      .catch(() => {});

    setCancelando(false);
    setMotivo("");
    onOpenChange(false);
    toast({ title: `Chamado #${chamado.numero} cancelado`, description: "Se mudar de ideia, dá para reabrir por esta mesma tela." });
    // Mesmo motivo do ReabrirChamadoDialog: fila, contadores e listas mudam
    // juntos — invalidar por prefixo não esquece nenhuma tela.
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("chamado") });
    onCancelado?.();
  };

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-destructive" /> Cancelar chamado{chamado ? ` #${chamado.numero}` : ""}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          O chamado sai da fila de atendimento e a conversa é encerrada. O time vê o motivo no histórico.
          Se precisar de novo, você mesmo pode reabrir depois.
        </p>
        <Textarea
          rows={3}
          placeholder="Por que está cancelando? Ex.: consegui resolver com o setor / não é mais necessário. (obrigatório)"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => fechar(false)} disabled={cancelando}>Voltar</Button>
          <Button variant="destructive" onClick={cancelar} disabled={!chamado || cancelando || motivo.trim().length < 5}>
            {cancelando ? "Cancelando…" : "Cancelar chamado"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
