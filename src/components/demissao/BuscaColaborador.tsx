import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { AlertTriangle, Check, ChevronsUpDown, Loader2, Search, UserRound } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { dataParaIso, nomeContratoDe } from "@/lib/rh/colaboradoresUtils";

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
  /**
   * O contrato: "1109 - POLICIA CIVIL RS LIMPEZA 066.2026" — a FILIAL do
   * Senior com o código na frente (nomeContratoDe). Não é a "Descrição do
   * Local": essa é o posto, e até 11/09/2026 a tela gravava ela como
   * contrato ("1109 - PALÁCIO DA POLÍCIA" num pedido cujo contrato era a
   * Polícia Civil inteira).
   */
  contrato: string;
  /** Coluna "Descrição do Local" da EMPREGADOS — o POSTO do organograma. */
  descricaoLocal: string;
  escala: string;
  /** EMPREGADOS."Setor_ERP" (caixa alta) — pra puxar o setor do escritório sozinho. */
  setor: string;
  admissao: string | null;
  email: string;
  telefone: string;
  /** EMPREGADOS."Situação" ("Trabalhando", "Atestado (dias)", "Férias"…). */
  situacao: string;
}

// Recorte leve para a LISTA. O cadastro completo só é buscado quando a pessoa
// é escolhida — trazer tudo de 50 resultados a cada tecla é o que trava a tela.
const COLS_LISTA = '"ID","Nome","CPF","Título do Cargo","Nome Filial","Situação"';

const texto = (v: unknown) => String(v ?? "").trim();

/** Afastado = não está Trabalhando e não saiu da empresa (atestado, férias, licença, auxílio…). */
export const estaAfastado = (situacao: string | null | undefined) => {
  const s = texto(situacao);
  return !!s && !/^trabalhando$/i.test(s) && !/demit|deslig|rescis|aposent/i.test(s);
};

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

/** Uma linha de EMPREGADOS no formato que a tela de demissão consome. */
export function montarEmpregadoEscolhido(e: Record<string, any>): EmpregadoEscolhido {
  return {
    id: Number(e["ID"]),
    nome: texto(e["Nome"]),
    cpf: texto(e["CPF"]),
    cargo: primeiroCampo(e, "Título do Cargo", "Nome do Cargo", "Cargo"),
    posto: primeiroCampo(e, "Organograma", "Descrição do Local", "Titulo C.Custo", "Nome Filial"),
    filial: texto(e["Filial"]),
    nomeFilial: texto(e["Nome Filial"]),
    contrato: nomeContratoDe(e),
    descricaoLocal: texto(e["Descrição do Local"]),
    escala: primeiroCampo(e, "Escala", "Escala de Trabalho"),
    setor: texto(e["Setor_ERP"]),
    // Já em ISO: vai direto pra coluna `date` (Demissão e Mudança de Função).
    admissao: dataParaIso(e["Admissão"]),
    email: primeiroCampo(e, "email", "E-mail", "Email"),
    telefone: primeiroCampo(e, "Telefone", "Celular", "Fone"),
    situacao: texto(e["Situação"]),
  };
}

/**
 * Carrega alguém pelo ID de EMPREGADOS — para a tela abrir já com a pessoa
 * escolhida (`?colaborador=ID`, vindo da vaga de Substituição).
 */
