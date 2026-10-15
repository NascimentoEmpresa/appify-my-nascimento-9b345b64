import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useExcluirExcecao } from "@/hooks/useMaloteExcecao";
import type { ExcecaoSolicitacao } from "./regras";

// SIS-2026-0668: confirmação de exclusão de uma solicitação de exceção. A exclusão é lógica (some das telas, fica no
// banco para auditoria) e o banco confere quem pode (malote_excecao_excluir).
export function ExcluirExcecaoDialog({ alvo, onClose }: { alvo: ExcecaoSolicitacao | null; onClose: () => void }) {
  const excluir = useExcluirExcecao();

  async function confirmar() {
    if (!alvo) return;
    try {
      await excluir.mutateAsync(alvo.id);
      toast.success(`Solicitação ${alvo.numero} excluída.`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível excluir a solicitação.");
    }
  }

  return (
    <AlertDialog open={!!alvo} onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir a solicitação {alvo?.numero}?</AlertDialogTitle>
          <AlertDialogDescription>
            Ela deixa de aparecer nas telas.
            {alvo?.status === "aprovada" && " Como já está aprovada, a senha liberada deixa de valer."}
            {" "}O registro fica guardado para auditoria.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <Button variant="destructive" onClick={() => void confirmar()} disabled={excluir.isPending}>
            {excluir.isPending ? "Excluindo…" : "Excluir"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
