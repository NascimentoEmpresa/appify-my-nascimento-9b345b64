import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { alternarContrato, alternarEmpresa, resumoContratos, type ContratoOpcao, type EmpresaOpcao } from "./regras";

// SIS-2026-0858: "Centro de custo de onde sai" — um ou mais contratos, agrupados por empresa, com "selecionar todos da empresa" e a seleção de
// contratos individuais (regra 3 do HTML do Iury).
export function SeletorContratos({
  empresas, contratos, value, onChange, disabled, className,
}: {
  empresas: EmpresaOpcao[];
  contratos: ContratoOpcao[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const resumo = useMemo(() => resumoContratos(empresas, contratos, value), [empresas, contratos, value]);
  const marcados = useMemo(() => new Set(value), [value]);
  const t = busca.trim().toLocaleLowerCase("pt-BR");

  const grupos = useMemo(
    () => empresas.map((e) => {
      const todos = contratos.filter((c) => c.empresaId === e.id);
      const empresaCasa = !!t && e.nome.toLocaleLowerCase("pt-BR").includes(t);
      const visiveis = todos.filter((c) => !t || empresaCasa || c.nome.toLocaleLowerCase("pt-BR").includes(t));
      return { empresa: e, todos, visiveis };
    }).filter((g) => g.visiveis.length > 0),
    [empresas, contratos, t],
  );

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn("flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-left text-xs disabled:opacity-50", className)}
        >
          <span className={cn("line-clamp-2", !resumo && "text-muted-foreground")}>{resumo || "Selecionar contratos..."}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] p-3">
        <Input className="mb-2 h-8 text-xs" type="search" placeholder="Buscar empresa ou contrato..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {grupos.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">Nenhum contrato encontrado.</p>}
          {grupos.map(({ empresa, todos, visiveis }) => {
            const ids = todos.map((c) => c.id);
            const qtd = ids.filter((id) => marcados.has(id)).length;
            return (
              <div key={empresa.id} className="border-t pt-2 first:border-t-0 first:pt-0">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
                  <Checkbox
                    checked={qtd === ids.length ? true : qtd > 0 ? "indeterminate" : false}
                    onCheckedChange={(v) => onChange(alternarEmpresa(value, ids, v === true))}
                  />
                  {empresa.nome}
                  <span className="ml-auto text-[10px] font-normal text-muted-foreground">Selecionar todos da empresa</span>
                </label>
                {visiveis.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 py-1 pl-6 text-xs">
                    <Checkbox checked={marcados.has(c.id)} onCheckedChange={(v) => onChange(alternarContrato(value, c.id, v === true))} />
                    {c.nome}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
