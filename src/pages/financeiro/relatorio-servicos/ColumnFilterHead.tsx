import { useEffect, useState } from "react";
import { TableHead } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Filter } from "lucide-react";
import { cn } from "@/lib/utils";

// SIS-2026-0323 (mockup do Ruan/Discord, pedido explícito do usuário):
// filtro por cabeçalho de coluna (funil + popover), no lugar da faixa de
// filtros inline que ele achou "estranha" — o usuário achou o padrão do
// protótipo mais intuitivo.
export function ColumnFilterHead({
  label,
  value,
  onApply,
  type = "text",
  options = [],
  className,
}: {
  label: string;
  value: string;
  onApply: (v: string) => void;
  type?: "text" | "date" | "select" | "money";
  options?: string[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  function aplicar(v: string) {
    onApply(v);
    setOpen(false);
  }

  return (
    <TableHead className={cn("text-center", className)}>
      <div className="flex items-center justify-center gap-1">
        <span>{label}</span>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted",
                value && "text-primary"
              )}
              title={`Filtrar ${label}`}
              aria-label={`Filtrar ${label}`}
            >
              <Filter className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2.5" align="center">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Filtrar por {label}</p>
            {type === "select" ? (
              <Select value={draft || "__todos"} onValueChange={(v) => setDraft(v === "__todos" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__todos">Todos</SelectItem>
                  {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Input
                autoFocus
                type={type === "date" ? "date" : "text"}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={type === "money" ? "Ex.: 1.000,00" : "Digite para filtrar..."}
                className="h-8 text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") aplicar(draft);
                  if (e.key === "Escape") setOpen(false);
                }}
              />
            )}
            <div className="mt-2 flex justify-between gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => aplicar("")}>Limpar</Button>
              <Button size="sm" className="h-7 text-xs" onClick={() => aplicar(draft)}>Aplicar</Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </TableHead>
  );
}
