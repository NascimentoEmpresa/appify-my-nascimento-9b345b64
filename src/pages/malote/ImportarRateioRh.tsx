// =====================================================================
// Malote › Criar Despesa › "Importar rateio" (19/10/2026, mig
// 20261019000003). O caminho de volta do "Enviar ao Malote" do RH: quem
// está lançando a despesa puxa um rateio CONFERIDO do RH › Rateio de
// Despesas e o painel nasce com uma linha por contrato (empresa do
// contrato, %, valor), o total = valor do rateio e o anexo do rateio.
// Desenho aprovado pelo Pablo em 19/10/2026:
//   · lista só rateios conferidos que ainda não estão no Malote;
//   · o fornecedor é escolhido aqui e vale para todas as linhas;
//   · o rateio fica vinculado à despesa e travado — quem garante é o
//     gatilho do INSERT (malote_despesa.rh_rateio_id), não esta tela.
// A conversão é a mesma do Enviar ao Malote (src/lib/rh/rateioParaMalote.ts).
// =====================================================================
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FileInput, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import { useContratosAtivos, useFornecedoresAtivos, type RateioLinha } from "@/hooks/useMaloteDespesa";
import { baixarAnexoRateio, useRateiosParaImportarMalote, type RateioParaImportar } from "@/hooks/useRateioDespesas";
import { competenciaRotulo, fmtMoeda, rotuloTipo } from "@/lib/rh/rateioDespesas";
import { linhasDoRateioParaMalote } from "@/lib/rh/rateioParaMalote";

export interface RateioImportado {
  rateio: RateioParaImportar;
  linhas: RateioLinha[];
  anexo: File | null;
  nome: string;
}

export function ImportarRateioRh({
  aberto, empresaPadrao, onFechar, onImportar,
}: {
  aberto: boolean;
  /** Empresa da despesa — recebe as linhas "Sem contrato". */
  empresaPadrao: string | null;
  onFechar: () => void;
  onImportar: (r: RateioImportado) => void;
}) {
  const lista = useRateiosParaImportarMalote(aberto);
  const { data: contratos = [], isFetched: contratosProntos } = useContratosAtivos();
  const { data: fornecedores = [] } = useFornecedoresAtivos();
  const [rateioId, setRateioId] = useState("");
  const [fornecedorId, setFornecedorId] = useState("");
  const [preparando, setPreparando] = useState(false);

  const empresaDoContrato = useMemo(() => new Map(contratos.map((c) => [c.id, c.empresa_id])), [contratos]);
  const escolhido = (lista.data ?? []).find((r) => r.id === rateioId) ?? null;

  const importar = async () => {
    if (!escolhido || !fornecedorId) return;
    setPreparando(true);
    try {
      // O anexo do rateio mora no bucket do RH: quem não tem a tela do RH
      // pode não conseguir baixar — segue sem e avisa.
      let anexo: File | null = null;
      if (escolhido.anexo_path) {
        anexo = await baixarAnexoRateio(escolhido.anexo_path, escolhido.anexo_nome ?? "anexo-rateio").catch(() => {
          toast.warning("Não foi possível trazer o anexo do rateio — anexe à mão.");
          return null;
        });
      }
      const mesAno = competenciaRotulo(escolhido.competencia);
      onImportar({
        rateio: escolhido,
        linhas: linhasDoRateioParaMalote(escolhido.itens, { empresaDoContrato, empresaPadrao, fornecedorId }),
        anexo,
        nome: `RATEIO ${rotuloTipo(escolhido.tipo).toUpperCase()} ${mesAno}`,
      });
      setRateioId("");
      setFornecedorId("");
    } finally {
      setPreparando(false);
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && !preparando && onFechar()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar rateio do RH</DialogTitle>
          <DialogDescription>
            Rateios conferidos no RH › Rateio de Despesas que ainda não estão no Malote. A despesa nasce com uma linha por
            contrato e o total do rateio; ao criá-la, o rateio fica vinculado e travado até a despesa ser excluída ou reprovada.
            Importar recomeça o formulário da despesa.
          </DialogDescription>
        </DialogHeader>

        {lista.isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <Loader2 className="inline h-4 w-4 animate-spin mr-2" /> Carregando rateios…
          </div>
        ) : lista.error ? (
          <p className="py-6 text-center text-sm text-destructive">{(lista.error as Error).message}</p>
        ) : !lista.data?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhum rateio conferido esperando o Malote.</p>
        ) : (
          <div className="border rounded-md divide-y max-h-[40vh] overflow-y-auto">
            {lista.data.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRateioId(r.id)}
                className={cn(
                  "w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-muted/50",
                  r.id === rateioId && "bg-primary/10",
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {rotuloTipo(r.tipo)} · {competenciaRotulo(r.competencia)}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {r.itens.filter((i) => i.valor > 0).length} contrato(s)
                    {r.conferido_por ? ` · ${r.conferido_por}` : ""}
                    {r.descricao ? ` · ${r.descricao}` : ""}
                  </p>
                </div>
                {r.anexo_path && <Badge variant="outline" className="text-[10px]">anexo</Badge>}
                <span className="text-sm font-semibold tabular-nums">{fmtMoeda(r.valor)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs">Fornecedor (todas as linhas) *</Label>
          <SearchableSelect
            value={fornecedorId}
            onChange={setFornecedorId}
            options={fornecedores.map((f) => ({ value: f.id, label: f.nome, hint: f.cnpj_cpf ?? undefined }))}
            placeholder="Escolha o fornecedor"
          />
          <p className="text-[11px] text-muted-foreground">Dá para trocar linha a linha depois, no rateio da despesa.</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={preparando}>Cancelar</Button>
          <Button onClick={importar} disabled={!escolhido || !fornecedorId || !contratosProntos || preparando} className="gap-1.5">
            {preparando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileInput className="h-4 w-4" />} Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
