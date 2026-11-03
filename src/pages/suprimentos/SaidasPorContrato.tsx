/**
 * Saídas por Contrato (SIS-2026-0769).
 *
 * Conferência das saídas de estoque importadas do ERP antigo: quanto e o quê
 * saiu para cada contrato, mês a mês. Pedido pela diretoria para a análise de
 * lucratividade — o fluxo de caixa não serve como fonte, porque material
 * comprado para um contrato é muitas vezes entregue a outro, e o destino real
 * só aparece na saída do estoque.
 *
 * A tela nunca mostra um total único: de março a junho/2026 parte do vínculo
 * com o contrato foi reconstruída a partir de exports em Excel do sistema
 * antigo (os pedidos originais foram apagados lá dentro, antes da importação).
 * É dado de boa procedência, mas não é registro do ERP, e numa análise de
 * lucratividade essa diferença importa — por isso as três origens aparecem
 * sempre separadas, e o aviso de cobertura fica fixo no topo.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, Download, FileSpreadsheet, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AcessoGate } from "@/components/auth/AcessoGate";
// `useContratos` (useContratos.ts) lê a tabela `contrato`, que é OUTRA — tem 56
// linhas e ids próprios. Quem `sup_pedido.contrato_id` referencia é `contratos`
// (101 linhas), e é dela que o relatório resolve o contrato. Usar a errada
// devolveria filtro vazio sem erro nenhum.
import { useContratosCatalogo } from "@/hooks/useSupCatalogo";
import { useCoberturaSaidas, useSaidasPorContrato } from "@/hooks/useSaidasPorContrato";
import {
  ROTULO_ORIGEM,
  categoriaOrigem,
  coberturaPreocupante,
  gerarCsvSaidas,
  percentualCobertura,
  resumirPorContrato,
} from "@/lib/suprimentos/saidasPorContrato";

const TODOS = "__todos__";

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

export default function SaidasPorContrato() {
  const hoje = new Date();
  const [inicio, setInicio] = useState(`${hoje.getFullYear()}-01-01`);
  const [fim, setFim] = useState(hoje.toISOString().slice(0, 10));
  const [contratoId, setContratoId] = useState<string>(TODOS);

  const filtro = useMemo(
    () => ({ inicio, fim, contratoId: contratoId === TODOS ? null : contratoId }),
    [inicio, fim, contratoId],
  );

  const { data: linhas, isLoading, error } = useSaidasPorContrato(filtro);
  const { data: cobertura } = useCoberturaSaidas({ inicio, fim });
  const { data: contratos } = useContratosCatalogo();

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
    <AcessoGate menu="sup_rel_saidas_contrato" acao="visualizar">
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold">Saídas por Contrato</h1>
          <p className="text-muted-foreground">
            Material e uniforme que saíram do estoque, por contrato e por mês.
          </p>
        </div>

        {mesesFracos.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Período com cobertura incompleta</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                Nestes meses parte das saídas não tem contrato identificado, porque os
                pedidos foram apagados no sistema antigo antes da importação. O número
                abaixo não fecha o total do mês:
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filtros</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="inicio">De</Label>
              <Input
                id="inicio"
                type="date"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fim">Até</Label>
              <Input id="fim" type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
            </div>
            <div className="min-w-64 space-y-1">
              <Label>Contrato</Label>
              <Select value={contratoId} onValueChange={setContratoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos os contratos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos os contratos</SelectItem>
                  {(contratos ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              disabled={!linhas?.length}
              onClick={() =>
                baixarCsv(gerarCsvSaidas(linhas ?? []), `saidas-por-contrato-${inicio}-a-${fim}.csv`)
              }
            >
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-4">
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
            detalhe="Pedido apagado no legado"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Por contrato</CardTitle>
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
            <strong>{ROTULO_ORIGEM.sistema}</strong>: a saída está ligada ao pedido, e o
            contrato vem dele. <strong>{ROTULO_ORIGEM.planilha}</strong>: o pedido foi apagado
            no sistema antigo antes da importação e o contrato foi recuperado de um export em
            Excel feito na época — é dado confiável, mas não é registro do ERP.{" "}
            <strong>{ROTULO_ORIGEM.sem_destino}</strong>: nem o pedido nem nenhum export
            sobreviveram; a saída existe, o destino não é conhecido.
          </AlertDescription>
        </Alert>
      </div>
    </AcessoGate>
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
