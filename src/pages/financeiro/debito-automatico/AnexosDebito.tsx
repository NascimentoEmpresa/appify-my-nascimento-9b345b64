import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip, Trash2, Upload, FileText } from "lucide-react";
import { toast } from "sonner";
import {
  DebitoAutomaticoAnexo, TipoAnexoDebito, baixarAnexoDebito, useAnexosDebito, useEnviarAnexosDebito, useExcluirAnexoDebito,
} from "@/hooks/useDebitoAutomatico";

// SIS-2026-0570: anexos do Débito Automático. "lancamento" = nota/boleto do
// lançamento; "comprovante" = o comprovante de pagamento da parcela (cada
// parcela tem o seu, não é compartilhado).

const fmtTamanho = (b: number | null) => (b == null ? "" : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function AnexosDebito({
  debitoId, tipo, titulo, podeEditar = true,
}: {
  debitoId: string;
  tipo: TipoAnexoDebito;
  titulo: string;
  podeEditar?: boolean;
}) {
  const { data: todos = [] } = useAnexosDebito(debitoId);
  const enviar = useEnviarAnexosDebito();
  const excluir = useExcluirAnexoDebito();
  const inputRef = useRef<HTMLInputElement>(null);
  const anexos = todos.filter((a) => a.tipo === tipo);

  async function onEscolher(files: FileList | null) {
    if (!files || files.length === 0) return;
    try {
      await enviar.mutateAsync({ debitoId, tipo, arquivos: Array.from(files) });
      toast.success(files.length > 1 ? "Arquivos anexados." : "Arquivo anexado.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao anexar arquivo.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onExcluir(a: DebitoAutomaticoAnexo) {
    try {
      await excluir.mutateAsync(a);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao remover arquivo.");
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium flex items-center gap-1"><Paperclip className="h-3.5 w-3.5" /> {titulo}</span>
        {podeEditar && (
          <>
            <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => onEscolher(e.target.files)} />
            <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={enviar.isPending} onClick={() => inputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> {enviar.isPending ? "Enviando..." : "Anexar"}
            </Button>
          </>
        )}
      </div>
      {anexos.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum arquivo.</p>
      ) : (
        <ul className="space-y-1">
          {anexos.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded border bg-muted/30 px-2 py-1 text-xs">
              <button type="button" className="flex min-w-0 items-center gap-1.5 text-left hover:underline" onClick={() => baixarAnexoDebito(a.storage_path).catch((e) => toast.error(e.message))}>
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{a.nome_arquivo}</span>
                <span className="shrink-0 text-muted-foreground">{fmtTamanho(a.tamanho_bytes)}</span>
              </button>
              {podeEditar && (
                <button type="button" className="text-destructive" title="Remover" onClick={() => onExcluir(a)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