export async function carregarEmpregadoEscolhido(id: number): Promise<EmpregadoEscolhido | null> {
  const { data } = await sb.from("EMPREGADOS").select("*").eq("ID", id).maybeSingle();
  return data ? montarEmpregadoEscolhido(data) : null;
}

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
  valor, onEscolher, disabled, permitirAfastados = false,
}: {
  valor: EmpregadoEscolhido | null;
  onEscolher: (e: EmpregadoEscolhido | null) => void;
  disabled?: boolean;
  /**
   * "[ ] Listar afastados" embaixo da busca (20/10/2026, Solicitar Demissão):
   * marcado, a busca traz também quem está afastado (atestado, férias,
   * licença, auxílio…) — nunca desligado — e escolher um afastado pede
   * confirmação mostrando a situação.
   */
  permitirAfastados?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [digitado, setDigitado] = useState("");
  const [busca, setBusca] = useState("");
  const [opcoes, setOpcoes] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [comAfastados, setComAfastados] = useState(false);
  // Afastado escolhido esperando o "tem certeza?".
  const [confirmar, setConfirmar] = useState<EmpregadoEscolhido | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setBusca(digitado.trim()), 300);
    return () => clearTimeout(t);
  }, [digitado]);

  useEffect(() => {
    if (!aberto || busca.length < 2) { setOpcoes([]); return; }
    let valeu = true;                       // descarta resposta de busca antiga
    setCarregando(true);
    (async () => {
      let q = sb.from("EMPREGADOS").select(COLS_LISTA).ilike("Nome", `%${busca}%`);
      // Afastados: tudo que não é desligado. Situação vazia fica de fora
      // (cadastro sem situação não é "afastado", é dado faltando).
      q = permitirAfastados && comAfastados
        ? q.not("Situação", "is", null)
            .not("Situação", "ilike", "%demit%").not("Situação", "ilike", "%deslig%")
            .not("Situação", "ilike", "%rescis%").not("Situação", "ilike", "%aposent%")
        : q.eq("Situação", "Trabalhando");
      const { data } = await q.order("Nome").limit(50);
      if (!valeu) return;
      setOpcoes(data ?? []);
      setCarregando(false);
    })();
    return () => { valeu = false; };
  }, [aberto, busca, comAfastados, permitirAfastados]);

  const escolher = async (linha: any) => {
    setAberto(false);
    // Cadastro completo da pessoa escolhida: é dele que saem posto, escala,
    // admissão e contato, que a tela mostra travados.
    const { data } = await sb.from("EMPREGADOS").select("*").eq("ID", linha.ID).maybeSingle();
    const e = montarEmpregadoEscolhido(data ?? linha);
    if (estaAfastado(e.situacao)) { setConfirmar(e); return; }
    onEscolher(e);
  };

  return (
    <>
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          type="button" variant="outline" role="combobox" disabled={disabled}
          className="mt-1 h-auto min-h-10 w-full justify-between px-3 py-2 text-left font-normal"
        >
          {valor ? (
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium">{valor.nome}</span>
                {estaAfastado(valor.situacao) && (
                  <span className="shrink-0 rounded border border-warning/40 bg-warning/10 px-1.5 py-px text-[10px] font-semibold text-warning">
                    Afastado · {valor.situacao}
                  </span>
                )}
              </span>
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
          {permitirAfastados && (
            <label className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/40">
              <Checkbox checked={comAfastados} onCheckedChange={(v) => setComAfastados(v === true)} className="h-3.5 w-3.5" />
              Listar afastados <span className="text-[11px]">(atestado, férias, licença…)</span>
            </label>
          )}
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
                      <p className="text-xs text-muted-foreground">
                        {comAfastados
                          ? "A busca cobre quem está trabalhando e os afastados."
                          : permitirAfastados ? "A busca cobre quem está trabalhando — marque “Listar afastados” para incluir os afastados." : "A busca cobre quem está trabalhando."}
                      </p>
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
                      <span className="flex items-center gap-2">
                        <span className="truncate">{o.Nome}</span>
                        {estaAfastado(o["Situação"]) && (
                          <span className="shrink-0 rounded border border-warning/40 bg-warning/10 px-1.5 py-px text-[10px] font-semibold text-warning">
                            {texto(o["Situação"])}
                          </span>
                        )}
                      </span>
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

    <AlertDialog open={!!confirmar} onOpenChange={(v) => { if (!v) setConfirmar(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" /> Colaborador afastado
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p><b className="text-foreground">{confirmar?.nome}</b>{confirmar?.cargo ? ` · ${confirmar.cargo}` : ""}</p>
              <p>
                Situação: <span className="rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-xs font-semibold text-warning">{confirmar?.situacao}</span>
              </p>
              <p>Esse usuário está afastado. Tem certeza que deseja continuar?</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => { if (confirmar) onEscolher(confirmar); setConfirmar(null); }}>
            Sim, continuar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
