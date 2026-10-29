import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { ReabrirChamadoDialog } from "./ReabrirChamadoDialog";
import type { Chamado } from "./types";

// =====================================================================
// CONFIRMAR CONCLUSÃO — o SOLICITANTE fecha o chamado que o time concluiu
// (28/10/2026, mig 20261028001300).
//
// Pedido do Pablo: "o setor de sistemas quando clicar em CONCLUIR o
// SOLICITANTE vai ter que clicar em CONFIRMAR CONCLUSÃO, antes de continuar e
// abrir o próximo quarto chamado (respeitando aquele limite de 3)."
//
// Concluir (botão do dev ou merge da PR) deixa o chamado 'concluido' com
// conclusao_confirmada_em NULL. Até o solicitante confirmar aqui, ele conta
// nas pendências (chamado_pendencias_solicitante, pendência 'confirmacao') e,
// com 3 pendências, o gatilho do banco não deixa abrir o 4º chamado.
//
// Vai pela RPC chamado_confirmar_conclusao — o gatilho
// chamado_sistema_confirmacao não deixa marcar a confirmação por UPDATE.
// "Não resolveu" é o reabrir que já existe (ReabrirChamadoDialog no modo
// solicitante, mig 255): motivo obrigatório e o chamado volta para o dev.
// Confirmado, a tela que abriu este diálogo oferece a avaliação
// (onConfirmado) — a avaliação só entra depois da confirmação.
// =====================================================================
export function ConfirmarConclusaoDialog({
  open,
  onOpenChange,
  chamado,
  onConfirmado,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  chamado: Pick<Chamado, "id" | "numero" | "status" | "responsavel_id"> & { assunto?: string } | null;
  onConfirmado?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirmando, setConfirmando] = useState(false);
  const [reabrirAberto, setReabrirAberto] = useState(false);

  const invalidar = () => {
    // Pendências, listas, contadores e a bolinha da sidebar mudam juntos.
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("chamado") });
  };

  const confirmar = async () => {
    if (!chamado || confirmando) return;
    setConfirmando(true);
    const { error } = await (supabase as any).rpc("chamado_confirmar_conclusao", { p_chamado_id: chamado.id });
    setConfirmando(false);
    if (error) {
      toast({ title: "Não foi possível confirmar", description: error.message, variant: "destructive" });
      return;
    }
    onOpenChange(false);
    toast({ title: `Conclusão do chamado #${chamado.numero} confirmada`, description: "Obrigado! Agora avalie o atendimento." });
    invalidar();
    onConfirmado?.();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!confirmando) onOpenChange(v); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" /> Confirmar conclusão{chamado ? ` #${chamado.numero}` : ""}
            </DialogTitle>
          </DialogHeader>
          {chamado?.assunto && <p className="text-sm font-medium [overflow-wrap:anywhere]">{chamado.assunto}</p>}
          <p className="text-sm text-muted-foreground">
            O time de Sistemas concluiu este chamado. Confira se ficou como você pediu: confirmando, o chamado
            é encerrado e deixa de contar no limite de pendências para abrir chamados novos.
          </p>
          <p className="text-xs text-muted-foreground">
            Não resolveu? Reabra e conte o que falta — o chamado volta para o desenvolvedor.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" className="gap-1.5" disabled={!chamado || confirmando}
              onClick={() => { onOpenChange(false); setReabrirAberto(true); }}>
              <RotateCcw className="h-4 w-4" /> Não resolveu — reabrir
            </Button>
            <Button className="gap-1.5" onClick={confirmar} disabled={!chamado || confirmando}>
              <CheckCircle2 className="h-4 w-4" /> {confirmando ? "Confirmando…" : "Confirmar conclusão"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ReabrirChamadoDialog
        open={reabrirAberto}
        onOpenChange={setReabrirAberto}
        chamado={chamado}
        modo="solicitante"
        onReaberto={invalidar}
      />
    </>
  );
}
