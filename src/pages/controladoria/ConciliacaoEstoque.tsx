import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowLeftRight, ArrowRight, Camera, CheckCircle2, Download, Info, Package, ShoppingCart, TrendingUp, Warehouse } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { SeletorBaseLeitura } from "./faturamento/SeletorBaseLeitura";
import { useLeituraCompartilhada } from "./faturamento/leituraCompartilhada";
import { rotuloMes } from "./faturamento/useBaseFaturamento";
import { mesesNoIntervalo, rotuloPeriodo, sufixoArquivo } from "./faturamento/periodoMeses";
import { useCustosContratoPeriodo } from "./faturamento/useCustosContratoMes";
import { useConsumoEstoqueContrato } from "./faturamento/useConsumoEstoqueContrato";
import { TituloComFormula } from "./faturamento/Rentabilidade";
import { linkFluxoDoRecorte } from "./fechamento/linkFluxo";
import {
  compraDiretaPorContrato, linhasPorContrato, montarConciliacao, montarPendencias, separarSaidas, type Pendencia,
} from "./conciliacao-estoque/regras";
import { idsContratosEstoque, useComprasEstoque, useContratosConciliacao, useFisicoConciliacao, useGravarFotoEstoque } from "./conciliacao-estoque/useConciliacaoEstoque";

// SIS-2026-0908: Conciliação de Estoque e Custo de Materiais (Controladoria). Compra (Fluxo, contratos de estoque) → Estoque Adm (contábil)
// ⇄ estoque físico (foto do almoxarifado) → saídas por contrato/administrativo → custo na Lucratividade. Regras em conciliacao-estoque/regras.ts.
// Só LÊ: não muda número de nenhuma outra tela.

const TODOS = "todos";
const num2 = (n: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const dataBr = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—");
const CEL = "px-2 py-1.5 text-right whitespace-nowrap";

function mesCorrente(): string {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}`;
}

function opcoesDeMes(): string[] {
  // Do primeiro mês com movimento de estoque (ago/2026) até o mês corrente.
  const atual = mesCorrente();
  return mesesNoIntervalo("2026-08", atual).reverse();
}

function CartaoEtapa({ titulo, valor, sub, icone, cor }: { titulo: string; valor: string; sub: string; icone: React.ReactNode; cor: string }) {
  return (
    <div className="card-elevated flex min-w-0 flex-1 items-center gap-3 p-3">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${cor}`}>{icone}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{titulo}</p>
        <p className="truncate text-lg font-bold tabular-nums">{valor}</p>
        <p className="text-[11px] text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

const COR_PENDENCIA: Record<Pendencia["nivel"], string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200",
  atencao: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
  info: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200",
};

