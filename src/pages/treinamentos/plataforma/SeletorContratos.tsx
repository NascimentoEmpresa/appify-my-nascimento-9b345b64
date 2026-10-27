import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Minus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { gruposDeContratos } from "@/lib/treinamentos/gruposContrato";

// Seletor múltiplo do "Acesso por contrato" (27/10/2026). Em cima vêm os
// grupos derivados do nome ("Todas UFRGS", "Todas Prefeituras"): marcar o
// grupo marca todos os contratos dele; grupo meio marcado mostra "—".
// Vazio = todos os contratos (é o padrão de quem nunca escolheu nada).
// Ocupa o lugar do antigo campo "Buscar contrato": a busca é a do popover.

type Contrato = { nome: string; alunos: number };

function Marca({ estado }: { estado: "sim" | "parte" | "nao" }) {
  return (
    <span className={cn(
      "mr-2 grid h-4 w-4 shrink-0 place-items-center rounded-sm border border-primary",
      estado === "nao" ? "opacity-50" : "bg-primary text-primary-foreground",
    )}>
      {estado === "sim" && <Check className="h-3 w-3" />}
      {estado === "parte" && <Minus className="h-3 w-3" />}
    </span>
  );
}

export function SeletorContratos({ contratos, value, onChange }: {
  contratos: Contrato[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const ordenados = useMemo(
    () => [...contratos].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true })),
    [contratos],
  );
  const grupos = useMemo(() => gruposDeContratos(contratos.map((c) => c.nome)), [contratos]);
  const sel = useMemo(() => new Set(value), [value]);

  const estadoGrupo = (nomes: string[]) => {
    const n = nomes.filter((x) => sel.has(x)).length;
    return n === 0 ? "nao" : n === nomes.length ? "sim" : "parte";
  };
  const alternaGrupo = (nomes: string[]) => {
    if (estadoGrupo(nomes) === "sim") onChange(value.filter((x) => !nomes.includes(x)));
    else onChange([...value, ...nomes.filter((x) => !sel.has(x))]);
  };
  const alterna = (nome: string) => onChange(sel.has(nome) ? value.filter((x) => x !== nome) : [...value, nome]);

  // Rótulo do botão: o grupo inteiro pelo nome quando a seleção é exatamente ele.
  const rotulo = (() => {
    if (value.length === 0) return "Buscar e selecionar contratos";
    const g = grupos.find((x) => x.nomes.length === value.length && estadoGrupo(x.nomes) === "sim");
    if (g) return `Todas ${g.rotulo}`;
    return value.length === 1 ? value[0] : `${value.length} contratos selecionados`;
  })();

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={aberto} className="h-9 w-full justify-between text-sm font-normal">
          <span className="flex min-w-0 items-center gap-2">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>{rotulo}</span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[300px] p-0" align="start">
        <Command filter={(v, busca) => (!busca || v.toLowerCase().includes(busca.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Buscar contrato ou grupo..." />
          <CommandList className="max-h-[360px]">
            <CommandEmpty>Nenhum contrato.</CommandEmpty>
            {grupos.length > 0 && (
              <CommandGroup heading="Grupos">
                {grupos.map((g) => (
                  <CommandItem key={g.chave} value={`grupo todas ${g.rotulo} ${g.chave}`} onSelect={() => alternaGrupo(g.nomes)}>
                    <Marca estado={estadoGrupo(g.nomes)} />
                    <span className="flex-1 truncate font-medium">Todas {g.rotulo}</span>
                    <span className="text-xs text-muted-foreground">{g.nomes.length}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandSeparator />
            <CommandGroup heading="Contratos">
              {ordenados.map((c) => (
                <CommandItem key={c.nome} value={c.nome} onSelect={() => alterna(c.nome)}>
                  <Marca estado={sel.has(c.nome) ? "sim" : "nao"} />
                  <span className="flex-1 truncate">{c.nome}</span>
                  <span className="text-xs text-muted-foreground">{c.alunos.toLocaleString("pt-BR")}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {value.length > 0 && (
            <div className="border-t p-1">
              <Button type="button" variant="ghost" size="sm" className="h-8 w-full text-xs" onClick={() => onChange([])}>
                Limpar seleção (voltar a todos)
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
