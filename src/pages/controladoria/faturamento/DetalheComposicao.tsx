import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import type { Celula, Composicao } from "./composicao";
import { useSalvarTratamentoContrato } from "./useTratamentosContrato";
import { SeletorRubricaClassificacao } from "./SeletorRubricaClassificacao";
import type { TratamentoContrato } from "./tratamentoContrato";

// SIS-2026-0641: modal "como esse número é formado" do Faturamento da Empresa. Em cima, a conta que fecha na célula
// clicada (a linha destacada é o valor clicado); embaixo, o que compõe (notas, contratos ou lançamentos do Fluxo).
const SINAL: Record<string, string> = { "-": "−", "=": "=", "+": "+" };

const texto = (c: Celula) => (typeof c === "number" ? fmtMoney(c) : c);

export function DetalheComposicao({ composicao, onClose }: { composicao: Composicao | null; onClose: () => void }) {
  const { data: podeAlterar } = useScreenAccess("controladoria-tratamento-contratos", "alterar");
  const salvar = useSalvarTratamentoContrato();
  async function mudar(contratoId: string, tratamento: TratamentoContrato) {
    try {
      await salvar.mutateAsync({ contratoId, tratamento });
      toast.success(tratamento === "normal" ? "Contrato voltou a contar nas despesas." : "Contrato tirado das despesas.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar o tratamento do contrato.");
    }
  }
  return (
    <Dialog open={!!composicao} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] w-[96vw] max-w-[1400px] overflow-x-hidden overflow-y-auto">
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

            {composicao.contratosNaColuna && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Contratos que compõem esta coluna ({composicao.contratosNaColuna.length.toLocaleString("pt-BR")})</h3>
                <p className="text-[11px] text-muted-foreground">
                  A coluna soma as saídas do Fluxo de Caixa destes contratos. {podeAlterar ? "Se algum não é despesa de contrato (ex.: estoque), use “Tirar das despesas”: vale para todos os relatórios e meses." : "Quem tem a ação Alterar em “Tratamento dos contratos” pode tirar um contrato das despesas."}
                </p>
                <div className="max-h-56 overflow-y-auto rounded-md border">
                  <Table className="text-xs tabular-nums">
                    <TableBody>
                      {composicao.contratosNaColuna.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="break-words">{c.nome}</TableCell>
                          <TableCell className="whitespace-nowrap text-right">{fmtMoney(c.valor)}</TableCell>
                          <TableCell className="w-px whitespace-nowrap text-right">
                            {podeAlterar && (
                              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={salvar.isPending} onClick={() => void mudar(c.id, "fora_das_despesas")}>
                                Tirar das despesas
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {composicao.contratosNaColuna.length === 0 && (
                        <TableRow><TableCell colSpan={3} className="py-4 text-center text-muted-foreground">Nenhum contrato com despesa neste recorte.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {composicao.classificacoesNaColuna && composicao.classificacoesNaColuna.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Classificações que compõem esta coluna ({composicao.classificacoesNaColuna.length.toLocaleString("pt-BR")})</h3>
                <p className="text-[11px] text-muted-foreground">
                  Cada classificação entra numa rubrica (Salários, Férias, FGTS, Outras…) ou fica de fora se “Não é custo”. Mudar a rubrica vale para todos os meses e telas (mesma ligação do painel Rubricas de custo da Lucratividade). Classificação marcada como “Não é custo” sai desta lista; para ela voltar, use o painel Rubricas de custo da Lucratividade.
                </p>
                <div className="max-h-56 overflow-y-auto rounded-md border">
                  <Table className="text-xs tabular-nums">
                    <TableBody>
                      {composicao.classificacoesNaColuna.map((c) => (
                        <TableRow key={c.id ?? c.nome}>
                          <TableCell className="break-words">{c.nome}<span className="ml-2 text-muted-foreground">{c.lancamentos} {c.lancamentos === 1 ? "lançamento" : "lançamentos"}</span></TableCell>
                          <TableCell className="whitespace-nowrap text-right">{fmtMoney(c.valor)}</TableCell>
                          <TableCell className="w-px whitespace-nowrap text-right"><SeletorRubricaClassificacao classificacaoId={c.id} nome={c.nome} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {composicao.contratosForaDaColuna && composicao.contratosForaDaColuna.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Fora desta coluna ({composicao.contratosForaDaColuna.length.toLocaleString("pt-BR")})</h3>
                <p className="text-[11px] text-muted-foreground">Contratos deste recorte que não entram em Despesas, pela regra do nome ou porque alguém definiu assim.</p>
                <div className="max-h-40 overflow-y-auto rounded-md border">
                  <Table className="text-xs">
                    <TableBody>
                      {composicao.contratosForaDaColuna.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="break-words">{c.nome}</TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {c.tratamento === "investimento" ? "Investimento" : "Fora das despesas"} · {c.origem === "configurado" ? "definido em Tratamento dos contratos" : "padrão pelo nome"}
                          </TableCell>
                          <TableCell className="w-px whitespace-nowrap text-right">
                            {podeAlterar && (
                              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={salvar.isPending} onClick={() => void mudar(c.id, "normal")}>
                                Voltar a contar
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {composicao.tabela && (
              <div>
                <h3 className="mb-1.5 text-sm font-semibold">{composicao.tabela.titulo}</h3>
                <div className="rounded-md border [&>div]:overflow-x-hidden">
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
                              className={`${composicao.tabela!.colunas[j]?.alinhar === "left" ? "break-words" : "whitespace-nowrap text-right"}`}
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
