// SIS-2026-0658: campos de filtro das telas de conciliação da origem dos dados.
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TODAS = "__todas__";

export function FiltroSelect({ rotulo, valor, onChange, opcoes }: {
  rotulo: string; valor: string; onChange: (v: string) => void; opcoes: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{rotulo}</Label>
      <Select value={valor || TODAS} onValueChange={(v) => onChange(v === TODAS ? "" : v)}>
        <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={TODAS}>Todas</SelectItem>
          {opcoes.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export function FiltroData({ rotulo, valor, onChange }: { rotulo: string; valor: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{rotulo}</Label>
      <Input type="date" className="h-9 text-xs" value={valor} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Opções únicas (id → nome) ordenadas por nome, para os selects. */
export function opcoesUnicas<L>(linhas: L[], id: (l: L) => string | null | undefined, nome: (l: L) => string | null | undefined) {
  const mapa = new Map<string, string>();
  for (const l of linhas) {
    const i = id(l);
    const n = nome(l);
    if (i && n && !mapa.has(i)) mapa.set(i, n);
  }
  return Array.from(mapa, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}
