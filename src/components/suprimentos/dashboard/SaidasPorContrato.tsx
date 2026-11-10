/**
 * Saídas por Contrato — o corpo do relatório, sem filtros de período próprios
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
 * O QUADRO É POR CATEGORIA DE ITEM, EM QUANTIDADE E EM REAIS — decisão da CEO
 * em 10/11/2026, com layout aprovado. Antes ele contava unidades repartidas por
 * ORIGEM (sistema / planilha / sem destino). A origem não desapareceu: ela
 * continua no aviso de cobertura do mês, que é onde interessa, e na exportação
 * detalhada por item.
 *
 * O "Valor total" de cada contrato aqui é, de propósito, o MESMO número que a
 * coluna "Consumo de Estoque" da Lucratividade de Contratos mostra para aquele
 * contrato no mesmo período — as duas consultas somam a mesma expressão desde
 * 20261110200000. Mexer na conta de um lado sem o outro quebra essa promessa,
 * e é dela que a CEO depende para o levantamento de gastos por contrato.
 *
 * O filtro de categoria mora AQUI dentro, e não na faixa de filtros da tela:
 * assim ele vale igual nos dois lugares onde o painel aparece, sem cada um dos
 * dois ter que passar mais uma prop. Ele recorta antes de somar, então o rodapé
 * acompanha a tabela.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, Download, FileSpreadsheet, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { useCoberturaSaidas, useSaidasPorContrato } from "@/hooks/useSaidasPorContrato";
import {
  CATEGORIAS_ITEM,
  ROTULO_CATEGORIA,
  type CategoriaItem,
  coberturaPreocupante,
  filtrarPorNome,
  gerarCsvPorCategoria,
  gerarCsvSaidas,
  percentualCobertura,
  resumirPorCategoria,
  totalizar,
} from "@/lib/suprimentos/saidasPorContrato";

interface Props {
  /** `null` = consolidado do grupo. Só o Dashboard preenche. */
  empresaId: string | null;
  inicio: string;
  fim: string;
  contratoId: string | null;
}

const TODAS = "__todas__";

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

const dinheiro = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const inteiro = (v: number) => v.toLocaleString("pt-BR");

