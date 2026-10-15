import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useContratosAtivos } from "@/hooks/useMaloteDespesa";
import { useRatearLinhaImportada } from "@/hooks/useFluxoCaixaImportado";
import {
  cotasIniciais, cotasParaRpc, diferencaCotas, distribuirIgualmente, erroCotas, SEM_CONTRATO, somaCotas, type CotaRateio,
} from "./rateioImportado";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export interface LinhaParaRatear {
  despesa_id: string;
  id_malote: string;
  descricao: string;
  valor: number;
  contrato_id: string | null;
  rateioDetalhe?: { id: string; nome: string; valor: number }[];
}

interface Props {
  linha: LinhaParaRatear | null;
  /** true = rateio criado no ERP (dá para refazer ou desfazer); false = linha avulsa. */
  refazendo: boolean;
  onClose: () => void;
}

// Fluxo de Caixa: ratear uma linha importada da planilha entre contratos (cada cota vira uma linha do mesmo grupo).
export function RatearImportadoDialog({ linha, refazendo, onClose }: Props) {
  const { data: contratos = [] } = useContratosAtivos();
  const ratear = useRatearLinhaImportada();
  const [cotas, setCotas] = useState<CotaRateio[]>([]);

  useEffect(() => {
    if (linha) setCotas(cotasIniciais(linha.valor, linha.contrato_id, linha.rateioDetalhe, refazendo));
  }, [linha, refazendo]);

  const opcoes = useMemo(
    () => [
      { value: SEM_CONTRATO, label: "Sem contrato (administrativo)" },
      ...contratos.map((c) => ({ value: c.id, label: c.nome, muted: c.status !== "ativo" })),
    ],
    [contratos],
  );

  if (!linha) return null;
  const total = linha.valor;
  const erro = erroCotas(total, cotas, refazendo);
  const dif = diferencaCotas(total, cotas);
  const desfazendo = refazendo && cotas.length === 1;

  const mudar = (i: number, parcial: Partial<CotaRateio>) => setCotas((cs) => cs.map((c, j) => (j === i ? { ...c, ...parcial } : c)));
  const dividirIgualmente = () => {
    const partes = distribuirIgualmente(total, cotas.length);
    setCotas((cs) => cs.map((c, i) => ({ ...c, valor: String(partes[i]).replace(".", ",") })));
  };
  // 1 cota só (desfazer): o valor é sempre o total.
  const remover = (i: number) =>
    setCotas((cs) => {
      const resto = cs.filter((_, j) => j !== i);
      return resto.length === 1 ? [{ ...resto[0], valor: String(total).replace(".", ",") }] : resto;
    });

  async function confirmar() {
    if (erro) {
      toast.error(erro);
      return;
    }
    try {
      await ratear.mutateAsync({ despesaId: linha!.despesa_id, cotas: cotasParaRpc(cotas) });
      toast.success(desfazendo ? "Rateio desfeito." : refazendo ? "Rateio atualizado." : "Linha rateada.");
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao ratear.");
    }
  }

  return (
    <Dialog open={!!linha} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{refazendo ? "Refazer rateio" : "Ratear lançamento"} {linha.id_malote}</DialogTitle>
          <DialogDescription>
            {linha.descricao} — valor <span className="font-medium text-foreground">{brl(total)}</span>. Cada cota vira uma linha do mesmo lançamento,
            no contrato escolhido; a soma tem que fechar o valor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {cotas.map((c, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_140px_auto] items-center gap-2">
              <SearchableSelect value={c.contratoId} onChange={(v) => mudar(i, { contratoId: v })} options={opcoes} placeholder="Contrato" />
              <Input
                inputMode="decimal"
                value={c.valor}
                onChange={(e) => mudar(i, { valor: e.target.value })}
                placeholder="0,00"
                className="text-right"
                disabled={desfazendo}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => remover(i)}
                disabled={cotas.length <= (refazendo ? 1 : 2)}
                title="Remover cota"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setCotas((cs) => [...cs, { contratoId: "", valor: "" }])}>
                <Plus className="h-3.5 w-3.5" />Adicionar cota
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={dividirIgualmente} disabled={desfazendo}>Dividir igualmente</Button>
            </div>
            <p className={`text-xs ${Math.abs(dif) > 0.005 ? "text-destructive" : "text-muted-foreground"}`}>
              Soma {brl(somaCotas(cotas))} de {brl(total)}
              {Math.abs(dif) > 0.005 && <> — {dif > 0 ? "faltam" : "sobram"} {brl(Math.abs(dif))}</>}
            </p>
          </div>
          {desfazendo && (
            <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              Com 1 cota só, o rateio é desfeito e a linha volta a ser avulsa, no contrato escolhido.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={ratear.isPending}>Cancelar</Button>
          <Button onClick={() => void confirmar()} disabled={ratear.isPending || !!erro}>
            {ratear.isPending ? "Salvando…" : desfazendo ? "Desfazer rateio" : refazendo ? "Salvar rateio" : "Ratear"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
