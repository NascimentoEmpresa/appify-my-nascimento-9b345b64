import { useState } from "react";
import { Link } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDiferencasPlanilhaFluxo, type DiferencaPlanilhaFluxo } from "@/hooks/useConciliacaoOrigem";
import { useReverterAjusteFluxoCaixa } from "@/hooks/useFluxoCaixaMalote";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { dia } from "./componentes";
import { categoriaDaDiferenca, efeitoDasDiferencas, ROTULO_CATEGORIA_DIFERENCA, type BasePonte, type CategoriaDiferenca } from "./regras";

// SIS-2026-0701: as linhas que o Fluxo lê diferente da planilha, com o que fazer: voltar ao valor da planilha (desfaz o ajuste feito
// no Fluxo depois da carga). Se o ajuste foi proposital, a linha fica como está e a diferença é explicada por ela.
const tipoTxt = (t: string) => (t === "entrada" ? "Entrada" : "Saída");
const nomeMes = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

function Antes({ d }: { d: DiferencaPlanilhaFluxo }) {
  return <>{tipoTxt(d.tipo_planilha)} {formatBRL(d.valor_planilha)} em {dia(d.data_planilha)}</>;
}
function Depois({ d }: { d: DiferencaPlanilhaFluxo }) {
  return <>{tipoTxt(d.tipo_erp)} {formatBRL(d.valor_erp)} em {dia(d.data_erp)}</>;
}

export default function DiferencasMesDialog({ mes, base, onClose }: { mes: string | null; base: BasePonte; onClose: () => void }) {
  const { data: linhas = [], isLoading, error, refetch } = useDiferencasPlanilhaFluxo(mes, base);
  const reverter = useReverterAjusteFluxoCaixa();
  const [revertendo, setRevertendo] = useState<string | null>(null);

  async function voltar(d: DiferencaPlanilhaFluxo) {
    setRevertendo(d.despesa_id);
    try {
      await reverter.mutateAsync({ origem: "importacao_historica", despesaId: d.despesa_id, numeroParcela: null });
      toast.success(`Linha ${d.planilha_linha} voltou ao valor da planilha.`);
      await refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível desfazer o ajuste.");
    } finally {
      setRevertendo(null);
    }
  }

  // O que a lista explica: o que o ERP lê a mais ou a menos neste mês por causa dessas linhas, separado pelo motivo.
  const efeito = efeitoDasDiferencas(linhas, mes ?? "", base);

  return (
    <Dialog open={!!mes} onOpenChange={(a) => { if (!a) onClose(); }}>
      <DialogContent className="w-[96vw] max-w-[1500px]">
        <DialogHeader>
          <DialogTitle>Diferenças da planilha em {mes ? nomeMes(mes) : ""}</DialogTitle>
          <DialogDescription>
            Linhas que subiram da planilha com um valor, tipo ou mês e que hoje o Fluxo de Caixa lê de outro jeito (alguém ajustou depois da carga).
            Cada linha mostra o que a planilha tinha, o que o ERP lê agora e o número da linha no Excel.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Procurando as diferenças…</p>
        ) : error ? (
          <div className="space-y-1 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            <p className="font-medium">Não foi possível buscar as diferenças.</p>
            <p className="text-xs">{(error as { message?: string }).message ?? "Erro desconhecido."}</p>
            <p className="text-xs">Se a mensagem fala que a função não existe, aplique a migration 20261021000045_conciliacao_fluxo_planilha_por_mes.sql inteira (ela é idempotente).</p>
          </div>
        ) : linhas.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma linha ajustada neste mês. Se a diferença continua, ela vem de linha que a tela não lê ou de lançamento só do ERP: veja "Fora do uso" na tabela.
          </p>
        ) : (
          <>
            <div className="space-y-1 rounded-md bg-muted/50 p-2.5 text-xs">
              <p>
                Por que o ERP difere da planilha neste mês: <b>entradas {formatBRL(efeito.entradas)}</b> e <b>saídas {formatBRL(efeito.saidas)}</b> a mais no ERP, por {efeito.qtd} linha(s) ajustada(s) depois da carga.
              </p>
              <ul className="list-disc pl-4">
                {(Object.keys(efeito.porCategoria) as CategoriaDiferenca[]).map((c) => (
                  <li key={c}>
                    {ROTULO_CATEGORIA_DIFERENCA[c]}: {efeito.porCategoria[c]!.qtd} linha(s), entradas {formatBRL(efeito.porCategoria[c]!.entradas)} · saídas {formatBRL(efeito.porCategoria[c]!.saidas)}
                  </li>
                ))}
              </ul>
              {(efeito.porCategoria.estorno?.qtd ?? 0) > 0 && (
                <p className="text-muted-foreground">
                  Estorno é saída negativa na planilha (abate as saídas). No ERP virou entrada positiva: o saldo é o mesmo, mas entradas e saídas ficam maiores que as do Excel pelo mesmo valor.
                  Não é erro: é a mesma movimentação lida de outro jeito.
                </p>
              )}
            </div>
            <div className="max-h-[60vh] overflow-y-auto overflow-x-hidden rounded-md border [&>div]:overflow-x-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Linha no Excel</TableHead>
                    <TableHead>Lançamento</TableHead>
                    <TableHead>Na planilha</TableHead>
                    <TableHead>No ERP hoje</TableHead>
                    <TableHead>O que mudou</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.map((d) => (
                    <TableRow key={`${d.planilha_linha}-${d.despesa_id}`}>
                      <TableCell className="font-mono text-xs">{d.planilha_linha}</TableCell>
                      <TableCell className="min-w-[220px] text-xs">
                        <span className="block break-words" title={d.descricao ?? ""}>{d.descricao ?? "—"}</span>
                        {d.id_malote && (
                          <Link to={`/app/financeiro/gestao-financeira/fluxo-caixa?busca=${encodeURIComponent(d.id_malote)}`} className="text-primary hover:underline">{d.id_malote}</Link>
                        )}
                      </TableCell>
                      <TableCell className="text-xs"><Antes d={d} /></TableCell>
                      <TableCell className="text-xs font-medium"><Depois d={d} /></TableCell>
                      <TableCell className="text-xs">{ROTULO_CATEGORIA_DIFERENCA[categoriaDaDiferenca(d)]}</TableCell>
                      <TableCell className="text-right">
                        <AcessoGate menu="financeiro-fluxo-caixa-gestao" acao="alterar">
                          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={revertendo === d.despesa_id} onClick={() => voltar(d)}>
                            <RotateCcw className="h-3.5 w-3.5" />{revertendo === d.despesa_id ? "Voltando…" : "Voltar ao da planilha"}
                          </Button>
                        </AcessoGate>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              "Voltar ao da planilha" apaga o ajuste feito só no Fluxo de Caixa; a linha volta a ter o valor, o tipo e a data que vieram do Excel. Se o ajuste foi
              proposital (a planilha estava errada), não volte: corrija a planilha de referência ou registre o motivo.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
