import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import type { Celula, Composicao } from "./composicao";

// SIS-2026-0641: modal "como esse número é formado" do Faturamento da Empresa. Em cima, a conta que fecha na célula
// clicada (a linha destacada é o valor clicado); embaixo, o que compõe (notas, contratos ou lançamentos do Fluxo).
const SINAL: Record<string, string> = { "-": "−", "=": "=", "+": "+" };

const texto = (c: Celula) => (typeof c === "number" ? fmtMoney(c) : c);

export function DetalheComposicao({ composicao, onClose }: { composicao: Composicao | null; onClose: () => void }) {
  return (
    <Dialog open={!!composicao} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        {composicao && (
          <>
            <DialogHeader>
              <DialogTitle>{composicao.titulo}</DialogTitle>
              {composicao.descricao && <DialogDescription>{composicao.descricao}</DialogDescription>}
            </DialogHeader>

            {composicao.aviso && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{composicao.aviso}</span>
              </div>
            )}

            <div className="rounded-md border">
              <Table className="text-sm">
                <TableBody>
                  {composicao.conta.map((l, i) => (
                    <TableRow key={i} className={l.destaque ? "bg-amber-50 font-semibold dark:bg-amber-950/20" : undefined}>
                      <TableCell className="py-1.5">
                        <span className="mr-2 inline-block w-3 text-muted-foreground">{l.sinal ? SINAL[l.sinal] : ""}</span>
                        {l.rotulo}
                        {l.dica && <span className="block pl-5 text-[11px] font-normal text-muted-foreground">{l.dica}</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-1.5 text-right tabular-nums">{typeof l.valor === "number" ? fmtMoney(l.valor) : l.valor}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {composicao.tabela && (
              <div>
                <h3 className="mb-1.5 text-sm font-semibold">{composicao.tabela.titulo}</h3>
                <div className="overflow-x-auto rounded-md border">
                  <Table className="text-xs tabular-nums">
                    <TableHeader>
                      <TableRow>
                        {composicao.tabela.colunas.map((c) => (
                          <TableHead key={c.rotulo} className={c.alinhar === "left" ? "" : "text-right"}>{c.rotulo}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {composicao.tabela.linhas.map((linha, i) => (
                        <TableRow key={i}>
                          {linha.map((c, j) => (
                            <TableCell
                              key={j}
                              className={`${composicao.tabela!.colunas[j]?.alinhar === "left" ? "max-w-[240px] truncate" : "whitespace-nowrap text-right"}`}
                              title={typeof c === "string" ? c : undefined}
                            >
                              {texto(c)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                      {composicao.tabela.linhas.length === 0 && (
                        <TableRow><TableCell colSpan={composicao.tabela.colunas.length} className="py-6 text-center text-muted-foreground">Nada neste recorte.</TableCell></TableRow>
                      )}
                    </TableBody>
                    {composicao.tabela.rodape && composicao.tabela.linhas.length > 0 && (
                      <TableFooter>
                        <TableRow className="font-semibold">
                          {composicao.tabela.rodape.map((c, j) => (
                            <TableCell key={j} className={composicao.tabela!.colunas[j]?.alinhar === "left" ? "" : "text-right"}>{texto(c)}</TableCell>
                          ))}
                        </TableRow>
                      </TableFooter>
                    )}
                  </Table>
                </div>
                {composicao.tabela.nota && <p className="mt-1.5 text-[11px] text-muted-foreground">{composicao.tabela.nota}</p>}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
