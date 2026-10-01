import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, Plus, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useClassificacoesOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useContratosAtivos } from "@/hooks/useMaloteDespesa";
import { RateioItemLinha, useRateioItemFatura, useSalvarRateioItem } from "@/hooks/useCartaoFaturaRateio";

const fmtBRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

interface RateioItemFaturaDialogProps {
  open: boolean;
  onClose: () => void;
  itemId: string | null;
  descricaoItem: string;
  valorItem: number;
}

export function RateioItemFaturaDialog({ open, onClose, itemId, descricaoItem, valorItem }: RateioItemFaturaDialogProps) {
  const { data: classificacoes = [] } = useClassificacoesOrcamento();
  const { data: contratos = [] } = useContratosAtivos();
  const { data: linhasExistentes } = useRateioItemFatura(itemId);
  const salvar = useSalvarRateioItem();

  const [ratearPor, setRatearPor] = useState<"percentual" | "valor">("valor");
  const [linhas, setLinhas] = useState<RateioItemLinha[]>([]);

  useEffect(() => {
    if (!open) return;
    setLinhas(
      linhasExistentes && linhasExistentes.length > 0
        ? linhasExistentes
        : [{ classificacao_id: "", contrato_id: null, percentual: null, valor: valorItem, ordem: 0 }],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, linhasExistentes]);

  const totalRateado = useMemo(() => linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0), [linhas]);
  const diferenca = valorItem - totalRateado;
  const bate = Math.abs(diferenca) <= 0.01;
  const todasClassificadas = linhas.every((l) => !!l.classificacao_id);
  const podeSalvar = bate && todasClassificadas;

  function atualizarLinha(idx: number, patch: Partial<RateioItemLinha>) {
    setLinhas((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function distribuirValorNaLinha(idx: number, valor: number) {
    const percentual = valorItem > 0 ? Number(((valor / valorItem) * 100).toFixed(3)) : 0;
    atualizarLinha(idx, { valor, percentual });
  }

  function distribuirPercentualNaLinha(idx: number, percentual: number) {
    const valor = Number(((valorItem * percentual) / 100).toFixed(2));
    atualizarLinha(idx, { valor, percentual });
  }

  function adicionarLinha() {
    setLinhas((prev) => [...prev, { classificacao_id: "", contrato_id: null, percentual: null, valor: 0, ordem: prev.length }]);
  }

  function removerLinha(idx: number) {
    setLinhas((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSalvar() {
    if (!podeSalvar) return;
    try {
      await salvar.mutateAsync({ itemId: itemId!, linhas });
      toast.success("Classificação salva.");
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar classificação.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Classificar item</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground -mt-2">
          {descricaoItem} — {fmtBRL(valorItem)}
        </p>

        <div className="flex justify-end">
          <div>
            <Label className="text-xs">Ratear por</Label>
            <Select value={ratearPor} onValueChange={(v) => setRatearPor(v as "percentual" | "valor")}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentual">Percentual (%)</SelectItem>
                <SelectItem value="valor">Valor (R$)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Classificação *</TableHead>
                <TableHead>Contrato (opcional)</TableHead>
                <TableHead>{ratearPor === "percentual" ? "% Rateio *" : "Valor (R$) *"}</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((linha, idx) => (
                <TableRow key={idx}>
                  <TableCell>
                    <Select value={linha.classificacao_id} onValueChange={(v) => atualizarLinha(idx, { classificacao_id: v })}>
                      <SelectTrigger className="h-8 w-44 text-xs">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        {classificacoes.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <SearchableSelect
                      value={linha.contrato_id ?? ""}
                      onChange={(v) => atualizarLinha(idx, { contrato_id: v || null })}
                      options={contratos.map((c) => ({ value: c.id, label: c.nome, muted: c.status === "encerrado" }))}
                      placeholder="Selecione..."
                      allowClear
                      className="w-48"
                      triggerClassName="h-8 text-xs"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      className="h-8 w-24 text-xs"
                      value={ratearPor === "percentual" ? linha.percentual ?? "" : linha.valor ?? ""}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 0;
                        if (ratearPor === "percentual") distribuirPercentualNaLinha(idx, v);
                        else distribuirValorNaLinha(idx, v);
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => removerLinha(idx)}
                      disabled={linhas.length === 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between gap-4">
          <Button type="button" variant="outline" size="sm" onClick={adicionarLinha} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Adicionar linha
          </Button>
          {/* [SEM-CHAMADO] (pedido do usuário): total mais visual (ícone +
              cor + quanto falta/excedeu), e o botão de Salvar abaixo passa a
              ficar desabilitado em vez de só avisar depois do clique. */}
          <div
            className={
              "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm " +
              (bate
                ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400"
                : "border-destructive/30 bg-destructive/10 text-destructive")
            }
          >
            {bate ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
            <span>
              Total do rateio: <span className="font-semibold">{fmtBRL(totalRateado)}</span> / {fmtBRL(valorItem)}
              {!bate && (
                <span className="ml-1">
                  ({diferenca > 0 ? "faltam " : "excedeu "}
                  {fmtBRL(Math.abs(diferenca))})
                </span>
              )}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSalvar} disabled={salvar.isPending || !podeSalvar} title={!podeSalvar ? "Selecione a classificação em todas as linhas e acerte o total do rateio" : undefined}>
            {salvar.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
