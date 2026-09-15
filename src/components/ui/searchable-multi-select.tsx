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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SearchableOption } from "@/components/ui/searchable-select";

interface SearchableMultiSelectProps {
  value: string[];
  onChange: (value: string[]) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  /** Mostra no máximo N badges e resume o resto em "+K" — mantém a altura em grades de filtro. */
  maxBadges?: number;
}

export function SearchableMultiSelect({
  value,
  onChange,
  options,
  placeholder = "Selecionar pessoas...",
  searchPlaceholder = "Buscar...",
  emptyLabel = "Nenhum resultado",
  disabled,
  className,
  maxBadges,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = React.useState(false);

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  const remove = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(value.filter((v) => v !== id));
  };

  const selectedOptions = options.filter((o) => value.includes(o.value));
  const visibleOptions = maxBadges !== undefined ? selectedOptions.slice(0, maxBadges) : selectedOptions;
  const hiddenCount = selectedOptions.length - visibleOptions.length;

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
            className="w-full min-h-9 h-auto justify-between font-normal flex-wrap gap-1 py-1.5"
          >
            <span className="flex flex-wrap gap-1 flex-1">
              {selectedOptions.length === 0 ? (
                <span className="text-muted-foreground">{placeholder}</span>
              ) : (
                visibleOptions.map((o) => (
                  <Badge key={o.value} variant="secondary" className="text-xs gap-1 pr-1">
                    {o.label}
                    {!disabled && (
                      <button
                        type="button"
                        aria-label={`Remover ${o.label}`}
                        onClick={(e) => remove(o.value, e)}
                        className="rounded-sm opacity-70 hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </Badge>
                ))
              )}
              {hiddenCount > 0 && (
                <Badge variant="outline" className="text-xs">+{hiddenCount}</Badge>
              )}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="p-0 w-[--radix-popover-trigger-width] min-w-[260px]"
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
                {options.map((opt) => {
                  const selected = value.includes(opt.value);
                  return (
                    <CommandItem
                      key={opt.value}
                      value={`${opt.label} ${opt.hint ?? ""} ${opt.value}`}
                      onSelect={() => toggle(opt.value)}
                    >
                      <Check className={cn("mr-2 h-4 w-4", selected ? "opacity-100" : "opacity-0")} />
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">{opt.label}</span>
                        {opt.hint && (
                          <span className="truncate text-xs text-muted-foreground">{opt.hint}</span>
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
