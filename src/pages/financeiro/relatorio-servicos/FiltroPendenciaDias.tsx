import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// SIS-2026-0690: o botão "Pendente há mais de 30 dias" virou um filtro com faixas. A opção vale "acima do limite", então 60 já traz as de 90 e 120.
export const LIMITES_PENDENCIA_DIAS = [30, 60, 90, 120] as const;

export const rotuloPendencia = (dias: number) => `Pendente há mais de ${dias} dias`;

interface Props {
  valor: number | null;
  onChange: (dias: number | null) => void;
}

export function FiltroPendenciaDias({ valor, onChange }: Props) {
  const ativo = valor !== null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "h-8 px-2.5 rounded-md border font-medium transition-colors inline-flex items-center gap-1.5",
            ativo ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:border-primary/50",
          )}
        >
          {rotuloPendencia(valor ?? LIMITES_PENDENCIA_DIAS[0])}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {LIMITES_PENDENCIA_DIAS.map((dias) => (
          // Clicar na opção já marcada desliga o filtro, como o botão de antes.
          <DropdownMenuItem key={dias} onSelect={() => onChange(valor === dias ? null : dias)} className="gap-2">
            <Check className={cn("h-3.5 w-3.5", valor === dias ? "opacity-100" : "opacity-0")} />
            {rotuloPendencia(dias)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
