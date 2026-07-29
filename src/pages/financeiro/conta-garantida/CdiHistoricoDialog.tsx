import { useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

const fmtPct = (n: number) => `${(n * 100).toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}%`;

interface CdiHistoricoDialogProps {
  open: boolean;
  onClose: () => void;
  historico: Record<string, number>;
}

export function CdiHistoricoDialog({ open, onClose, historico }: CdiHistoricoDialogProps) {
  const linhas = useMemo(
    () => Object.entries(historico).sort(([a], [b]) => b.localeCompare(a)).slice(0, 20),
    [historico]
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Histórico do CDI</DialogTitle>
          <DialogDescription>
            Últimos dias cacheados do Bacen (série 12) — usado no cálculo de rendimento/juros indexados a %CDI.
          </DialogDescription>
        </DialogHeader>

        {linhas.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum CDI cacheado ainda. Clique em "Atualizar CDI" pra buscar no Bacen.
          </p>
        ) : (
          <div className="max-h-[50vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">CDI (a.d.)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map(([data, valor], i) => (
                  <TableRow key={data}>
                    <TableCell className={i === 0 ? "font-semibold" : undefined}>
                      {new Date(data + "T00:00:00").toLocaleDateString("pt-BR")}
                      {i === 0 && <span className="ml-2 text-[10px] text-muted-foreground">(mais recente)</span>}
                    </TableCell>
                    <TableCell className="text-right">{fmtPct(valor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
