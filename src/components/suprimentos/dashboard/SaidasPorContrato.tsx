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
  type ContratoPorCategoria,
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
/**
 * Valor sem o "R$" repetido em cada célula. Com cinco categorias o quadro tem
 * treze colunas, e o prefixo em todas elas é o que fazia a tabela não caber a
 * 100% de zoom — o símbolo fica no cabeçalho, onde basta dizê-lo uma vez.
 */
const valorTabela = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Categorias em que o contrato teve movimento — as outras não viram linha no cartão. */
const comMovimento = (r: ContratoPorCategoria, cats: CategoriaItem[]) =>
  cats.filter((c) => r.porCategoria[c].quantidade || r.porCategoria[c].valor);

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
          {/* Em tela larga, o quadro aprovado. Abaixo disso ele não cabe, e aí
              cada contrato vira um cartão: é a única forma de não cortar nada
              sem empurrar o usuário para a barra de rolagem lateral.
              (SIS-2026-0769, reclamação de 10/11/2026: a 100% de zoom a tela
              cortava e só cabia a 80%.)

              O 1500 é MEDIDO, não chutado. A tabela encolhe no máximo até
              1067px (min-content, medido no Chrome), e a moldura do ERP come
              376px: sidebar de 268 + painel online recolhido de 60 + respiro
              da página. 1500 - 376 = 1124, com 57px de folga.

              O corte é por largura de VIEWPORT porque o projeto não tem o
              plugin de container queries; o zoom do navegador muda exatamente
              essa largura, que é o que o usuário mexe. Com o painel online
              ABERTO (264px em vez de 60) numa tela de 1500 ainda sobra barra
              de rolagem — por isso o overflow-x-auto fica, como rede: degrada
              em rolagem, nunca em corte. */}
          {!isLoading && visiveis.length > 0 && (
            <>
              <div className="hidden overflow-x-auto min-[1500px]:block">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead
                        rowSpan={2}
                        className="sticky left-0 z-10 min-w-[180px] max-w-[300px] bg-background px-2"
                      >
                        Contrato
                      </TableHead>
                      {cats.map((c) => (
                        <TableHead key={c} colSpan={2} className="border-l px-2 text-center">
                          {ROTULO_CATEGORIA[c]}
                        </TableHead>
                      ))}
                      <TableHead colSpan={2} className="border-l bg-muted/50 px-2 text-center">
                        Total
                      </TableHead>
                    </TableRow>
                    <TableRow>
                      {cats.map((c) => [
                        <TableHead key={`${c}-q`} className="border-l px-2 text-right">
                          Qtd
                        </TableHead>,
                        <TableHead key={`${c}-v`} className="px-2 text-right">
                          Valor (R$)
                        </TableHead>,
                      ])}
                      <TableHead className="border-l bg-muted/50 px-2 text-right">
                        Qtd total
                      </TableHead>
                      <TableHead className="bg-muted/50 px-2 text-right">
                        Valor total (R$)
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visiveis.map((r) => (
                      <TableRow key={r.contrato_id ?? "sem"}>
                        <TableCell
                          className="sticky left-0 z-10 max-w-[300px] truncate bg-background px-2 py-2"
                          title={r.contrato_nome}
                        >
                          {r.contrato_nome}
                          {!r.contrato_id && (
                            <Badge variant="outline" className="ml-2">
                              sem contrato
                            </Badge>
                          )}
                        </TableCell>
                        {cats.map((c) => [
                          <TableCell key={`${c}-q`} className="border-l px-2 py-2 text-right">
                            {inteiro(r.porCategoria[c].quantidade)}
                          </TableCell>,
                          <TableCell key={`${c}-v`} className="px-2 py-2 text-right">
                            {valorTabela(r.porCategoria[c].valor)}
                          </TableCell>,
                        ])}
                        <TableCell className="border-l bg-muted/30 px-2 py-2 text-right font-medium">
                          {inteiro(r.quantidade)}
                        </TableCell>
                        <TableCell className="bg-muted/30 px-2 py-2 text-right font-semibold">
                          {valorTabela(r.valor)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/50 font-semibold">
                      <TableCell className="sticky left-0 z-10 bg-muted/50 px-2 py-2">
                        Total geral
                      </TableCell>
                      {cats.map((c) => [
                        <TableCell key={`${c}-q`} className="border-l px-2 py-2 text-right">
                          {inteiro(totais.totalPorCategoria[c].quantidade)}
                        </TableCell>,
                        <TableCell key={`${c}-v`} className="px-2 py-2 text-right">
                          {valorTabela(totais.totalPorCategoria[c].valor)}
                        </TableCell>,
                      ])}
                      <TableCell className="border-l px-2 py-2 text-right">
                        {inteiro(totais.quantidade)}
                      </TableCell>
                      <TableCell className="px-2 py-2 text-right">
                        {valorTabela(totais.valor)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-3 min-[1500px]:hidden">
                {visiveis.map((r) => (
                  <div key={r.contrato_id ?? "sem"} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium">
                        {r.contrato_nome}
                        {!r.contrato_id && (
                          <Badge variant="outline" className="ml-2">
                            sem contrato
                          </Badge>
                        )}
                      </p>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold">{dinheiro(r.valor)}</p>
                        <p className="text-xs text-muted-foreground">
                          {inteiro(r.quantidade)} un
                        </p>
                      </div>
                    </div>
                    <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 border-t pt-2 sm:grid-cols-2">
                      {comMovimento(r, cats).map((c) => (
                        <div key={c} className="flex items-baseline justify-between gap-2 text-xs">
                          <dt className="truncate text-muted-foreground">
                            {ROTULO_CATEGORIA[c]}
                          </dt>
                          <dd className="shrink-0">
                            {dinheiro(r.porCategoria[c].valor)}{" "}
                            <span className="text-muted-foreground">
                              ({inteiro(r.porCategoria[c].quantidade)} un)
                            </span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/50 p-3 font-semibold">
                  <span className="text-sm">Total geral</span>
                  <span className="text-right">
                    <span className="block text-sm">{dinheiro(totais.valor)}</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {inteiro(totais.quantidade)} un
                    </span>
                  </span>
                </div>
              </div>
            </>
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
