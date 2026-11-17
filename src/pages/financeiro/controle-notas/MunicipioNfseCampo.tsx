import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useIBGEMunicipios } from "@/hooks/useIBGEMunicipios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

const normalizar = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function MunicipioNfseCampo({ titulo, codigo, alterar }: { titulo: string; codigo: string; alterar: (v: string) => void }) {
  const { municipios, isLoading, erro, recarregar } = useIBGEMunicipios();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const selecionado = municipios.find(m => m.id === codigo);
  const encontrados = useMemo(() => {
    const termos = normalizar(busca).split(/\s+/);
    return municipios.filter(m => termos.every(t => normalizar(`${m.nome} ${m.uf} ${m.id}`).includes(t))).slice(0, 40);
  }, [municipios, busca]);
  return <div className="grid gap-2 text-sm">
    <span>{titulo}</span>
    <Popover open={aberto} onOpenChange={v => { setAberto(v); setBusca(""); }}>
      <PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-label={`Buscar cidade: ${titulo}`} aria-expanded={aberto} className="justify-between font-normal">
        <span className="truncate">{selecionado ? `${selecionado.nome} / ${selecionado.uf}` : "Buscar pelo nome da cidade"}</span><ChevronsUpDown className="ml-2 h-4 w-4 shrink-0" />
      </Button></PopoverTrigger>
      <PopoverContent className="w-[min(90vw,380px)] p-0" align="start"><Command shouldFilter={false}>
        <CommandInput aria-label={`Nome da cidade: ${titulo}`} placeholder="Digite cidade, UF ou código IBGE" value={busca} onValueChange={setBusca} />
        <CommandList>
          {isLoading && <p role="status" className="p-3 text-sm">Carregando municípios...</p>}
          {erro && <div role="alert" className="p-3 text-sm">Não foi possível carregar as cidades. Informe o código abaixo ou <Button type="button" variant="link" onClick={recarregar}>Tentar novamente</Button>.</div>}
          {!isLoading && !erro && encontrados.length === 0 && <p className="p-3 text-sm">Nenhuma cidade encontrada.</p>}
          {encontrados.map(m => <CommandItem key={m.id} value={m.id} onSelect={() => { alterar(m.id); setAberto(false); }}>
            <Check className={`mr-2 h-4 w-4 ${m.id === codigo ? "opacity-100" : "opacity-0"}`} />{m.nome} / {m.uf} — {m.id}
          </CommandItem>)}
          {encontrados.length === 40 && <p className="p-3 text-xs text-muted-foreground">Digite mais letras ou a UF para refinar a busca.</p>}
        </CommandList>
      </Command></PopoverContent>
    </Popover>
    <Label className="grid gap-1 font-normal">{titulo} — código IBGE<Input required value={codigo} inputMode="numeric" maxLength={7} onChange={e => alterar(e.target.value.replace(/\D/g, ""))} /></Label>
  </div>;
}
