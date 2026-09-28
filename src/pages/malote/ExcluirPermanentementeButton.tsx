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
  // [SEM-CHAMADO] (achado do usuário: só dava pra excluir permanentemente
  // de dentro da própria despesa, nunca de dentro da Lixeira do Fluxo de
  // Caixa — onde o item já está, depois de "Mover para a lixeira"): com
  // `onSuccess`, o botão fica na tela atual (ex. atualiza uma lista) em vez
  // de navegar. `voltarPara` continua sendo o padrão pra quem já estava na
  // própria tela da despesa.
  voltarPara?: string;
  onSuccess?: () => void;
}

// SIS-2026-0194: exclusão PERMANENTE (não é cancelamento) — pra limpar
// dados de teste, restrita ao Administrador Geral via gerenciamento de
// acesso. Pede o número do item digitado de novo como confirmação extra,
// já que não tem volta.
export function ExcluirPermanentementeButton({ despesaId, numero, menu, voltarPara, onSuccess }: ExcluirPermanentementeButtonProps) {
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
      if (onSuccess) onSuccess();
      else if (voltarPara) navigate(voltarPara);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao excluir.");
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <>
      {/* [SEM-CHAMADO] (achado do usuário): "Excluir permanentemente" por
          extenso, ao lado de "Restaurar", não cabia nas linhas da Lixeira
          (Meus Itens/Fluxo de Caixa) e forçava scroll lateral no Dialog —
          ícone só, com title, e o texto continua no AlertDialog de
          confirmação abaixo, onde a clareza realmente importa. */}
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8 text-destructive border-destructive hover:bg-destructive/10"
        title="Excluir permanentemente"
        onClick={() => {
          setConfirmacao("");
          setAberto(true);
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
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
