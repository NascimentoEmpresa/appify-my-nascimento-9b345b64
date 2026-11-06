import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDefinirCentroCustoEmMassa } from "@/hooks/useAplicacaoFinanceira";
import { CentroCustoSelect } from "./CentroCustoSelect";

// SIS-2026-0813: alteração em massa na Aplicação Financeira. A barra aparece só quando há lançamentos marcados, num cartão único: quantos estão
// marcados, "Limpar seleção" e os grupos de ação (Banco, Centro de custo) lado a lado.

export function BarraSelecaoEmMassa({ quantidade, onLimpar, children }: { quantidade: number; onLimpar: () => void; children: ReactNode }) {
  if (quantidade === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs dark:border-sky-900 dark:bg-sky-950/20">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-sky-600 px-2 py-0.5 text-[11px] font-semibold text-white">{quantidade}</span>
        <span className="font-medium">selecionado{quantidade === 1 ? "" : "s"}</span>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={onLimpar}>Limpar</Button>
      </div>
      <span className="hidden h-5 w-px bg-sky-200 sm:block dark:bg-sky-900" aria-hidden />
      {children}
    </div>
  );
}

export interface ItemEmMassa {
  id: string;
  empresa_id: string;
}

// Grupo "Centro de custo": o botão aplica o MOVIMENTAÇÃO FINANCEIRA da empresa de CADA lançamento (serve com empresas misturadas); para escolher
// outro contrato, a seleção tem que ser de uma empresa só.
export function CentroCustoEmMassaBar({ tipo, itens, onFeito }: { tipo: "aplicacao" | "resgate"; itens: ItemEmMassa[]; onFeito: () => void }) {
  const definir = useDefinirCentroCustoEmMassa();
  const [contratoId, setContratoId] = useState("");
  const empresas = [...new Set(itens.map((i) => i.empresa_id))];

  async function aplicar(contrato: string | null) {
    try {
      const qtd = await definir.mutateAsync({ tipo, ids: itens.map((i) => i.id), contratoId: contrato });
      if (qtd === 0) toast.info("Nada mudou: os lançamentos marcados já estavam com esse centro de custo (ou a empresa não tem o contrato MOVIMENTAÇÃO FINANCEIRA).");
      else toast.success(`Centro de custo definido em ${qtd} ${tipo === "aplicacao" ? (qtd === 1 ? "aplicação" : "aplicações") : qtd === 1 ? "resgate" : "resgates"}.`);
      setContratoId("");
      onFeito();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível definir o centro de custo.");
    }
  }

  if (itens.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium">Centro de custo</span>
      <Button type="button" size="sm" className="h-7 text-xs" disabled={definir.isPending} onClick={() => void aplicar(null)}
        title="Aplica o contrato MOVIMENTAÇÃO FINANCEIRA da empresa de cada lançamento marcado">
        {definir.isPending ? "Aplicando…" : "Aplicar MOVIMENTAÇÃO FINANCEIRA"}
      </Button>
      {empresas.length === 1 && (
        <>
          <span className="text-muted-foreground">ou</span>
          <CentroCustoSelect compacto empresaId={empresas[0]} value={contratoId} onChange={setContratoId} />
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={!contratoId || definir.isPending} onClick={() => void aplicar(contratoId)}>
            Definir
          </Button>
        </>
      )}
    </div>
  );
}
