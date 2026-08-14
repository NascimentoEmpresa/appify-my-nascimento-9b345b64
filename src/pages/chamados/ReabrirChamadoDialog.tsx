import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RotateCcw } from "lucide-react";
import { STATUS_CHAMADO, statusAoReabrir, type Chamado } from "./types";

// =====================================================================
// REABRIR CHAMADO — desfaz a conclusão (ou a reprovação) e devolve o
// chamado à fila.
//
// POR QUE EXISTE: a conclusão automática dispara no merge da PR
// (edge function chamado-concluir-pr), mas há chamado que precisa de mais
// de uma PR. Sem reabrir, a segunda entrega ficaria sem chamado aberto
// para pendurar — e o solicitante veria "concluído" com trabalho em curso.
//
// O QUE O BANCO FAZ SOZINHO ao mudar o status (nada disso vai no update):
//   · `concluido_em` volta a NULL — trigger chamado_sistema_guard;
//   · `posicao_dev` é recalculado e o chamado entra no FIM da fila do
//     responsável — trigger chamado_sistema_fila_dev.
//
// `motivo_reprovacao` fica como estava, de propósito: é o registro de uma
// reprovação que de fato aconteceu. As telas só o exibem enquanto o status
// é 'reprovado', então ele some da vista ao reabrir sem sumir do histórico
// (o relatório em PDF continua mostrando, que é o comportamento desejado).
// =====================================================================
export function ReabrirChamadoDialog({
  open,
  onOpenChange,
  chamado,
  onReaberto,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  chamado: Pick<Chamado, "id" | "numero" | "status" | "responsavel_id"> | null;
  onReaberto?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [motivo, setMotivo] = useState("");
  const [reabrindo, setReabrindo] = useState(false);

  const fechar = (v: boolean) => {
    if (reabrindo) return;
    if (!v) setMotivo("");
    onOpenChange(v);
  };

  const reabrir = async () => {
    if (!chamado || reabrindo) return;
    setReabrindo(true);

    const novo = statusAoReabrir(chamado);
    const { error } = await (supabase as any)
      .from("CHAMADO_SISTEMA").update({ status: novo }).eq("id", chamado.id);
    if (error) {
      setReabrindo(false);
      toast({ title: "Erro ao reabrir", description: error.message, variant: "destructive" });
      return;
    }

    const rotulo = STATUS_CHAMADO[novo]?.label ?? novo;
    const texto = motivo.trim()
      ? `Chamado reaberto (${rotulo}): ${motivo.trim()}`
      : `Chamado reaberto — voltou para ${rotulo}`;
    // Histórico e push não desfazem a reabertura, que já valeu — por isso o
    // erro daqui não vira toast de falha (o supabase-js devolve em `error`,
    // não lança).
    await (supabase as any).from("CHAMADO_SISTEMA_EVENTO")
      .insert({ chamado_id: chamado.id, tipo: "evento", texto });
    supabase.functions
      .invoke("enviar-notificacao-push", { body: { chamado_id: chamado.id, evento: "reaberto" } })
      .catch(() => {});

    setReabrindo(false);
    setMotivo("");
    onOpenChange(false);
    toast({ title: `Chamado #${chamado.numero} reaberto`, description: `Voltou para "${rotulo}".` });
    // Um chamado reaberto muda fila, contadores e listas das duas telas ao
    // mesmo tempo; invalidar por prefixo evita listar chave por chave e
    // esquecer uma quando surgir tela nova.
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("chamado") });
    onReaberto?.();
  };

  const novo = chamado ? statusAoReabrir(chamado) : "aberto";

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-primary" /> Reabrir chamado{chamado ? ` #${chamado.numero}` : ""}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          O chamado volta para <b>{STATUS_CHAMADO[novo]?.label ?? novo}</b>
          {chamado?.responsavel_id ? ", no fim da fila do responsável" : ""}, e a data de conclusão é desfeita.
          O solicitante é avisado.
        </p>
        <Textarea
          rows={3}
          placeholder="Motivo (opcional) — ex.: falta a segunda PR do ajuste. Aparece no histórico."
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => fechar(false)} disabled={reabrindo}>Cancelar</Button>
          <Button onClick={reabrir} disabled={!chamado || reabrindo}>
            {reabrindo ? "Reabrindo…" : "Reabrir chamado"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
