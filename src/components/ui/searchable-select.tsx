import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SearchableOption {
  value: string;
  label: string;
  hint?: string;
}

interface SearchableSelectProps {
  value: string | null | undefined;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  allowClear?: boolean;
  clearValue?: string;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
}

/**
 * Combobox pesquisável genérico (Popover + Command).
 * Não dispara nenhuma mutação. Apenas filtra opções e devolve a seleção.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Selecione...",
  searchPlaceholder = "Buscar...",
  emptyLabel = "Nenhum resultado",
  disabled,
  allowClear,
  clearValue = "",
  className,
  triggerClassName,
  contentClassName,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const selected = React.useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  return (
    <div className={cn("relative", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "w-full justify-between font-normal",
              !selected && "text-muted-foreground",
              triggerClassName,
            )}
          >
            <span className="truncate text-left">
              {selected ? selected.label : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className={cn(
            "p-0 w-[--radix-popover-trigger-width] min-w-[320px] max-w-[min(480px,90vw)]",
            contentClassName,
          )}
          align="start"
        >
          <Command
            filter={(itemValue, search) => {
              if (!search) return 1;
              return itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
            }}
          >
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>{emptyLabel}</CommandEmpty>
              <CommandGroup>
                {options.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={`${opt.label} ${opt.hint ?? ""} ${opt.value}`}
                    onSelect={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === opt.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="whitespace-normal break-words">{opt.label}</span>
                      {opt.hint && (
                        <span className="truncate text-xs text-muted-foreground">{opt.hint}</span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {allowClear && selected && !disabled && (
        <button
          type="button"
          aria-label="Limpar"
          onClick={(e) => {
            e.stopPropagation();
            onChange(clearValue);
          }}
          className="absolute right-9 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
