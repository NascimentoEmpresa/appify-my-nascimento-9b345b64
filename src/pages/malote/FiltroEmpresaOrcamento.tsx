import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";

export const EMPRESA_FILTRO_TODAS = "todas" as const;
export type FiltroEmpresaValor = string | typeof EMPRESA_FILTRO_TODAS;

// SIS-2026-0337/0309 (Iury): "os users preferem filtrar dentro dos próprios
// módulos qual empresa eles querem visualizar" — depois de deixar as telas
// de Orçamento resolverem dados de TODAS as empresas que o usuário acessa
// (em vez de só a empresa ativa do seletor da barra superior, ver
// usePlanejamentosOrcamento/useOrcamentoContratos), esse filtro local é o
// que devolve pro usuário a capacidade de olhar uma empresa só quando
// quiser, sem depender do seletor global.
export function FiltroEmpresaOrcamento({
  value,
  onChange,
  label = "Empresa",
}: {
  value: FiltroEmpresaValor;
  onChange: (v: FiltroEmpresaValor) => void;
  label?: string;
}) {
  const { data: empresas = [] } = useEmpresasGrupo();
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as FiltroEmpresaValor)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={EMPRESA_FILTRO_TODAS}>Todas as empresas</SelectItem>
          {empresas.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
