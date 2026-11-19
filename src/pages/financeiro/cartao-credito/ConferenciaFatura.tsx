import { useState } from "react";
import { Check, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { useSalvarValorFatura } from "@/hooks/useCartaoFaturaConsolidada";
import { compararFatura, textoConferenciaFatura } from "./faturaConsolidada";

// [SEM-CHAMADO] 19/11/2026: a conferência "soma dos itens × valor do boleto" (SIS-2026-0632, até então só no Fluxo e no card de
// faturas consolidadas) também na lista de competências do cartão e no Classificar Lançamentos. Ver textoConferenciaFatura.
// Sem o valor do boleto não há com o que comparar — o selo fica âmbar ("valor da fatura não informado") para virar passo do
// fechamento, e quem tem 'alterar' em Cartão de Crédito informa ali mesmo (mesma gravação do card de faturas consolidadas).
// Não bloqueia nada: a fatura classificada continua indo para o Fluxo com ou sem o valor informado.

const CLASSES = {
  sem_valor: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  confere: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  divergente: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
} as const;

/** Selo só de leitura (cabe dentro de um botão, como o gatilho do accordion). */
export function SeloConferenciaFatura({ soma, valorInformado }: { soma: number; valorInformado: number | null | undefined }) {
  const cmp = compararFatura(soma, valorInformado);
  return <Badge className={`font-normal ${CLASSES[cmp.status]}`}>{textoConferenciaFatura(cmp, valorInformado, formatBRL)}</Badge>;
}

/** Selo + "Informar/Corrigir valor da fatura" (para quem pode alterar). */
export function ConferenciaFatura({
  cartaoId,
  competencia,
  soma,
  valorInformado,
  podeAlterar,
}: {
  cartaoId: string;
  competencia: string; // yyyy-mm-01 (ou yyyy-mm)
  soma: number;
  valorInformado: number | null | undefined;
  podeAlterar: boolean;
}) {
  const salvar = useSalvarValorFatura();
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState(valorInformado != null ? String(valorInformado) : "");
  const faturaMes = competencia.length === 7 ? `${competencia}-01` : competencia.slice(0, 10);

  async function gravar() {
    try {
      await salvar.mutateAsync({ cartaoId, faturaMes, valor: valor === "" ? null : Number(valor) });
      toast.success("Valor da fatura salvo.");
      setAberto(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar o valor da fatura.");
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <SeloConferenciaFatura soma={soma} valorInformado={valorInformado} />
      {podeAlterar && (
        <Popover
          open={aberto}
          onOpenChange={(o) => {
            setAberto(o);
            if (o) setValor(valorInformado != null ? String(valorInformado) : "");
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
              <Pencil className="h-3 w-3" /> {valorInformado == null ? "Informar valor da fatura" : "Corrigir"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 space-y-2" align="start">
            <p className="text-xs text-muted-foreground">Valor do boleto da fatura (o que o banco cobra). Os itens somam {formatBRL(soma)}.</p>
            <div className="flex items-center gap-1">
              <CurrencyInput className="h-8" value={valor} onChange={setValor} placeholder="Valor da fatura" />
              <Button size="icon" className="h-8 w-8 shrink-0" title="Salvar" onClick={gravar} disabled={salvar.isPending}>
                <Check className="h-4 w-4" />
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}
