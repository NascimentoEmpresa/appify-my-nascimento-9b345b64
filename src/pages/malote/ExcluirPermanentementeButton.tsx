import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { usePermissoes } from "@/context/PermissoesContext";
import { useExcluirPermanentemente } from "@/hooks/useMaloteDespesa";

interface ExcluirPermanentementeButtonProps {
  despesaId: string;
  numero: string;
  menu: "malote_despesa_visualizar" | "malote_solicitacao_visualizar";
  voltarPara: string;
}

// SIS-2026-0194: exclusão PERMANENTE (não é cancelamento) — pra limpar
// dados de teste, restrita ao Administrador Geral via gerenciamento de
// acesso. Pede o número do item digitado de novo como confirmação extra,
// já que não tem volta.
export function ExcluirPermanentementeButton({ despesaId, numero, menu, voltarPara }: ExcluirPermanentementeButtonProps) {
  const { can } = usePermissoes();
  const navigate = useNavigate();
  const excluir = useExcluirPermanentemente();
  const [aberto, setAberto] = useState(false);
  const [confirmacao, setConfirmacao] = useState("");
  const [excluindo, setExcluindo] = useState(false);

  if (!can("excluir", "malote", menu)) return null;

  async function handleExcluir() {
    setExcluindo(true);
    try {
      await excluir.mutateAsync(despesaId);
      toast.success("Excluído permanentemente.");
      navigate(voltarPara);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao excluir.");
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-destructive border-destructive hover:bg-destructive/10 gap-1.5"
        onClick={() => {
          setConfirmacao("");
          setAberto(true);
        }}
      >
        <Trash2 className="h-3.5 w-3.5" /> Excluir permanentemente
      </Button>

      <AlertDialog open={aberto} onOpenChange={setAberto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {numero} permanentemente?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso apaga o item e todo o histórico/rateio de forma definitiva — não é cancelamento, não tem como desfazer.
              Use só pra limpar dados de teste. Digite <span className="font-mono font-semibold text-foreground">{numero}</span> pra confirmar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label className="text-xs">Confirmação</Label>
            <Input value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} autoFocus />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
            <Button variant="destructive" disabled={confirmacao !== numero || excluindo} onClick={handleExcluir}>
              {excluindo ? "Excluindo..." : "Excluir permanentemente"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