export function SaidasPorContrato({ empresaId, inicio, fim, contratoId }: Props) {
  const [categoria, setCategoria] = useState<string>(TODAS);
  const [busca, setBusca] = useState("");

  const filtro = useMemo(
    () => ({ inicio, fim, contratoId, empresaId }),
    [inicio, fim, contratoId, empresaId],
  );

  const { data: linhas, isLoading, error } = useSaidasPorContrato(filtro);
  // A cobertura é de propósito do grupo inteiro, sem recorte de empresa: ela é
  // o aviso de que parte do mês não tem destino conhecido, e saída sem contrato
  // não tem empresa. Filtrada, ela diria 100% sempre.
  const { data: cobertura } = useCoberturaSaidas({ inicio, fim });

  const resumo = useMemo(
    () =>
      resumirPorCategoria(
        linhas ?? [],
        categoria === TODAS ? null : (categoria as CategoriaItem),
      ),
    [linhas, categoria],
  );
  const visiveis = useMemo(() => filtrarPorNome(resumo.contratos, busca), [resumo, busca]);
  // Cartões e rodapé somam o que está na tela, não o período inteiro: com a
  // busca ativa, um total maior que a soma das linhas visíveis parece erro.
  // As COLUNAS, não: elas seguem o filtro de categoria, como no layout aprovado.
  const totais = useMemo(() => totalizar(visiveis), [visiveis]);
  const cats = resumo.categoriasPresentes;

  const mesesFracos = useMemo(
    () => (cobertura ?? []).filter(coberturaPreocupante),
    [cobertura],
  );

  return (
    <div className="space-y-4">
      {mesesFracos.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Período com cobertura incompleta</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              Nestes meses parte das saídas não tem contrato identificado, porque os pedidos
              foram apagados no sistema antigo antes da importação. O valor abaixo não fecha o
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
        <Cartao titulo="Quantidade total no período" valor={inteiro(totais.quantidade)} />
        <Cartao titulo="Valor total no período" valor={dinheiro(totais.valor)} />
        <Cartao titulo="Contratos no resultado" valor={inteiro(visiveis.length)} />
        <Cartao
          titulo="Categorias de itens"
          valor={inteiro(cats.length)}
          detalhe={cats.length ? cats.map((c) => ROTULO_CATEGORIA[c]).join(", ") : undefined}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Por contrato</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar contrato..."
              aria-label="Buscar contrato"
              className="h-8 w-[200px] text-xs"
            />
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger className="h-8 w-[180px] text-xs" aria-label="Categoria">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todas as categorias</SelectItem>
                {CATEGORIAS_ITEM.map((c) => (
                  <SelectItem key={c} value={c}>
                    {ROTULO_CATEGORIA[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={!visiveis.length}
              onClick={() =>
                baixarCsv(
                  gerarCsvPorCategoria(visiveis, cats),
                  `saidas-por-contrato-${inicio}-a-${fim}.csv`,
                )
              }
            >
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
            {/* A exportação item a item com a origem de cada saída é o que o
                setor usa para auditar a importação do sistema antigo. O quadro
                novo é por categoria, então ela ganhou um botão próprio em vez
                de sair junto com as colunas antigas. */}
            <Button
              variant="ghost"
              size="sm"
              disabled={!linhas?.length}
              onClick={() =>
                baixarCsv(
                  gerarCsvSaidas(linhas ?? []),
                  `saidas-por-contrato-detalhado-${inicio}-a-${fim}.csv`,
                )
              }
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Detalhado por item
            </Button>
          </div>
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
          {!isLoading && !error && visiveis.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <FileSpreadsheet className="h-8 w-8" />
              <p>
                {linhas?.length
                  ? "Nenhum contrato encontrado com esses filtros."
                  : "Nenhuma saída no período selecionado."}
              </p>
            </div>
          )}
          {!isLoading && visiveis.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead rowSpan={2} className="sticky left-0 bg-background min-w-[260px]">
                      Contrato
                    </TableHead>
                    {cats.map((c) => (
                      <TableHead key={c} colSpan={2} className="text-center border-l">
                        {ROTULO_CATEGORIA[c]}
                      </TableHead>
                    ))}
                    <TableHead colSpan={2} className="text-center border-l bg-muted/50">
                      Total
                    </TableHead>
                  </TableRow>
                  <TableRow>
                    {cats.map((c) => [
                      <TableHead key={`${c}-q`} className="text-right border-l">
                        Quantidade
                      </TableHead>,
                      <TableHead key={`${c}-v`} className="text-right">
                        Valor
                      </TableHead>,
                    ])}
                    <TableHead className="text-right border-l bg-muted/50">
                      Quantidade total
                    </TableHead>
                    <TableHead className="text-right bg-muted/50">Valor total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiveis.map((r) => (
                    <TableRow key={r.contrato_id ?? "sem"}>
                      <TableCell className="sticky left-0 bg-background">
                        {r.contrato_nome}
                        {!r.contrato_id && (
                          <Badge variant="outline" className="ml-2">
                            sem contrato
                          </Badge>
                        )}
                      </TableCell>
                      {cats.map((c) => [
                        <TableCell key={`${c}-q`} className="text-right border-l">
                          {inteiro(r.porCategoria[c].quantidade)}
                        </TableCell>,
                        <TableCell key={`${c}-v`} className="text-right">
                          {dinheiro(r.porCategoria[c].valor)}
                        </TableCell>,
                      ])}
                      <TableCell className="text-right font-medium border-l bg-muted/30">
                        {inteiro(r.quantidade)}
                      </TableCell>
                      <TableCell className="text-right font-semibold bg-muted/30">
                        {dinheiro(r.valor)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell className="sticky left-0 bg-muted/50">Total geral</TableCell>
                    {cats.map((c) => [
                      <TableCell key={`${c}-q`} className="text-right border-l">
                        {inteiro(totais.totalPorCategoria[c].quantidade)}
                      </TableCell>,
                      <TableCell key={`${c}-v`} className="text-right">
                        {dinheiro(totais.totalPorCategoria[c].valor)}
                      </TableCell>,
                    ])}
                    <TableCell className="text-right border-l">
                      {inteiro(totais.quantidade)}
                    </TableCell>
                    <TableCell className="text-right">{dinheiro(totais.valor)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Como ler este quadro</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            Saídas agrupadas por contrato e por categoria de item. Cada categoria mostra
            quantidade e valor; as duas últimas colunas consolidam a linha. O valor é a
            quantidade que saiu vezes o <strong>custo do item</strong>, que vem da entrada no
            estoque — item que entrou sem preço cadastrado vale zero aqui.
          </p>
          <p>
            O <strong>Valor total</strong> de cada contrato é o mesmo número que aparece na
            coluna <strong>Consumo de Estoque</strong> em Controladoria → Lucratividade de
            Contratos, para o mesmo período. As duas telas somam a mesma conta.
          </p>
          <p>
            O total inclui as saídas cujo contrato foi recuperado dos exports em Excel do
            sistema antigo, e não só as que têm pedido no ERP. O aviso de cobertura mostra
            quanto de cada mês ainda está sem destino conhecido; a exportação{" "}
            <strong>Detalhado por item</strong> traz a origem de cada saída, uma a uma.
          </p>
        </AlertDescription>
      </Alert>
    </div>
  );
}

function Cartao({
  titulo,
  valor,
  detalhe,
}: {
  titulo: string;
  valor: string;
  detalhe?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{valor}</p>
        {detalhe && <p className="text-xs text-muted-foreground">{detalhe}</p>}
      </CardContent>
    </Card>
  );
}
