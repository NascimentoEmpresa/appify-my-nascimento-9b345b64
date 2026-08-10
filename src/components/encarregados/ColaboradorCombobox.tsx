import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown, Loader2, Search, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

const sb = supabase as any;

export interface Colaborador {
  empregado_id: number;
  nome: string;
  matricula: string | null;
  contrato_nome: string | null;
  do_meu_contrato: boolean;
}

/**
 * Escolha do colaborador que vai receber o material.
 *
 * Existe para o encarregado NÃO digitar: digitando, saem nomes truncados e
 * matrículas inventadas, que é justamente o que o gerente de sistemas pediu
 * para acabar.
 *
 * A busca é no SERVIDOR (`sup_ext_colaboradores`), não aqui. São 2.411
 * pessoas na ativa: `searchable-select.tsx` não serve porque filtra sobre uma
 * lista já carregada, e mandar 2.411 opções para o navegador é o que trava a
 * tela — a consulta em si é barata. Cada busca volta no máximo 20 linhas.
 *
 * Sem termo digitado, mostra só quem é do contrato do encarregado; é o caso
 * comum e evita uma busca vazia sobre a folha inteira.
 */
export function ColaboradorCombobox({
  valor, onEscolher, contratoId, disabled,
}: {
  valor: Colaborador | null;
  onEscolher: (c: Colaborador | null) => void;
  contratoId: string | null;
  disabled?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [busca, setBusca] = useState("");

  // Debounce: sem isso cada tecla vira uma ida ao banco.
  useEffect(() => {
    const t = setTimeout(() => setBusca(texto.trim()), 300);
    return () => clearTimeout(t);
  }, [texto]);

  const { data: opcoes = [], isFetching } = useQuery({
    queryKey: ["sup_colaboradores", busca, contratoId],
    enabled: aberto && (busca.length >= 2 || !!contratoId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Colaborador[]> => {
      const { data, error } = await sb.rpc("sup_ext_colaboradores", {
        p_busca: busca.length >= 2 ? busca : null,
        p_contrato_id: contratoId,
        p_limite: 20,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const doContrato = opcoes.filter((o) => o.do_meu_contrato);
  const outros = opcoes.filter((o) => !o.do_meu_contrato);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          type="button" variant="outline" role="combobox" disabled={disabled}
          className="mt-1 h-auto min-h-10 w-full justify-between px-3 py-2 text-left font-normal"
        >
          {valor ? (
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{valor.nome}</span>
              <span className="text-xs text-muted-foreground">
                Matrícula {valor.matricula ?? "—"}
                {valor.contrato_nome ? ` · ${valor.contrato_nome}` : ""}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">Buscar colaborador…</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        {/* shouldFilter=false: quem filtra é o banco. Deixar o cmdk filtrar de
            novo esconderia resultados legítimos que ele não sabe casar. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Digite o nome…"
            value={texto}
            onValueChange={setTexto}
          />
          <CommandList>
            {isFetching && (
              <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
              </div>
            )}

            {!isFetching && opcoes.length === 0 && (
              <CommandEmpty>
                <div className="flex flex-col items-center gap-1 px-3 py-6 text-center">
                  <Search className="h-6 w-6 text-muted-foreground/50" />
                  {busca.length < 2 ? (
                    <>
                      <p className="text-sm font-medium">Digite ao menos 2 letras do nome</p>
                      <p className="text-xs text-muted-foreground">
                        A busca cobre todos os colaboradores da empresa.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium">Ninguém encontrado para "{busca}"</p>
                      <p className="text-xs text-muted-foreground">
                        Se a pessoa acabou de ser admitida, marque "É admissão" e digite o nome.
                      </p>
                    </>
                  )}
                </div>
              </CommandEmpty>
            )}

            {doContrato.length > 0 && (
              <CommandGroup heading="Do seu contrato">
                {doContrato.map((c) => (
                  <Linha key={c.empregado_id} c={c} valor={valor}
                         onEscolher={(x) => { onEscolher(x); setAberto(false); }} />
                ))}
              </CommandGroup>
            )}
            {outros.length > 0 && (
              <CommandGroup heading="Outros contratos">
                {outros.map((c) => (
                  <Linha key={c.empregado_id} c={c} valor={valor}
                         onEscolher={(x) => { onEscolher(x); setAberto(false); }} />
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Linha({
  c, valor, onEscolher,
}: { c: Colaborador; valor: Colaborador | null; onEscolher: (c: Colaborador) => void }) {
  return (
    <CommandItem value={String(c.empregado_id)} onSelect={() => onEscolher(c)}>
      <UserRound className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{c.nome}</span>
        <span className="text-xs text-muted-foreground">
          Matrícula {c.matricula ?? "—"}
          {c.contrato_nome ? ` · ${c.contrato_nome}` : ""}
        </span>
      </span>
      <Check className={cn("ml-2 h-4 w-4 shrink-0",
        valor?.empregado_id === c.empregado_id ? "opacity-100" : "opacity-0")} />
    </CommandItem>
  );
}
