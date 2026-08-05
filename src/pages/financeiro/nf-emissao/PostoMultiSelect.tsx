import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { PostoVigente } from "@/hooks/usePlanilhaCusto";
import { fmtMoney } from "./shared";

// Um item de NF/modelo pode juntar mais de um posto (ex: UFFS — "Limpeza e
// Jardinagem" viram 1 item, "Motorista, Serviços Gerais, Tradutor/Intérprete
// de Libras e Encarregado" viram outro, cada um com sua própria retenção).
export function PostoMultiSelect({
  postosVigentes,
  value,
  onChange,
  placeholder = "Selecionar posto(s)",
  disabled,
}: {
  postosVigentes: PostoVigente[];
  value: string[];
  onChange: (postos: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  function toggle(posto: string) {
    onChange(value.includes(posto) ? value.filter((p) => p !== posto) : [...value, posto]);
  }

  const label =
    value.length === 0 ? placeholder : value.length <= 2 ? value.join(", ") : `${value.length} postos selecionados`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="h-8 w-full justify-between px-2 text-xs font-normal"
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar posto…" />
          <CommandList>
            <CommandEmpty>Nenhum posto encontrado.</CommandEmpty>
            <CommandGroup>
              {postosVigentes.map((p) => (
                <CommandItem key={p.posto} value={p.posto} onSelect={() => toggle(p.posto)}>
                  <Check className={cn("mr-2 h-4 w-4", value.includes(p.posto) ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">{p.posto}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{fmtMoney(p.valorTotal)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