export default function ConciliacaoEstoque() {
  const { base, setBase, empresaId: empresaLeitura, setEmpresaId } = useLeituraCompartilhada();
  const empresaId = empresaLeitura === TODOS ? null : empresaLeitura;
  const [mesInicio, setMesInicio] = useState(mesCorrente);
  const [mesFim, setMesFim] = useState(mesCorrente);
  const escolherInicio = (m: string) => { setMesInicio(m); if (m > mesFim) setMesFim(m); };
  const escolherFim = (m: string) => { setMesFim(m); if (m < mesInicio) setMesInicio(m); };
  const periodo = rotuloPeriodo(mesInicio, mesFim, rotuloMes);
  const meses = useMemo(opcoesDeMes, []);

  const { data: empresas = [] } = useQuery({
    queryKey: ["conciliacao-estoque-empresas"],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("empresas").select("id, nome").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string }[];
    },
  });
  const { data: contratos = [] } = useContratosConciliacao();
  const nomeDoContrato = useMemo(() => { const m = new Map(contratos.map((c) => [c.id, c.nome])); return (id: string) => m.get(id); }, [contratos]);
  const idsEstoque = useMemo(() => idsContratosEstoque(contratos, empresaId), [contratos, empresaId]);
  const todosIdsEstoque = useMemo(() => new Set(idsContratosEstoque(contratos, null)), [contratos]);

  const { data: compras = [], isLoading: carregandoCompras, error: erroCompras } = useComprasEstoque(idsEstoque, mesInicio, mesFim, base);
  const { data: fisicoResp, isLoading: carregandoFisico, error: erroFisico } = useFisicoConciliacao(mesInicio, mesFim, empresaId);
  const { data: consumo } = useConsumoEstoqueContrato(mesInicio, mesFim);
  const { data: fluxoContratos = [] } = useCustosContratoPeriodo(mesInicio, mesFim, base);
  const gravarFoto = useGravarFotoEstoque();

  const totalCompras = useMemo(() => compras.reduce((s, l) => s + (Number(l.valor) || 0), 0), [compras]);
  const conciliacao = useMemo(() => montarConciliacao(totalCompras, fisicoResp?.fisico ?? null), [totalCompras, fisicoResp]);
  const saidas = useMemo(() => separarSaidas(fisicoResp?.saidas_por_contrato ?? [], nomeDoContrato), [fisicoResp, nomeDoContrato]);
  const apropriado = useMemo(() => { const m = new Map<string, number>(); for (const [id, c] of consumo?.porContrato ?? []) m.set(id, c.valor); return m; }, [consumo]);
  const compraDireta = useMemo(() => compraDiretaPorContrato(fluxoContratos, todosIdsEstoque), [fluxoContratos, todosIdsEstoque]);
  const linhas = useMemo(() => linhasPorContrato(saidas.contratos, apropriado, compraDireta), [saidas, apropriado, compraDireta]);
  const totalApropriado = useMemo(() => linhas.reduce((s, l) => s + l.apropriado, 0), [linhas]);
  const pendencias = useMemo(
    () => montarPendencias({ conciliacao, saidas, linhas, estoqueSemCusto: fisicoResp?.estoque_sem_custo ?? { itens: 0, unidades: 0 }, entradasSemCusto: fisicoResp?.fisico?.entradas_sem_custo ?? 0 }),
    [conciliacao, saidas, linhas, fisicoResp],
  );

  const janela = fisicoResp?.janela;
  const primeiraFoto = fisicoResp?.fotos?.[0] ?? null;
  const ultimaFoto = fisicoResp?.fotos?.length ? fisicoResp.fotos[fisicoResp.fotos.length - 1] : null;
  const carregando = carregandoCompras || carregandoFisico;
  const erro = erroCompras || erroFisico;

  const cascata = conciliacao
    ? [
        { nome: "Estoque inicial", base: 0, valor: conciliacao.estoqueInicial, cor: "#64748b" },
        { nome: "Compras", base: conciliacao.estoqueInicial, valor: conciliacao.compras, cor: "#22c55e" },
        { nome: "Saídas", base: Math.max(0, conciliacao.estoqueInicial + conciliacao.compras - conciliacao.saidas), valor: conciliacao.saidas, cor: "#ef4444" },
        { nome: "Estoque final", base: 0, valor: conciliacao.estoqueContabilFinal, cor: "#2563eb" },
      ]
    : [];

  function exportarCsv() {
    const cab = ["Contrato", "Saída do estoque (R$)", "Consumo de Estoque na Lucratividade (R$)", "Diferença (R$)", "Compra de material direta no contrato (R$)", "Participação"];
    const corpo = linhas.map((l) => [l.contrato, num2(l.saida), num2(l.apropriado), num2(l.diferenca), num2(l.compraDireta), pct(l.participacao)]);
    const extra = [
      ["Saídas para o administrativo", num2(saidas.totalAdministrativo), "", "", "", ""],
      ["Saídas sem contrato identificado", num2(saidas.totalSemContrato), "", "", "", ""],
    ];
    const csv = [cab, ...corpo, ...extra].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    a.download = `conciliacao-estoque-${sufixoArquivo(mesInicio, mesFim)}.csv`;
    a.click();
  }

  const linkCompras = linkFluxoDoRecorte({ base, meses: mesesNoIntervalo(mesInicio, mesFim), empresaId, classificacaoIds: [], contratoIds: idsEstoque, valorEsperado: totalCompras });

  return (
    <div className="space-y-6">
      <PageHeader
        module="Controladoria"
        breadcrumb={["Conciliação de Estoque"]}
        title="Conciliação de Estoque e Custo de Materiais"
        subtitle="Relaciona a compra, o estoque (financeiro e físico), as saídas por contrato e o custo na Lucratividade."
        actions={
          <div className="flex items-center gap-2">
            <AcessoGate menu="conciliacao-estoque-gerir" acao="alterar">
              <Button variant="outline" size="sm" disabled={gravarFoto.isPending}
                onClick={() => gravarFoto.mutate(undefined, {
                  onSuccess: (r) => toast.success(`Foto do estoque gravada em ${dataBr(r.data_ref)} (${r.linhas} itens).`),
                  onError: (e: any) => toast.error(e?.message ?? "Não foi possível gravar a foto do estoque."),
                })}>
                <Camera className="mr-1 h-4 w-4" />Gravar foto do estoque
              </Button>
            </AcessoGate>
            <Button variant="outline" size="sm" onClick={exportarCsv} disabled={!linhas.length}><Download className="mr-1 h-4 w-4" />Exportar CSV</Button>
          </div>
        }
      />

      <div className="card-elevated flex flex-wrap items-center gap-2 p-3 text-xs">
        <span className="text-muted-foreground">De</span>
        <Select value={mesInicio} onValueChange={escolherInicio}>
          <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{meses.map((m) => <SelectItem key={m} value={m}>{rotuloMes(m)}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-muted-foreground">até</span>
        <Select value={mesFim} onValueChange={escolherFim}>
          <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{meses.map((m) => <SelectItem key={m} value={m}>{rotuloMes(m)}</SelectItem>)}</SelectContent>
        </Select>
        <SeletorBaseLeitura base={base} onChange={setBase} />
        <Select value={empresaLeitura} onValueChange={setEmpresaId}>
          <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="Empresa" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas as empresas</SelectItem>
            {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="ml-auto text-muted-foreground">
          {ultimaFoto ? <>Última foto do estoque: <strong>{dataBr(ultimaFoto)}</strong></> : "Nenhuma foto do estoque gravada ainda"}
        </span>
      </div>

      {erro && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">Não foi possível carregar a conciliação: {(erro as Error).message}</p>}

      {carregando ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <>
          {!conciliacao && (
            <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Sem foto do estoque para {periodo}: a conciliação física começa na primeira foto{primeiraFoto ? ` (${dataBr(primeiraFoto)})` : ""}. O saldo do almoxarifado numa data passada não se reconstrói pelos movimentos —
                abaixo aparecem só as compras e as saídas do período. A foto é gravada sozinha no dia 1º de cada mês.
              </span>
            </p>
          )}
          {conciliacao && janela && (janela.foto_inicial !== `${mesInicio}-01` || !janela.fim_agora && !janela.foto_final) && (
            <p className="flex items-start gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                O lado físico vai da foto de <strong>{dataBr(janela.foto_inicial)}</strong> até {janela.fim_agora ? <strong>agora</strong> : <>a foto de <strong>{dataBr(janela.foto_final)}</strong></>}.
                As compras e as saídas por contrato seguem o período escolhido ({periodo}).
              </span>
            </p>
          )}

          <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:items-center">
            <CartaoEtapa titulo="Compras no período" valor={fmtMoney(totalCompras)} sub="Contratos de estoque no Fluxo de Caixa" icone={<ShoppingCart className="h-5 w-5" />} cor="bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" />
            <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground lg:block" />
            <CartaoEtapa titulo="Estoque Adm (contábil)" valor={conciliacao ? fmtMoney(conciliacao.estoqueContabilFinal) : "—"} sub="Inicial + compras − saídas" icone={<Package className="h-5 w-5" />} cor="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" />
            <ArrowLeftRight className="hidden h-4 w-4 shrink-0 text-muted-foreground lg:block" />
            <CartaoEtapa titulo="Estoque Almoxarifado" valor={conciliacao ? fmtMoney(conciliacao.estoqueFisicoFinal) : "—"} sub="Físico, a preço de cadastro" icone={<Warehouse className="h-5 w-5" />} cor="bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" />
            <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground lg:block" />
            <CartaoEtapa titulo="Saídas no período" valor={fmtMoney(saidas.total)} sub="Contratos e administrativo" icone={<ArrowRight className="h-5 w-5" />} cor="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" />
            <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground lg:block" />
            <CartaoEtapa titulo="Custo na Lucratividade" valor={fmtMoney(totalApropriado)} sub="Coluna Consumo de Estoque" icone={<TrendingUp className="h-5 w-5" />} cor="bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" />
          </div>

          {conciliacao && (
            conciliacao.ok ? (
              <div className="flex items-center gap-3 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                <CheckCircle2 className="h-6 w-6 shrink-0" />
                <div><p className="font-semibold">Conciliação do período: OK</p><p className="text-xs">Estoque inicial ({fmtMoney(conciliacao.estoqueInicial)}) + compras ({fmtMoney(conciliacao.compras)}) − saídas ({fmtMoney(conciliacao.saidas)}) = estoque físico ({fmtMoney(conciliacao.estoqueFisicoFinal)}). Não há diferença.</p></div>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertTriangle className="h-6 w-6 shrink-0" />
                <div><p className="font-semibold">Diferença da conciliação: {fmtMoney(conciliacao.diferenca)}</p><p className="text-xs">O Estoque Adm (contábil) dá {fmtMoney(conciliacao.estoqueContabilFinal)} e o almoxarifado tem {fmtMoney(conciliacao.estoqueFisicoFinal)}. A aba Pendências mostra de onde vem a diferença.</p></div>
              </div>
            )
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Evolução do Estoque (R$)</CardTitle></CardHeader>
              <CardContent className="h-[260px]">
                {cascata.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cascata} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="nome" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                      <Tooltip formatter={(v: any, k: any) => (k === "base" ? null : fmtMoney(Number(v)))} />
                      <Bar dataKey="base" stackId="c" fill="transparent" />
                      <Bar dataKey="valor" stackId="c">
                        {cascata.map((c) => <Cell key={c.nome} fill={c.cor} />)}
                        <LabelList dataKey="valor" position="top" formatter={(v: any) => fmtMoney(Number(v))} style={{ fontSize: 10 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <p className="pt-20 text-center text-xs text-muted-foreground">Sem foto do estoque no período.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Resumo da Movimentação no Período</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableBody className="text-xs">
                    <TableRow><TableCell className="px-2 py-1.5"><TituloComFormula alinhar="left" titulo="Estoque inicial" formula="Valor do almoxarifado na foto do início do período, a preço de cadastro. É o ponto de partida do Estoque Adm (contábil)." /></TableCell><TableCell className={CEL}>{conciliacao ? num2(conciliacao.estoqueInicial) : "—"}</TableCell></TableRow>
                    <TableRow><TableCell className="px-2 py-1.5"><TituloComFormula alinhar="left" titulo="(+) Compras de materiais (Fluxo de Caixa)" formula="Saídas do Fluxo de Caixa lançadas nos contratos de estoque (ADMINISTRATIVO - … ESTOQUE), pela base escolhida no topo. É o mesmo valor que hoje o Fechamento da Empresa soma em Outras Despesas." /></TableCell><TableCell className={CEL}><a className="underline decoration-dotted underline-offset-2 hover:text-primary" href={linkCompras}>{num2(totalCompras)}</a></TableCell></TableRow>
                    <TableRow><TableCell className="px-2 py-1.5">(−) Saídas para contratos</TableCell><TableCell className={CEL}>{num2(saidas.totalContratos)}</TableCell></TableRow>
                    <TableRow><TableCell className="px-2 py-1.5">(−) Saídas para administrativo</TableCell><TableCell className={CEL}>{num2(saidas.totalAdministrativo)}</TableCell></TableRow>
                    <TableRow><TableCell className="px-2 py-1.5">(−) Saídas sem contrato identificado</TableCell><TableCell className={CEL}>{num2(saidas.totalSemContrato)}</TableCell></TableRow>
                    <TableRow className="font-semibold"><TableCell className="px-2 py-1.5">(=) Estoque Adm (contábil) final</TableCell><TableCell className={CEL}>{conciliacao ? num2(conciliacao.estoqueContabilFinal) : "—"}</TableCell></TableRow>
                    <TableRow><TableCell className="px-2 py-1.5"><TituloComFormula alinhar="left" titulo="Estoque físico final (Almoxarifado)" formula="Valor do almoxarifado na foto do fim do período (ou agora, se o período chega até hoje), a preço de cadastro — o mesmo preço das Saídas por Contrato." /></TableCell><TableCell className={CEL}>{conciliacao ? num2(conciliacao.estoqueFisicoFinal) : "—"}</TableCell></TableRow>
                    {fisicoResp?.fisico?.final_tela != null && (
                      <TableRow className="text-muted-foreground"><TableCell className="px-2 py-1.5"><TituloComFormula alinhar="left" titulo="Mesmo estoque pelo critério de Estoque & Etiquetas" formula="O card de Estoque & Etiquetas usa, por item, o maior valor entre o cadastro e o custo dos lotes ainda no almoxarifado. A diferença para a linha de cima é só de critério de preço." /></TableCell><TableCell className={CEL}>{num2(fisicoResp.fisico.final_tela)}</TableCell></TableRow>
                    )}
                  </TableBody>
                  <TableFooter>
                    <TableRow className={conciliacao && !conciliacao.ok ? "bg-amber-50 dark:bg-amber-950/30" : "bg-emerald-50 dark:bg-emerald-950/30"}>
                      <TableCell className="px-2 py-1.5 font-semibold">Diferença (Conciliação)</TableCell>
                      <TableCell className={`${CEL} font-semibold`}>{conciliacao ? num2(conciliacao.diferenca) : "—"}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
                {saidas.total !== (conciliacao?.saidas ?? saidas.total) && (
                  <p className="mt-2 text-[11px] text-muted-foreground">As saídas da conta do estoque são as da janela das fotos ({fmtMoney(conciliacao!.saidas)}); as linhas de saída acima são as do período escolhido.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Relação entre as Telas do Sistema</CardTitle></CardHeader>
              <CardContent>
                <ol className="space-y-3 text-xs">
                  <li><strong>1. Estoque Adm (contábil)</strong> — recebe a compra lançada nos contratos de estoque do <Link className="underline" to="/app/financeiro/gestao-financeira/fluxo-caixa">Fluxo de Caixa</Link>; hoje aparece em Outras Despesas do <Link className="underline" to="/app/controladoria/fechamento-empresa">Fechamento da Empresa</Link>.</li>
                  <li><strong>2. Estoque & Etiquetas</strong> — o estoque físico, com itens, quantidades e valores (<Link className="underline" to="/app/suprimentos/estoque-etiquetas">abrir</Link>).</li>
                  <li><strong>3. Saídas por Contrato</strong> — a saída do material para contratos ou administrativo (<Link className="underline" to="/app/suprimentos/dashboard">Suprimentos › Dashboard</Link>).</li>
                  <li><strong>4. Lucratividade de Contratos</strong> — o custo do material que saiu, na coluna Consumo de Estoque (<Link className="underline" to="/app/controladoria/lucratividade-contratos">abrir</Link>). Ainda informativa: não soma no Total de Custos, para não cobrar duas vezes o que foi comprado direto no contrato.</li>
                </ol>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="contratos">
            <TabsList>
              <TabsTrigger value="contratos">Detalhamento por Contrato</TabsTrigger>
              <TabsTrigger value="itens">Movimentação do Estoque (itens)</TabsTrigger>
              <TabsTrigger value="lancamentos">Lançamentos Relacionados</TabsTrigger>
              <TabsTrigger value="pendencias">Pendências ({pendencias.filter((p) => p.nivel === "atencao").length})</TabsTrigger>
            </TabsList>

            <TabsContent value="contratos">
              <div className="card-elevated overflow-x-auto">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contrato</TableHead>
                      <TableHead className="text-right"><TituloComFormula titulo="Saída de materiais (R$)" formula="Da tela Saídas por Contrato, no mesmo período: quantidade × preço de cadastro." /></TableHead>
                      <TableHead className="text-right"><TituloComFormula titulo="Na Lucratividade (R$)" formula="Coluna Consumo de Estoque da Lucratividade de Contratos, no mesmo período." /></TableHead>
                      <TableHead className="text-right">Diferença (R$)</TableHead>
                      <TableHead className="text-right"><TituloComFormula titulo="Compra direta de material (R$)" formula="Compras com classificação de uniforme, EPI, material ou insumo lançadas direto neste contrato no Fluxo de Caixa, no mesmo período. Se também houver saída do estoque, o mesmo tipo de material pode estar sendo cobrado duas vezes." /></TableHead>
                      <TableHead className="text-right">Part. no período</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linhas.map((l) => (
                      <TableRow key={l.contratoId}>
                        <TableCell className="px-2 py-1.5">{l.contrato}</TableCell>
                        <TableCell className={CEL}>{num2(l.saida)}</TableCell>
                        <TableCell className={CEL}>{num2(l.apropriado)}</TableCell>
                        <TableCell className={`${CEL} ${Math.abs(l.diferenca) >= 0.01 ? "font-semibold text-amber-700" : ""}`}>{num2(l.diferenca)}</TableCell>
                        <TableCell className={`${CEL} ${l.compraDireta > 0 ? "text-amber-700" : "text-muted-foreground"}`}>{l.compraDireta ? num2(l.compraDireta) : "—"}</TableCell>
                        <TableCell className={CEL}>{pct(l.participacao)}</TableCell>
                      </TableRow>
                    ))}
                    {!linhas.length && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">Nenhuma saída para contrato no período.</TableCell></TableRow>}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="font-semibold">
                      <TableCell className="px-2 py-1.5">Total dos contratos</TableCell>
                      <TableCell className={CEL}>{num2(saidas.totalContratos)}</TableCell>
                      <TableCell className={CEL}>{num2(totalApropriado)}</TableCell>
                      <TableCell className={CEL}>{num2(saidas.totalContratos - totalApropriado)}</TableCell>
                      <TableCell className={CEL} />
                      <TableCell className={CEL}>100,00%</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
              {(saidas.administrativo.length > 0 || saidas.semContrato.length > 0) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Fora da tabela: saídas para o administrativo {fmtMoney(saidas.totalAdministrativo)} ({saidas.administrativo.map((s) => s.contrato_nome).join(", ") || "—"}) e sem contrato identificado {fmtMoney(saidas.totalSemContrato)}. A Lucratividade não mostra contratos administrativos.
                </p>
              )}
            </TabsContent>

            <TabsContent value="itens">
              <div className="card-elevated max-h-[520px] overflow-auto">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código</TableHead><TableHead>Material</TableHead><TableHead>Tam.</TableHead>
                      <TableHead className="text-right">Inicial</TableHead><TableHead className="text-right">Entradas</TableHead><TableHead className="text-right">Saídas</TableHead>
                      <TableHead className="text-right"><TituloComFormula titulo="Acertos" formula="Final − (inicial + entradas − saídas): o que mudou no almoxarifado sem entrada nem saída registrada (remoção, correção, inventário)." /></TableHead>
                      <TableHead className="text-right">Final</TableHead><TableHead className="text-right">Custo unit.</TableHead><TableHead className="text-right">Valor final</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(fisicoResp?.itens ?? []).map((i) => {
                      const acerto = i.final_qtd - (i.inicial_qtd + i.entrada_qtd - i.saida_qtd);
                      return (
                        <TableRow key={i.item_estoque_id}>
                          <TableCell className="px-2 py-1 font-mono">{i.item_codigo ?? "—"}</TableCell>
                          <TableCell className="px-2 py-1">{i.item_nome ?? "(material removido)"}</TableCell>
                          <TableCell className="px-2 py-1">{i.tamanho ?? "—"}</TableCell>
                          <TableCell className={CEL}>{i.inicial_qtd}</TableCell>
                          <TableCell className={CEL}>{i.entrada_qtd || "—"}</TableCell>
                          <TableCell className={CEL}>{i.saida_qtd || "—"}</TableCell>
                          <TableCell className={`${CEL} ${acerto ? "font-semibold text-amber-700" : "text-muted-foreground"}`}>{acerto || "—"}</TableCell>
                          <TableCell className={CEL}>{i.final_qtd}</TableCell>
                          <TableCell className={`${CEL} ${i.valor_unitario ? "" : "text-amber-700"}`}>{i.valor_unitario ? num2(i.valor_unitario) : "sem custo"}</TableCell>
                          <TableCell className={CEL}>{num2(i.final_valor)}</TableCell>
                        </TableRow>
                      );
                    })}
                    {!fisicoResp?.itens?.length && <TableRow><TableCell colSpan={10} className="py-6 text-center text-muted-foreground">Sem foto do estoque no período.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="lancamentos">
              <div className="card-elevated max-h-[520px] overflow-auto">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow><TableHead>Competência</TableHead><TableHead>Pagamento</TableHead><TableHead>Contrato</TableHead><TableHead>Classificação</TableHead><TableHead>Descrição</TableHead><TableHead className="text-right">Valor (R$)</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...compras].sort((a, b) => (a.mes_base ?? "").localeCompare(b.mes_base ?? "")).map((l, i) => (
                      <TableRow key={`${l.id_malote ?? ""}-${i}`}>
                        <TableCell className="px-2 py-1">{l.competencia ? dataBr(l.competencia) : "—"}</TableCell>
                        <TableCell className="px-2 py-1">{dataBr(l.data_pagamento)}</TableCell>
                        <TableCell className="px-2 py-1">{(l.contrato_id && nomeDoContrato(l.contrato_id)) ?? "—"}</TableCell>
                        <TableCell className="px-2 py-1">{l.classificacao_nome ?? "—"}</TableCell>
                        <TableCell className="max-w-[360px] truncate px-2 py-1" title={l.descricao ?? ""}>{l.id_malote ? `${l.id_malote} · ` : ""}{l.descricao ?? ""}</TableCell>
                        <TableCell className={CEL}>{num2(Number(l.valor))}</TableCell>
                      </TableRow>
                    ))}
                    {!compras.length && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">Nenhuma compra lançada nos contratos de estoque no período.</TableCell></TableRow>}
                  </TableBody>
                  {compras.length > 0 && (
                    <TableFooter><TableRow className="font-semibold"><TableCell colSpan={5} className="px-2 py-1.5">Total · <a className="font-normal underline" href={linkCompras}>ver no Fluxo de Caixa</a></TableCell><TableCell className={CEL}>{num2(totalCompras)}</TableCell></TableRow></TableFooter>
                  )}
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="pendencias">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {pendencias.map((p) => (
                  <div key={p.chave} className={`rounded-md border px-3 py-2 text-xs ${COR_PENDENCIA[p.nivel]}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold">{p.titulo}</p>
                      {p.valor !== 0 && <span className="font-semibold tabular-nums">{fmtMoney(p.valor)}</span>}
                      {p.nivel === "ok" && p.valor === 0 && <CheckCircle2 className="h-4 w-4" />}
                    </div>
                    <p className="mt-1">{p.detalhe}</p>
                  </div>
                ))}
                {fisicoResp?.fisico && Object.keys(fisicoResp.fisico.acertos_conhecidos).length > 0 && (
                  <div className="rounded-md border px-3 py-2 text-xs md:col-span-2">
                    <p className="font-semibold">Movimentos de acerto registrados no intervalo das fotos</p>
                    <p className="mt-1 text-muted-foreground">Ajudam a explicar os acertos; não entram na conta, porque não são um registro fiel do que saiu (por isso a conciliação usa as fotos).</p>
                    <ul className="mt-1 list-disc pl-5">
                      {Object.entries(fisicoResp.fisico.acertos_conhecidos).map(([tipo, a]) => <li key={tipo}>{tipo}: {a.qtd.toLocaleString("pt-BR")} un · {fmtMoney(a.valor)}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
