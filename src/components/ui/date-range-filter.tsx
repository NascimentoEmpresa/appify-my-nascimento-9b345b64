import * as React from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// SIS-2026-0285 (Iury): filtro de período em duas caixas de texto "Data de" /
// "Data até" era ruim de usar — vira um combobox só, com popover de
// calendário de RANGE (escolhe início e fim clicando nos dois dias, sem
// abrir/fechar dois campos separados) + atalho "Hoje".
function paraISO(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function deISO(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

interface DateRangeFilterProps {
  label?: string;
  de: string;
  ate: string;
  onChange: (de: string, ate: string) => void;
  className?: string;
  triggerClassName?: string;
}

export function DateRangeFilter({ label, de, ate, onChange, className, triggerClassName }: DateRangeFilterProps) {
  const [open, setOpen] = React.useState(false);
  const range: DateRange | undefined = React.useMemo(() => {
    const from = deISO(de);
    const to = deISO(ate);
    if (!from && !to) return undefined;
    return { from, to };
  }, [de, ate]);

  const texto = de && ate
    ? de === ate
      ? format(deISO(de)!, "dd/MM/yy")
      : `${format(deISO(de)!, "dd/MM/yy")} - ${format(deISO(ate)!, "dd/MM/yy")}`
    : de
    ? `A partir de ${format(deISO(de)!, "dd/MM/yy")}`
    : ate
    ? `Até ${format(deISO(ate)!, "dd/MM/yy")}`
    : "Todo o período";

  function aplicarHoje() {
    const hoje = paraISO(new Date());
    onChange(hoje, hoje);
    setOpen(false);
  }

  function limpar() {
    onChange("", "");
    setOpen(false);
  }

  return (
    <div className={cn("space-y-1", className)}>
      {label && <Label className="text-xs">{label}</Label>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "h-8 w-full justify-start gap-1.5 px-2 text-xs font-normal",
              !de && !ate && "text-muted-foreground",
              triggerClassName
            )}
          >
            <CalendarIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
            <span className="truncate">{texto}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="flex items-center justify-between gap-2 border-b p-2">
            <Button type="button" size="sm" variant="secondary" className="h-7 text-xs" onClick={aplicarHoje}>
              Hoje
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={limpar}>
              Limpar
            </Button>
          </div>
          <Calendar
            mode="range"
            selected={range}
            onSelect={(r) => onChange(r?.from ? paraISO(r.from) : "", r?.to ? paraISO(r.to) : "")}
            defaultMonth={range?.from ?? new Date()}
            numberOfMonths={2}
            locale={ptBR}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
