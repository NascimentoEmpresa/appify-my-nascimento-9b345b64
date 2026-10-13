import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PostoVigente } from "@/hooks/usePlanilhaCusto";
import { fmtMoney } from "./shared";
import { LinhaFaltaDias, linhaFaltaVazia, totalFaltasLinhas, valorDaLinha } from "./faltasPorDias";

// SIS-2026-0633 (Veranópolis): "Tabela calculo faltas" da planilha modelo, como seção da
// NOTA (uma nota junta várias escolas). Cada linha: local (item da nota que recebe o
// desconto), posto da Planilha de Custo (traz o valor), dias de falta e o valor
// calculado (posto ÷ 30 × dias). A soma das linhas de cada item vai para o campo
// Faltas do item. Começa com uma linha; dá para adicionar mais.

interface Props {
  linhas: LinhaFaltaDias[];
  itens: { identificacao: string }[];
  postosVigentes: PostoVigente[];
  readOnly?: boolean;
  onChange: (linhas: LinhaFaltaDias[]) => void;
}

const SEM_ITEM = "__nenhum__";

export function FaltasPorDiasSecao({ linhas, itens, postosVigentes, readOnly, onChange }: Props) {
  const atualizar = (i: number, patch: Partial<LinhaFaltaDias>) =>
    onChange(linhas.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const remover = (i: number) => onChange(linhas.length > 1 ? linhas.filter((_, k) => k !== i) : [linhaFaltaVazia(0)]);
  const adicionar = () => {
    // sugere o próximo item ainda sem linha (como na planilha: linha n → item n)
    const usados = new Set(linhas.map((l) => l.item));
    const proximo = itens.findIndex((_, k) => !usados.has(k));
    onChange([...linhas, linhaFaltaVazia(proximo >= 0 ? proximo : null)]);
  };

  function escolherPosto(i: number, nome: string) {
    const p = postosVigentes.find((pv) => pv.posto === nome);
    atualizar(i, { posto: nome, valor_posto: p && p.valorUnitario > 0 ? Math.round(p.valorUnitario * 100) / 100 : null });
  }

  return (
    <section className="rounded-xl border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Faltas — cálculo por dias</div>
          <p className="text-[11px] text-muted-foreground">
            Valor das faltas = valor do posto ÷ 30 × dias de falta (pessoa-dia). O total de cada local vai para o campo Faltas do item.
          </p>
        </div>
        {!readOnly && (
          <Button type="button" variant="outline" size="sm" onClick={adicionar}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar linha
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {linhas.map((l, i) => (
          <div key={i} className="grid grid-cols-12 items-end gap-2">
            <div className="col-span-3">
              {i === 0 && <Label className="text-xs">Local (item da nota)</Label>}
              <Select
                value={l.item != null && itens[l.item] ? String(l.item) : SEM_ITEM}
                onValueChange={(v) => atualizar(i, { item: v === SEM_ITEM ? null : Number(v) })}
                disabled={readOnly}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Escolha o item" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_ITEM}>— escolher —</SelectItem>
                  {itens.map((it, k) => (
                    <SelectItem key={k} value={String(k)}>
                      {it.identificacao || `Item ${k + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-3">
              {i === 0 && <Label className="text-xs">Posto (Planilha de Custo)</Label>}
              <Select
                value={l.posto && postosVigentes.some((p) => p.posto === l.posto) ? l.posto : undefined}
                onValueChange={(v) => escolherPosto(i, v)}
                disabled={readOnly || postosVigentes.length === 0}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder={postosVigentes.length === 0 ? "Sem postos na planilha" : "Selecionar posto"} />
                </SelectTrigger>
                <SelectContent>
                  {postosVigentes.map((p) => (
                    <SelectItem key={p.posto} value={p.posto}>
                      {p.posto} — {fmtMoney(p.valorUnitario)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              {i === 0 && <Label className="text-xs">Valor do posto</Label>}
              <CurrencyInput
                className="h-8"
                value={String(l.valor_posto ?? "")}
                onChange={(v) => atualizar(i, { valor_posto: parseFloat(v) > 0 ? parseFloat(v) : null })}
                disabled={readOnly}
              />
            </div>
            <div className="col-span-1">
              {i === 0 && <Label className="text-xs">Dias</Label>}
              <Input
                className="h-8 px-2"
                type="number"
                min="0"
                step="1"
                value={l.dias || ""}
                onChange={(e) => atualizar(i, { dias: Math.max(0, Number(e.target.value) || 0) })}
                disabled={readOnly}
              />
            </div>
            <div className="col-span-2">
              {i === 0 && <Label className="text-xs">Valor da falta</Label>}
              <div className="flex h-8 items-center rounded-md border bg-muted/40 px-2 text-sm font-medium">{fmtMoney(valorDaLinha(l))}</div>
            </div>
            <div className="col-span-1">
              {!readOnly && (
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => remover(i)} title="Remover linha">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end text-sm">
        <span className="text-muted-foreground mr-2">Total de faltas:</span>
        <span className="font-semibold">{fmtMoney(totalFaltasLinhas(linhas))}</span>
      </div>
    </section>
  );
}
