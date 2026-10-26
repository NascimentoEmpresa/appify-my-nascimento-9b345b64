import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TIPOS_NOTA } from "@/hooks/useNfEmissao";

// Filtro "Código" (tipo da nota) das telas de faturamento da Controladoria: Lucratividade de Contratos, Faturamento da Empresa e
// Fechamento da Empresa. Padrão "N" (Normal), que é o que sempre contou; os outros códigos (Repactuação, Materiais, Diárias e horas
// extras) podem ser vistos à parte, ou todos juntos. É o mesmo "Código" do Relatório de Serviços.
export const CODIGO_PADRAO = "N";
export const CODIGO_TODOS = "todos";

export function codigosDoFiltro(valor: string): string[] {
  return valor === CODIGO_TODOS ? Object.keys(TIPOS_NOTA) : [valor];
}

export function FiltroCodigoNota({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  return (
    <Select value={valor} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-[170px] text-xs" title="Código da nota (tipo): só as notas deste código entram no faturamento">
        <SelectValue placeholder="Código" />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(TIPOS_NOTA).map(([k, label]) => <SelectItem key={k} value={k}>Código {k} — {label}</SelectItem>)}
        <SelectItem value={CODIGO_TODOS}>Todos os códigos</SelectItem>
      </SelectContent>
    </Select>
  );
}
