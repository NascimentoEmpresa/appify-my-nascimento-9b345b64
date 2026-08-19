import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown, Loader2, Search, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

const sb = supabase as any;

/** O colaborador escolhido, com o cadastro inteiro junto. */
export interface EmpregadoEscolhido {
  id: number;
  nome: string;
  cpf: string;
  cargo: string;
  posto: string;
  filial: string;
  nomeFilial: string;
  escala: string;
  admissao: string | null;
  email: string;
  telefone: string;
}

// Recorte leve para a LISTA. O cadastro completo só é buscado quando a pessoa
// é escolhida — trazer tudo de 50 resultados a cada tecla é o que trava a tela.
const COLS_LISTA = '"ID","Nome","CPF","Título do Cargo","Nome Filial"';

const texto = (v: unknown) => String(v ?? "").trim();

/**
 * O primeiro campo que existir, na ordem pedida. A EMPREGADOS é espelho do
 * Senior e o nome da coluna varia entre ambientes (o mesmo motivo pelo qual
 * a tela de Colaboradores tenta vários recortes antes de desistir): pedir uma
 * coluna só faria o posto sumir em quem tem o nome antigo.
 */
const primeiroCampo = (linha: Record<string, any>, ...colunas: string[]) => {
  for (const c of colunas) {
    const v = texto(linha[c]);
    if (v) return v;
  }
  return "";
};

/**
 * Escolha do colaborador que vai ser desligado.
 *
 * O encarregado NÃO digita os dados: escolhe a pessoa e o cadastro preenche
 * posto, contrato e escala. É o que o pedido chama de "preenche sozinho e não
 * dá para trocar" — e é também o que garante que a demissão aponte para uma
 * matrícula de verdade, não para um nome parecido.
 *
 * A busca é no banco (ilike sobre EMPREGADOS, só quem está Trabalhando), com
 * debounce e teto de 50 linhas.
 */
export function BuscaColaborador({
  valor, onEscolher, disabled,
}: {
  valor: EmpregadoEscolhido | null;
  onEscolher: (e: EmpregadoEscolhido | null) => void;
  disabled?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [digitado, setDigitado] = useState("");
  const [busca, setBusca] = useState("");
  const [opcoes, setOpcoes] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBusca(digitado.trim()), 300);
    return () => clearTimeout(t);
  }, [digitado]);

  useEffect(() => {
    if (!aberto || busca.length < 2) { setOpcoes([]); return; }
    let valeu = true;                       // descarta resposta de busca antiga
    setCarregando(true);
    (async () => {
      const { data } = await sb.from("EMPREGADOS")
        .select(COLS_LISTA)
        .eq("Situação", "Trabalhando")
        .ilike("Nome", `%${busca}%`)
        .order("Nome")
        .limit(50);
      if (!valeu) return;
      setOpcoes(data ?? []);
      setCarregando(false);
    })();
    return () => { valeu = false; };
  }, [aberto, busca]);

  const escolher = async (linha: any) => {
    setAberto(false);
    // Cadastro completo da pessoa escolhida: é dele que saem posto, escala,
    // admissão e contato, que a tela mostra travados.
    const { data } = await sb.from("EMPREGADOS").select("*").eq("ID", linha.ID).maybeSingle();
    const e = data ?? linha;
    onEscolher({
      id: Number(e["ID"]),
      nome: texto(e["Nome"]),
      cpf: texto(e["CPF"]),
      cargo: primeiroCampo(e, "Título do Cargo", "Nome do Cargo", "Cargo"),
      posto: primeiroCampo(e, "Organograma", "Descrição do Local", "Titulo C.Custo", "Nome Filial"),
      filial: texto(e["Filial"]),
      nomeFilial: texto(e["Nome Filial"]),
      escala: primeiroCampo(e, "Escala", "Escala de Trabalho"),
      admissao: texto(e["Admissão"]) || null,
      email: primeiroCampo(e, "email", "E-mail", "Email"),
      telefone: primeiroCampo(e, "Telefone", "Celular", "Fone"),
    });
  };

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
                {valor.cargo || "Cargo não informado"}
                {valor.nomeFilial ? ` · ${valor.nomeFilial}` : ""}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">Buscar colaborador…</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        {/* shouldFilter=false: quem filtra é o banco; refiltrar aqui esconderia
            resultados legítimos que o cmdk não sabe casar. */}
        <Command shouldFilter={false}>
          <CommandInput placeholder="Digite o nome…" value={digitado} onValueChange={setDigitado} />
          <CommandList>
            {carregando && (
              <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
              </div>
            )}
            {!carregando && opcoes.length === 0 && (
              <CommandEmpty>
                <div className="flex flex-col items-center gap-1 px-3 py-6 text-center">
                  <Search className="h-6 w-6 text-muted-foreground/50" />
                  {busca.length < 2 ? (
                    <p className="text-sm font-medium">Digite ao menos 2 letras do nome</p>
                  ) : (
                    <>
                      <p className="text-sm font-medium">Ninguém encontrado para "{busca}"</p>
                      <p className="text-xs text-muted-foreground">A busca cobre quem está trabalhando.</p>
                    </>
                  )}
                </div>
              </CommandEmpty>
            )}
            {opcoes.length > 0 && (
              <CommandGroup heading="Colaboradores">
                {opcoes.map((o) => (
                  <CommandItem key={o.ID} value={String(o.ID)} onSelect={() => escolher(o)}>
                    <UserRound className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{o.Nome}</span>
                      <span className="text-xs text-muted-foreground">
                        {texto(o["Título do Cargo"]) || "Cargo não informado"}
                        {texto(o["Nome Filial"]) ? ` · ${o["Nome Filial"]}` : ""}
                      </span>
                    </span>
                    <Check className={cn("ml-2 h-4 w-4 shrink-0",
                      valor?.id === Number(o.ID) ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
