import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Upload, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useImportarMovimentosContaGarantida, useAtualizarCdi } from "@/hooks/useContaGarantida";

export function ImportarFluxoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const importar = useImportarMovimentosContaGarantida();
  const atualizarCdi = useAtualizarCdi();
  const [resultado, setResultado] = useState<number | null>(null);
  const processando = importar.isPending || atualizarCdi.isPending;

  async function handleArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setResultado(null);
    try {
      const qtd = await importar.mutateAsync(arquivo);
      await atualizarCdi.mutateAsync();
      setResultado(qtd);
      toast.success(`${qtd} movimento(s) importado(s).`);
    } catch (err: any) {
      toast.error("Erro ao importar: " + err.message);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Importar Fluxo de Caixa</DialogTitle>
          <DialogDescription>
            Selecione o mesmo arquivo "BD Fluxo de Caixa" (.xlsx) que o Financeiro já mantém atualizado. A importação
            substitui por completo os movimentos anteriores e atualiza o CDI do Bacen.
          </DialogDescription>
        </DialogHeader>

        <label className="cursor-pointer">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="sr-only" onChange={handleArquivo} disabled={processando} />
          <span className="flex h-24 w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-border text-sm text-muted-foreground hover:bg-muted/30 transition-colors">
            <Upload className="h-4 w-4" />
            {processando ? "Processando..." : "Clique para selecionar a planilha (.xlsx)"}
          </span>
        </label>

        {resultado !== null && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> {resultado} movimento(s) importado(s) e CDI atualizado.
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
