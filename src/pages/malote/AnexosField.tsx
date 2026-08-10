import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip, X } from "lucide-react";
import { toast } from "sonner";

interface AnexosFieldProps {
  arquivos: File[];
  onChange: (arquivos: File[]) => void;
  disabled?: boolean;
}

export function AnexosField({ arquivos, onChange, disabled }: AnexosFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function adicionar(novos: FileList | File[]) {
    onChange([...arquivos, ...Array.from(novos)]);
  }

  function remover(idx: number) {
    onChange(arquivos.filter((_, i) => i !== idx));
  }

  function handlePaste(e: React.ClipboardEvent) {
    if (disabled) return;
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (!item) return;
    const file = item.getAsFile();
    if (file) {
      adicionar([new File([file], `colado-${Date.now()}.png`, { type: file.type })]);
      toast.success("Imagem colada anexada.");
    }
  }

  return (
    <div onPaste={handlePaste} tabIndex={0} className="space-y-2">
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled}>
          Escolher arquivos
        </Button>
        <span className="text-xs text-muted-foreground">
          {arquivos.length > 0 ? `${arquivos.length} arquivo(s) escolhido(s)` : "Nenhum arquivo escolhido"}
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && adicionar(e.target.files)}
        />
      </div>
      <p className="text-xs text-muted-foreground">Dica: anexe orçamentos, print, PDF etc. — ou Ctrl+V para colar uma imagem.</p>
      {arquivos.length > 0 && (
        <ul className="space-y-1">
          {arquivos.map((f, i) => (
            <li key={i} className="flex items-center justify-between rounded-md border border-border px-2 py-1 text-xs">
              <span className="flex items-center gap-1.5 truncate">
                <Paperclip className="h-3 w-3 shrink-0" /> {f.name}
              </span>
              {!disabled && (
                <button type="button" onClick={() => remover(i)} className="text-muted-foreground hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
