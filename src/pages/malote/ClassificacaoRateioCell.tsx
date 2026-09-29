import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MaloteDespesaRow } from "@/hooks/useMaloteDespesa";

// Sugestão do Iury: em vez de deixar a coluna "Classificação" em branco
// pra despesa de Rateio (classificacao_id null — a classificação é por
// linha do rateio, não na despesa), mostra quantas são e abre um modal com
// a lista, sem estourar a linha da tabela com N nomes concatenados.
export function ClassificacaoRateioCell({
  despesa,
  classificacaoIdsRateio,
  nomePorClassificacaoId,
}: {
  despesa: MaloteDespesaRow;
  classificacaoIdsRateio: Set<string> | undefined;
  nomePorClassificacaoId: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);

  if (despesa.classificacao?.nome) return <span>{despesa.classificacao.nome}</span>;

  const nomes = Array.from(classificacaoIdsRateio ?? [])
    .map((id) => nomePorClassificacaoId.get(id))
    .filter((n): n is string => !!n)
    .sort();

  if (nomes.length === 0) return <span className="text-muted-foreground">—</span>;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="text-primary underline decoration-dotted underline-offset-2 hover:no-underline"
      >
        {nomes.length} classificaç{nomes.length === 1 ? "ão" : "ões"}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Classificações do rateio</DialogTitle>
          </DialogHeader>
          <ul className="space-y-1.5 text-sm">
            {nomes.map((nome) => (
              <li key={nome} className="rounded-md bg-muted/50 px-3 py-1.5">
                {nome}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
