import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { AlertTriangle, Info } from "lucide-react";
import { useIntegrantesFluxo, type FluxoCaixaMaloteLinha } from "@/hooks/useFluxoCaixaMalote";

// Campo "Integrante" dentro do diálogo de edição (lápis) do Fluxo de Caixa. Como o Contrato, a troca grava na ORIGEM
// (RPC fluxo_caixa_trocar_integrante → linha de rateio da despesa do Malote, com histórico na despesa); os demais campos só ajustam a cópia do Fluxo.
// A mesma regra da alteração em massa (planejarTrocaDeIntegrante): só despesa do Malote, fora de fatura de cartão, com UMA linha de rateio.
type LinhaFluxo = FluxoCaixaMaloteLinha & { qtdLinhasRateio?: number };

export function IntegranteTrocaCampo({ linha, novoId, onNovoId }: { linha: LinhaFluxo; novoId: string; onNovoId: (id: string) => void }) {
  const ehMalote = linha.origem === "malote" && !linha.fatura_cartao_id;
  const qtd = linha.qtdLinhasRateio ?? 1;
  const editavel = ehMalote && qtd === 1;
  const { data: integrantes = [] } = useIntegrantesFluxo(editavel);
  const opcoes = useMemo(
    () => integrantes.filter((i) => i.id !== linha.integrante_empregado_id).map((i) => ({ value: String(i.id), label: i.nome })),
    [integrantes, linha.integrante_empregado_id],
  );

  if (!ehMalote) {
    return (
      <div className="flex gap-2 rounded-md border border-sky-200 bg-sky-50 p-2.5 text-xs text-sky-900">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          {linha.fatura_cartao_id
            ? "Fatura de cartão: o integrante é de cada despesa, no Malote."
            : "Só despesa do Malote tem integrante."}
        </span>
      </div>
    );
  }

  if (!editavel) {
    return (
      <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          {qtd > 1
            ? "Integrante: esta despesa é rateada em várias linhas. Ajuste o integrante de cada linha na grade de rateio, no Malote."
            : "Integrante: esta despesa não tem linha de rateio. Ajuste direto no Malote."}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <Label className="text-xs">
        Integrante <span className="text-muted-foreground">— atual: {linha.integrante_nome ?? "sem integrante"}</span>
      </Label>
      <SearchableSelect
        value={novoId || null}
        onChange={onNovoId}
        options={opcoes}
        placeholder="Manter o integrante atual"
        searchPlaceholder="Buscar colaborador..."
        className="w-full"
        triggerClassName="h-9 bg-background text-sm"
      />
      <p className="text-[11px] text-muted-foreground">
        Como o contrato, a troca <strong>muda a despesa de origem</strong> (linha de rateio no Malote), sem mexer em valor, centro de custo, classificação nem fornecedor, e fica registrada no histórico da despesa.
        {linha.numero_parcela != null && " Despesa parcelada: vale para todas as parcelas."}
      </p>
    </div>
  );
}
