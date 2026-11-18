import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Download, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAnaliseDespesasGerencial } from "@/hooks/useAnaliseDespesasGerencial";
import { ROTA_FLUXO_CAIXA } from "@/pages/controladoria/fechamento/linkFluxo";
import { TituloComFormula } from "@/pages/controladoria/faturamento/Rentabilidade";
import { baixarExcel, type Celula } from "@/pages/financeiro/conciliacao-servicos/exportarExcel";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { AssinaturaRegra } from "@/pages/malote/AssinaturaRegra";
import { ANALISE_VAZIA, montarComparativo, quebrasConciliam, type LinhaComparativo, type TipoDataDespesa } from "./analiseDespesas";
import type { FiltroGerencial } from "./regras";

// SIS-2026-0893 (etapa 3): despesas por classificação, contrato/centro de custo e origem, comparadas com o período anterior (variação em R$ e %).
type Quebra = "classificacao" | "contrato" | "origem";
const data = (iso: string) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("pt-BR") : "—");
const pctTxt = (v: number | null) => (v === null ? "novo" : `${v > 0 ? "+" : ""}${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

function Variacao({ l }: { l: LinhaComparativo }) {
  const v = l.variacao;
  const cor = v.situacao === "subiu" || v.situacao === "novo" ? "text-red-600" : v.situacao === "caiu" || v.situacao === "zerou" ? "text-emerald-600" : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center justify-end gap-0.5 ${cor}`}>
      {v.situacao === "subiu" || v.situacao === "novo" ? <ArrowUpRight className="h-3 w-3" /> : v.situacao === "caiu" || v.situacao === "zerou" ? <ArrowDownRight className="h-3 w-3" /> : null}
      {fmtMoney(v.valor)} <span className="text-[10px]">({pctTxt(v.pct)})</span>
    </span>
  );
}

