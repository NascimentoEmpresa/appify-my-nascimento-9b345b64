// Seletor com barra de pesquisa para listas longas (19/11/2026 — pedido do
// Pablo: o contrato do "Solicitar Vaga" era um <select> nativo com dezenas de
// contratos e não dava para digitar "UFFS" ou "1074").
//
// O gatilho recebe a MESMA classe do campo ao redor (`classeGatilho`), para o
// formulário continuar com a mesma cara dos outros campos. A busca ignora
// acento e caixa — "goncalves" acha "BENTO GONÇALVES" — e casa por pedaços
// ("uffs 041" acha "1074 - UFFS REALEZA - 041/2021").
//
// z-index alto no popover: os modais de vaga (`nvg-modal-ov`, `ini-modal-ov`)
// ficam em z-index 700, e o popover do shadcn nasce em z-50 — sem isso a lista
// abriria ATRÁS do modal.

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Todos os pedaços digitados têm que aparecer no rótulo, em qualquer ordem. */
function filtroSemAcento(valor: string, busca: string): number {
  const alvo = normalizar(valor);
  const pedacos = normalizar(busca).split(/\s+/).filter(Boolean);
  return pedacos.every(p => alvo.includes(p)) ? 1 : 0;
}

interface Props {
  opcoes: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  placeholderBusca?: string;
  textoVazio?: string;
  disabled?: boolean;
  classeGatilho?: string;
}

export function SelectComBusca({
  opcoes, value, onChange,
  placeholder = "— Selecione —",
  placeholderBusca = "Digite para pesquisar…",
  textoVazio = "Nada encontrado.",
  disabled, classeGatilho,
}: Props) {
  const [aberto, setAberto] = useState(false);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={aberto}
          disabled={disabled}
          className={cn(classeGatilho, "flex items-center justify-between gap-2 text-left")}
        >
          <span className={cn("truncate", !value && "text-slate-500")}>{value || placeholder}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="z-[1000] p-0 w-[var(--radix-popover-trigger-width)] min-w-[260px]"
      >
        <Command filter={filtroSemAcento}>
          <CommandInput placeholder={placeholderBusca} />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>{textoVazio}</CommandEmpty>
            <CommandGroup>
              {opcoes.map((o, i) => (
                <CommandItem key={`${i}-${o}`} value={o} onSelect={() => { onChange(o); setAberto(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === o ? "opacity-100" : "opacity-0")} />
                  {o}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
