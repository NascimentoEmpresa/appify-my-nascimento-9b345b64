import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { SeletorRubricaClassificacao } from "../faturamento/SeletorRubricaClassificacao";
import { complementoProjecao, type ItemDetalheClassificacao } from "./regras";

// SIS-2026-0730: "Detalhamento da despesa" ao clicar num valor do Fechamento da Empresa — de onde vem o número, por classificação,
// com a soma embaixo (que é o próprio valor clicado).
export interface DetalheAberto {
  titulo: string;
  subtitulo: string;
  itens: ItemDetalheClassificacao[];
  valorCelula: number;
  projetado: boolean;
  // colunas de rubrica (Salários, Férias…): mostra em qual rubrica cada classificação entra e deixa mudar. Nos sócios não se aplica.
  mostrarRubrica?: boolean;
}

export function DetalheDespesaDialog({ detalhe, onClose }: { detalhe: DetalheAberto | null; onClose: () => void }) {
  const complemento = detalhe ? complementoProjecao(detalhe.valorCelula, detalhe.itens) : 0;
  const nClass = detalhe ? detalhe.itens.length + (complemento > 0 ? 1 : 0) : 0;
  return (
    <Dialog open={!!detalhe} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`max-h-[85vh] overflow-y-auto ${detalhe?.mostrarRubrica ? "max-w-3xl" : "max-w-xl"}`}>
        {detalhe && (
          <>
            <DialogHeader>
              <div className="flex items-start justify-between gap-3 pr-6">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileText className="h-4 w-4" /></span>
                  <div>
                    <DialogTitle className="text-base">Detalhamento da despesa — {detalhe.titulo}</DialogTitle>
                    <DialogDescription>{detalhe.subtitulo}</DialogDescription>
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0 border-sky-300 bg-sky-50 text-sky-700">{nClass} {nClass === 1 ? "classificação" : "classificações"}</Badge>
              </div>
            </DialogHeader>

            <div className="overflow-hidden rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Classificação da despesa</TableHead>
                    {detalhe.mostrarRubrica && <TableHead>Entra na coluna</TableHead>}
                    <TableHead className="text-right">Valor (R$)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detalhe.itens.length === 0 && complemento === 0 && (
                    <TableRow><TableCell colSpan={detalhe.mostrarRubrica ? 3 : 2} className="py-6 text-center text-muted-foreground">Nenhum lançamento neste valor.</TableCell></TableRow>
                  )}
                  {detalhe.itens.map((i) => (
                    <TableRow key={i.classificacao}>
                      <TableCell>
                        {i.classificacao}
                        <span className="ml-2 text-xs text-muted-foreground">{i.lancamentos} {i.lancamentos === 1 ? "lançamento" : "lançamentos"}</span>
                      </TableCell>
                      {detalhe.mostrarRubrica && <TableCell><SeletorRubricaClassificacao classificacaoId={i.classificacaoId} nome={i.classificacao} /></TableCell>}
                      <TableCell className="text-right tabular-nums">{fmtMoney(i.valor)}</TableCell>
                    </TableRow>
                  ))}
                  {complemento > 0 && (
                    <TableRow>
                      <TableCell>
                        Projeção pela média dos últimos meses
                        <span className="ml-2 text-xs text-muted-foreground">ainda sem lançamento</span>
                      </TableCell>
                      {detalhe.mostrarRubrica && <TableCell />}
                      <TableCell className="text-right tabular-nums">{fmtMoney(complemento)}</TableCell>
                    </TableRow>
                  )}
                  <TableRow className="bg-sky-50/70 font-semibold hover:bg-sky-50/70 dark:bg-sky-950/30">
                    <TableCell>Total</TableCell>
                    {detalhe.mostrarRubrica && <TableCell />}
                    <TableCell className="text-right tabular-nums text-primary">{fmtMoney(detalhe.valorCelula)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            {detalhe.mostrarRubrica && (
              <p className="text-xs text-muted-foreground">Mudar a rubrica de uma classificação vale para todos os meses e telas (mesma ligação do painel Rubricas de custo da Lucratividade). A classificação sai desta coluna e passa para a escolhida; se marcar “Não é custo”, ela some daqui e só volta pelo painel Rubricas de custo da Lucratividade.</p>
            )}
            {detalhe.projetado && (
              <p className="text-xs text-muted-foreground">Mês projetado: vale o lançado ou a média dos últimos meses realizados, o que for maior.</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
