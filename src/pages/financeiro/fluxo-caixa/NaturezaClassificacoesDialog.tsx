import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSalvarNaturezaClassificacao } from "@/hooks/useFluxoNaturezaClassificacao";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { NATUREZAS, type MapaNatureza, type NaturezaFluxo, type TotaisNatureza } from "./naturezaFluxo";

const SEM = "__sem";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  classificacoes: { id: string; nome: string; ativo: boolean }[];
  mapa: MapaNatureza;
  pendentes: TotaisNatureza["semNaturezaPorClassificacao"];
  podeEditar: boolean;
}

// SIS-2026-0726: define se cada classificação é de conta movimento (livre), conta vinculada ou CDB. Grava na hora, ao escolher.
export function NaturezaClassificacoesDialog({ aberto, onFechar, classificacoes, mapa, pendentes, podeEditar }: Props) {
  const salvar = useSalvarNaturezaClassificacao();
  const [busca, setBusca] = useState("");
  const nomeDe = useMemo(() => new Map(classificacoes.map((c) => [c.id, c.nome])), [classificacoes]);
  const idsPendentes = useMemo(() => new Set(pendentes.map((p) => p.classificacaoId).filter(Boolean) as string[]), [pendentes]);
  const semClassificacao = pendentes.find((p) => p.classificacaoId === null);

  async function escolher(classificacaoId: string, v: string) {
    try {
      await salvar.mutateAsync({ classificacaoId, natureza: v === SEM ? null : (v as NaturezaFluxo) });
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar a natureza.");
    }
  }

  const seletor = (id: string) => (
    <Select value={mapa.get(id) ?? SEM} onValueChange={(v) => void escolher(id, v)} disabled={!podeEditar || salvar.isPending}>
      <SelectTrigger className="h-8 w-60 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={SEM}>Sem natureza definida</SelectItem>
        {NATUREZAS.map((n) => <SelectItem key={n.valor} value={n.valor}>{n.rotulo}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  const termo = busca.trim().toLowerCase();
  const todas = classificacoes.filter((c) => !termo || c.nome.toLowerCase().includes(termo));

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Natureza das classificações</DialogTitle>
          <DialogDescription>
            Os cards de Entradas, Saídas e Saldo separam o que é de uso livre do que não pode ser usado, pela classificação do lançamento: conta movimento (livre
            utilização), conta vinculada ou aplicações em CDB. Classificação sem natureza não entra em nenhum grupo e é acusada nos cards.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {(pendentes.length > 0) && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-amber-700">Sem natureza no filtro atual</p>
              {semClassificacao && (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                  {semClassificacao.qtd} lançamento(s) sem classificação ({formatBRL(semClassificacao.valor)}). Não dá para definir natureza sem classificação: use o filtro
                  Classificação → "Sem classificação (—)" e classifique cada um.
                </p>
              )}
              {pendentes.filter((p) => p.classificacaoId).map((p) => (
                <div key={p.classificacaoId} className="flex items-center justify-between gap-3 rounded-md border p-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{nomeDe.get(p.classificacaoId!) ?? "Classificação"}</p>
                    <p className="text-xs text-muted-foreground">{p.qtd} lançamento(s) · {formatBRL(p.valor)}</p>
                  </div>
                  {seletor(p.classificacaoId!)}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-semibold">Todas as classificações</p>
            <Input className="h-8 text-xs" placeholder="Buscar classificação" value={busca} onChange={(e) => setBusca(e.target.value)} />
            {todas.filter((c) => !idsPendentes.has(c.id)).map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
                <p className="min-w-0 truncate text-sm">{c.nome}{!c.ativo && <span className="ml-1 text-xs text-muted-foreground">(inativa)</span>}</p>
                {seletor(c.id)}
              </div>
            ))}
            {todas.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma classificação encontrada.</p>}
          </div>
        </div>

        <DialogFooter>
          {!podeEditar && <span className="mr-auto text-xs text-muted-foreground">Só quem tem a ação Alterar no Fluxo de Caixa define a natureza.</span>}
          <Button variant="outline" onClick={onFechar}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