export function DespesasPanel({ filtro, tipoData }: { filtro: FiltroGerencial; tipoData: TipoDataDespesa }) {
  const navigate = useNavigate();
  const [quebra, setQuebra] = useState<Quebra>("contrato");
  const { data: analise = ANALISE_VAZIA, isLoading, error } = useAnaliseDespesasGerencial(filtro, tipoData);

  const linhas = useMemo(
    () => montarComparativo(quebra === "classificacao" ? analise.por_classificacao : quebra === "contrato" ? analise.por_contrato : analise.por_origem, analise.total),
    [analise, quebra],
  );
  const conciliado = useMemo(() => quebrasConciliam(analise), [analise]);
  const totalVar = montarComparativo([{ nome: "Total", valor: analise.total, valor_anterior: analise.total_anterior }], analise.total)[0];

  const urlContrato = (contratoId: string | null | undefined) => {
    const q = new URLSearchParams({ tipo: "saida" });
    if (tipoData === "competencia") { q.set("competenciaDe", filtro.ini.slice(0, 7)); q.set("competenciaAte", filtro.fim.slice(0, 7)); } else { q.set("de", filtro.ini); q.set("ate", filtro.fim); }
    if (filtro.empresaId) q.set("empresa", filtro.empresaId);
    if (contratoId) q.set("contrato", contratoId);
    return `${ROTA_FLUXO_CAIXA}?${q.toString()}`;
  };

  async function exportar() {
    const cab: Celula[] = ["Item", "Período atual", "Período anterior", "Variação (R$)", "Variação (%)", "% do total"];
    const mk = (ls: LinhaComparativo[]): Celula[][] => ls.map((l) => [l.nome, l.valor, l.valor_anterior, l.variacao.valor, l.variacao.pct === null ? "novo" : Math.round(l.variacao.pct * 10000) / 100, Math.round(l.pctDoTotal * 10000) / 100]);
    await baixarExcel(
      [
        { nome: "Resumo", linhas: [["Análise de despesas"], ["Base de data", tipoData === "pagamento" ? "Pagamento" : "Competência"], ["Período", `${data(filtro.ini)} a ${data(filtro.fim)}`], ["Período anterior", `${data(analise.periodo_anterior.ini)} a ${data(analise.periodo_anterior.fim)}`], ["Total atual", analise.total], ["Total anterior", analise.total_anterior], ["Variação (R$)", totalVar.variacao.valor]] },
        { nome: "Por classificação", linhas: [cab, ...mk(montarComparativo(analise.por_classificacao, analise.total))] },
        { nome: "Por contrato (centro de custo)", linhas: [cab, ...mk(montarComparativo(analise.por_contrato, analise.total))] },
        { nome: "Por origem", linhas: [cab, ...mk(montarComparativo(analise.por_origem, analise.total))] },
      ],
      `analise-despesas-${filtro.ini}-a-${filtro.fim}.xlsx`,
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base">
          <TituloComFormula alinhar="left" titulo="Análise de Despesas" formula={<><span className="block">Despesas já pagas (mesma regra do indicador Despesas Pagas: fora aplicação, empréstimo, transferência entre contas e demais movimentações financeiras), por classificação, contrato (= centro de custo) e origem.</span><span className="block">Comparação com o período imediatamente anterior: os mesmos N meses logo antes, ou o mesmo número de dias. Variação = atual − anterior; “novo” = não havia despesa no período anterior.</span><AssinaturaRegra chamado="SIS-2026-0893" /></>} />
        </CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Despesas por {tipoData === "pagamento" ? "data de pagamento" : "competência"} (filtro “Despesas por”)</span>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => void exportar()} disabled={analise.total === 0 && analise.total_anterior === 0}><Download className="h-3.5 w-3.5" />Excel</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive">Não foi possível carregar a análise: {(error as { message?: string })?.message ?? "erro desconhecido"}</p>}
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border p-3"><p className="text-[11px] text-muted-foreground">Período atual ({data(filtro.ini)} a {data(filtro.fim)})</p><p className="text-lg font-bold">{fmtMoney(analise.total)}</p><p className="text-[11px] text-muted-foreground">{analise.qtd.toLocaleString("pt-BR")} lançamento(s)</p></div>
          <div className="rounded-md border p-3"><p className="text-[11px] text-muted-foreground">Período anterior ({data(analise.periodo_anterior.ini)} a {data(analise.periodo_anterior.fim)})</p><p className="text-lg font-bold">{fmtMoney(analise.total_anterior)}</p></div>
          <div className="rounded-md border p-3"><p className="text-[11px] text-muted-foreground">Variação</p><p className="text-lg font-bold"><Variacao l={totalVar} /></p></div>
        </div>

        <Tabs value={quebra} onValueChange={(v) => setQuebra(v as Quebra)}>
          <TabsList><TabsTrigger value="contrato">Contrato / Centro de custo</TabsTrigger><TabsTrigger value="classificacao">Classificação</TabsTrigger><TabsTrigger value="origem">Origem</TabsTrigger></TabsList>
        </Tabs>
        <div className="max-h-[55vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{quebra === "contrato" ? "Contrato / Centro de custo" : quebra === "classificacao" ? "Classificação" : "Origem"}</TableHead>
                <TableHead className="text-right">Atual</TableHead><TableHead className="text-right">Anterior</TableHead><TableHead className="text-right">Variação</TableHead><TableHead className="text-right">% do total</TableHead>
                {quebra === "contrato" && <TableHead className="w-8" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">Carregando…</TableCell></TableRow>}
              {!isLoading && linhas.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">Sem despesas pagas no período nem no anterior.</TableCell></TableRow>}
              {linhas.map((l) => (
                <TableRow key={`${l.nome}-${l.contrato_id ?? ""}`}>
                  <TableCell className="text-xs font-medium">{l.nome}</TableCell>
                  <TableCell className="text-right text-xs">{fmtMoney(l.valor)}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">{fmtMoney(l.valor_anterior)}</TableCell>
                  <TableCell className="text-right text-xs"><Variacao l={l} /></TableCell>
                  <TableCell className="text-right text-xs">{(l.pctDoTotal * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</TableCell>
                  {quebra === "contrato" && (
                    <TableCell className="px-1"><button type="button" className="text-muted-foreground hover:text-foreground" title="Ver os lançamentos no Fluxo de Caixa" onClick={() => navigate(urlContrato(l.contrato_id))}><ExternalLink className="h-3.5 w-3.5" /></button></TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
            {linhas.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell className="text-xs font-semibold">Total</TableCell>
                  <TableCell className="text-right text-xs font-semibold">{fmtMoney(analise.total)}</TableCell>
                  <TableCell className="text-right text-xs font-semibold">{fmtMoney(analise.total_anterior)}</TableCell>
                  <TableCell className="text-right text-xs font-semibold"><Variacao l={totalVar} /></TableCell>
                  <TableCell className="text-right text-xs font-semibold">100%</TableCell>
                  {quebra === "contrato" && <TableCell />}
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
        {!conciliado && <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900">Atenção: as três quebras (classificação, contrato e origem) não somam o mesmo total. Confira os lançamentos no Fluxo de Caixa.</p>}
      </CardContent>
    </Card>
  );
}
