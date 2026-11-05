/**
 * Saídas por Contrato — o corpo do relatório, sem filtros próprios
 * (SIS-2026-0769).
 *
 * Existe para o relatório viver em DOIS lugares sem duas implementações:
 *   • /app/suprimentos/saidas-por-contrato — a tela própria, que tem os
 *     seletores de período e contrato e passa o que o usuário escolheu;
 *   • aba "Saídas por Contrato" do Dashboard de Compras, que passa os filtros
 *     já existentes de lá (período, contrato e empresa).
 *
 * Mesmo padrão de RotatividadeEstoque e EstoqueSaudavel: componente que só
 * recebe o recorte por prop e não sabe de onde ele veio.
 *
 * Por que as três origens aparecem sempre separadas: de março a junho/2026
 * parte do vínculo com o contrato foi reconstruída a partir de exports em
 * Excel do sistema antigo, porque os pedidos originais foram apagados lá
 * dentro antes da importação. É dado de boa procedência, mas não é registro do
 * ERP, e numa análise de lucratividade a diferença importa.
 */
import { useMemo } from "react";
import { AlertTriangle, Download, FileSpreadsheet, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCoberturaSaidas, useSaidasPorContrato } from "@/hooks/useSaidasPorContrato";
import {
  ROTULO_ORIGEM,
  categoriaOrigem,
  coberturaPreocupante,
  gerarCsvSaidas,
  percentualCobertura,
  resumirPorContrato,
} from "@/lib/suprimentos/saidasPorContrato";

interface Props {
  /** `null` = consolidado do grupo. Só o Dashboard preenche. */
  empresaId: string | null;
  inicio: string;
  fim: string;
  contratoId: string | null;
}

function baixarCsv(conteudo: string, nome: string) {
  // BOM para o Excel em pt-BR reconhecer acento sem pedir importação.
  const blob = new Blob(["﻿" + conteudo], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

export function SaidasPorContrato({ empresaId, inicio, fim, contratoId }: Props) {
  const filtro = useMemo(
    () => ({ inicio, fim, contratoId, empresaId }),
    [inicio, fim, contratoId, empresaId],
  );

  const { data: linhas, isLoading, error } = useSaidasPorContrato(filtro);
  // A cobertura é de propósito do grupo inteiro, sem recorte de empresa: ela é
  // o aviso de que parte do mês não tem destino conhecido, e saída sem contrato
  // não tem empresa. Filtrada, ela diria 100% sempre.
  const { data: cobertura } = useCoberturaSaidas({ inicio, fim });

  const porContrato = useMemo(() => resumirPorContrato(linhas ?? []), [linhas]);
  const mesesFracos = useMemo(
    () => (cobertura ?? []).filter(coberturaPreocupante),
    [cobertura],
  );

  const totais = useMemo(() => {
    const t = { quantidade: 0, sistema: 0, planilha: 0, sem_destino: 0 };
    for (const l of linhas ?? []) {
      t.quantidade += l.quantidade;
      t[categoriaOrigem(l.origem)] += l.quantidade;
    }
    return t;
  }, [linhas]);

  return (
    <div className="space-y-4">
      {mesesFracos.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Período com cobertura incompleta</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              Nestes meses parte das saídas não tem contrato identificado, porque os pedidos
              foram apagados no sistema antigo antes da importação. O número abaixo não fecha o
              total do mês:
            </p>
            <ul className="list-disc pl-5">
              {mesesFracos.map((m) => (
                <li key={m.competencia}>
                  <strong>{m.competencia}</strong>: {percentualCobertura(m)}% com destino
                  conhecido — {m.unidades_sem_destino} de {m.unidades_total} unidades sem
                  contrato.
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {empresaId && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Recorte de uma empresa</AlertTitle>
          <AlertDescription>
            A empresa vem do contrato da saída. As saídas <strong>sem contrato
            identificado</strong> não entram nesta conta, porque não há a que atribuí-las —
            para vê-las, troque o seletor de empresa para “Todas”. O aviso de cobertura acima
            continua sendo do grupo inteiro.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CartaoTotal titulo="Unidades no período" valor={totais.quantidade} />
        <CartaoTotal titulo={ROTULO_ORIGEM.sistema} valor={totais.sistema} />
        <CartaoTotal
          titulo={ROTULO_ORIGEM.planilha}
          valor={totais.planilha}
          detalhe="Export do sistema antigo"
        />
        <CartaoTotal
          titulo={ROTULO_ORIGEM.sem_destino}
          valor={totais.sem_destino}
          detalhe={empresaId ? "Fora do recorte por empresa" : "Pedido apagado no legado"}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Por contrato</CardTitle>
          <Button
            variant="outline"
            size="sm"
            disabled={!linhas?.length}
            onClick={() =>
              baixarCsv(gerarCsvSaidas(linhas ?? []), `saidas-por-contrato-${inicio}-a-${fim}.csv`)
            }
          >
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </Button>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>
                Não foi possível carregar o relatório. {String(error)}
              </AlertDescription>
            </Alert>
          )}
          {isLoading && <Skeleton className="h-48 w-full" />}
          {!isLoading && !error && porContrato.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <FileSpreadsheet className="h-8 w-8" />
              <p>Nenhuma saída no período selecionado.</p>
            </div>
          )}
          {!isLoading && porContrato.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contrato</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">No sistema</TableHead>
                  <TableHead className="text-right">De planilha</TableHead>
                  <TableHead className="text-right">Sem destino</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porContrato.map((c) => (
                  <TableRow key={c.contrato_id ?? "sem"}>
                    <TableCell>
                      {c.contrato_nome}
                      {!c.contrato_id && (
                        <Badge variant="outline" className="ml-2">
                          sem contrato
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">{c.quantidade}</TableCell>
                    <TableCell className="text-right">{c.sistema}</TableCell>
                    <TableCell className="text-right">{c.planilha}</TableCell>
                    <TableCell className="text-right">{c.sem_destino}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>De onde vem cada número</AlertTitle>
        <AlertDescription>
          <strong>{ROTULO_ORIGEM.sistema}</strong>: a saída está ligada ao pedido, e o contrato
          vem dele. <strong>{ROTULO_ORIGEM.planilha}</strong>: o pedido foi apagado no sistema
          antigo antes da importação e o contrato foi recuperado de um export em Excel feito na
          época — é dado confiável, mas não é registro do ERP.{" "}
          <strong>{ROTULO_ORIGEM.sem_destino}</strong>: nem o pedido nem nenhum export
          sobreviveram; a saída existe, o destino não é conhecido.
        </AlertDescription>
      </Alert>
    </div>
  );
}

function CartaoTotal({
  titulo,
  valor,
  detalhe,
}: {
  titulo: string;
  valor: number;
  detalhe?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{valor.toLocaleString("pt-BR")}</p>
        {detalhe && <p className="text-xs text-muted-foreground">{detalhe}</p>}
      </CardContent>
    </Card>
  );
}
