import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useContratosERP } from "@/hooks/useContratosERP";
import { opcoesDeCentroCusto } from "./centroCusto";

// SIS-2026-0813: seletor do centro de custo (contrato) da empresa do lançamento. `compacto`: sem rótulo e sem aviso, para barras de ação.
const SEM = "_";

export function CentroCustoSelect({ empresaId, value, onChange, atualId, rotulo = "Centro de custo", compacto = false }: {
  empresaId: string;
  value: string;
  onChange: (id: string) => void;
  /** Contrato já gravado no lançamento (aparece mesmo se for de outra empresa ou encerrado). */
  atualId?: string | null;
  rotulo?: string;
  compacto?: boolean;
}) {
  const { data: contratos = [] } = useContratosERP({ todasEmpresas: true });
  const opcoes = useMemo(() => opcoesDeCentroCusto(contratos, empresaId, atualId), [contratos, empresaId, atualId]);

  const seletor = (
    <Select value={value || SEM} onValueChange={(v) => onChange(v === SEM ? "" : v)} disabled={!empresaId}>
      <SelectTrigger className={compacto ? "h-7 w-[230px] text-xs" : "h-9"}>
        <SelectValue placeholder={empresaId ? "Selecione…" : "Escolha a empresa primeiro"} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SEM}>{compacto ? "Escolher outro…" : "— (sem centro de custo)"}</SelectItem>
        {opcoes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
      </SelectContent>
    </Select>
  );
  if (compacto) return seletor;

  return (
    <div>
      <Label className="text-xs">{rotulo}</Label>
      {seletor}
      {!value && empresaId && <p className="mt-1 text-[11px] text-amber-700">Sem centro de custo o lançamento aparece como "—" no Fluxo de Caixa. O correto é MOVIMENTAÇÃO FINANCEIRA.</p>}
    </div>
  );
}
