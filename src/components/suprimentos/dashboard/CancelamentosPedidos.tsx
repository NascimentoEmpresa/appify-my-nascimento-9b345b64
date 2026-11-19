/**
 * Aba Cancelamentos do Dashboard de Compras, Estoque e Saving (SIS-2026-0945).
 *
 * Pedido do Cassio (Compras): quantos pedidos são cancelados no mês, por qual
 * motivo, e o impacto disso no valor e na recompra para quem assume a vaga de
 * quem desistiu. Recebe o recorte por prop, como RotatividadeEstoque e
 * SaidasPorContrato — a faixa de filtros do topo continua sendo a única.
 *
 * Os 70 cancelamentos de antes do SIS-2026-0948 têm o motivo só em texto livre
 * (32 em branco). Eles entram no total como "Registro antigo" e a tabela mostra
 * o texto da época; a tela não adivinha o motivo. Ver o cabeçalho de
 * lib/suprimentos/dashboardCancelamentos para os três escopos (data, valor e
 * novo pedido para a vaga).
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, Clock3, Download, History, PiggyBank, UserRoundX } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AZUL_MAGNITUDE,
  CabecalhoTabela,
  CartaoIndicador,
  CINZA_GRADE,
  EstadoVazio,
  PainelGrafico,
  SERIES,
  TickCategoria,
} from "@/components/suprimentos/dashboard/PainelBase";
import { useDashboardCancelamentos } from "@/hooks/useDashboardCancelamentos";
import { rotuloCategoriaCancelamento } from "@/lib/suprimentos/cancelamentoPedido";
import {
  csvCancelamentos,
  filtrarLinhasCancelamento,
  proporcaoCancelados,
  rotuloMes,
  rotuloSituacaoCancelamento,
} from "@/lib/suprimentos/dashboardCancelamentos";
import { formatarMoeda, formatarNumero } from "@/lib/suprimentos/dashboardComprasEstoque";

const ROTA_PEDIDOS = "/app/suprimentos/pedidos-materiais";

function data(valor: string | null | undefined): string {
  return valor ? new Date(valor).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";
}

function TooltipQuantidadeValor({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { payload?: { nome?: string; quantidade?: number; valor?: number } }[];
  label?: string;
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-lg border bg-white p-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-slate-700">{p.nome ?? label}</p>
      <p className="text-slate-600">Pedidos: {formatarNumero(p.quantidade)}</p>
      <p className="text-slate-600">Valor estimado: {formatarMoeda(p.valor)}</p>
    </div>
  );
}

export function CancelamentosPedidos({
  empresaIds,
  inicio,
  fim,
  contratoId,
  categoria,
}: {
  empresaIds: string[];
  inicio: string;
  fim: string;
  contratoId: string | null;
  categoria: string | null;
}) {
  const consulta = useDashboardCancelamentos({ empresaIds, inicio, fim, contratoId, categoria });
  const [busca, setBusca] = useState("");
  const painel = consulta.data;
  const linhas = useMemo(() => filtrarLinhasCancelamento(painel?.linhas ?? [], busca), [painel?.linhas, busca]);
  const meses = useMemo(
    () => (painel?.por_mes ?? []).map((m) => ({
      ...m,
      rotulo: rotuloMes(m.mes),
      proporcao: proporcaoCancelados(m.cancelados, m.pedidos_criados),
    })),
    [painel?.por_mes],
  );

  if (consulta.isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[116px]" />)}</div>
        <Skeleton className="h-[320px]" />
      </div>
    );
  }
  if (consulta.error || !painel) {
    const mensagem = consulta.error instanceof Error ? consulta.error.message : String((consulta.error as { message?: string } | null)?.message ?? "");
    const semFuncao = /sup_dashboard_cancelamentos_painel|function|schema cache/i.test(mensagem);
    return (
      <Alert variant="destructive">
        <AlertTitle>Não foi possível carregar os cancelamentos</AlertTitle>
        <AlertDescription>
          {semFuncao
            ? "Esta aba depende de uma atualização do banco que ainda não está publicada neste ambiente."
            : mensagem || "Tente novamente em instantes."}
        </AlertDescription>
      </Alert>
    );
  }

  const r = painel.resumo;
  const exportar = () => {
    const url = URL.createObjectURL(
      new Blob(["﻿" + csvCancelamentos(linhas)], { type: "text/csv;charset=utf-8;" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `pedidos-cancelados-${inicio}-a-${fim}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <CartaoIndicador
          titulo="Cancelados no período"
          valor={formatarNumero(r.total)}
          icone={<Ban className="h-6 w-6" />}
          tom="red"
          detalhe={`${formatarNumero(proporcaoCancelados(r.total, r.pedidos_no_periodo), 1)}% dos ${formatarNumero(r.pedidos_no_periodo)} pedidos abertos no período`}
        />
        <CartaoIndicador
          titulo="Valor estimado dos itens"
          valor={formatarMoeda(r.valor)}
          icone={<PiggyBank className="h-6 w-6" />}
          tom="amber"
          detalhe={`${formatarNumero(r.unidades)} unidades pelo preço atual do estoque${r.unidades_sem_preco ? ` · ${formatarNumero(r.unidades_sem_preco)} sem preço cadastrado` : ""}`}
        />
        <CartaoIndicador
          titulo="Novo pedido para a vaga"
          valor={formatarNumero(r.vagas_com_reposicao)}
          icone={<UserRoundX className="h-6 w-6" />}
          tom="violet"
          detalhe={`provável recompra de ${formatarMoeda(r.valor_reposicao)} — desistência e desligamento`}
        />
        <CartaoIndicador
          titulo="Aguardando decisão"
          valor={formatarNumero(r.aguardando_decisao)}
          icone={<Clock3 className="h-6 w-6" />}
          tom="slate"
          detalhe={<>{formatarNumero(r.recusados)} recusados no período · <Link className="font-semibold text-blue-700 underline" to={ROTA_PEDIDOS}>Pedidos de Materiais</Link></>}
        />
        <CartaoIndicador
          titulo="Registros antigos"
          valor={formatarNumero(r.legados)}
          icone={<History className="h-6 w-6" />}
          tom="slate"
          detalhe="cancelados antes do motivo obrigatório (SIS-2026-0948); o texto da época está na tabela"
        />
      </div>

      <p className="rounded-lg bg-blue-50 p-3 text-xs text-blue-950">
        <b>Data do cancelamento</b> é a aprovação pelo Suprimentos; nos registros antigos, o último cancelamento do
        histórico. <b>Valor estimado</b> é quantidade × preço de referência atual do estoque, não o valor pago.
        {" "}<b>Novo pedido para a vaga</b> é provável: o primeiro pedido do mesmo contrato, posto e função feito até 45
        dias depois. O cartão conta só desistência e desligamento; nos registros antigos ele aparece só na tabela.
      </p>

      <PainelGrafico
        titulo="Cancelamentos por mês"
        subtitulo="Barras: pedidos cancelados no mês. Linha: proporção sobre os pedidos abertos no mesmo mês."
      >
        {meses.some((m) => m.cancelados > 0) ? (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={meses} margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CINZA_GRADE} />
                <XAxis dataKey="rotulo" />
                <YAxis yAxisId="qtd" allowDecimals={false} />
                <YAxis yAxisId="pct" orientation="right" tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  formatter={(valor: number, nome: string) =>
                    nome === "Proporção" ? [`${formatarNumero(valor, 1)}%`, nome] : [formatarNumero(valor), nome]}
                />
                <Legend />
                <Bar yAxisId="qtd" dataKey="cancelados" name="Cancelados" fill={SERIES.saida} radius={[4, 4, 0, 0]} />
                <Line yAxisId="pct" dataKey="proporcao" name="Proporção" stroke={SERIES.declarado} strokeWidth={2} dot />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : <EstadoVazio texto="Nenhum pedido cancelado no período." />}
      </PainelGrafico>

      <div className="grid gap-3 xl:grid-cols-2">
        <PainelGrafico titulo="Por motivo" subtitulo="Passe o mouse para ver o valor estimado de cada motivo.">
          {painel.por_motivo.length ? (
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={painel.por_motivo} layout="vertical" margin={{ left: 25, right: 18 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CINZA_GRADE} />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="nome" width={170} interval={0} tick={<TickCategoria maximo={30} />} />
                  <Tooltip content={<TooltipQuantidadeValor />} />
                  <Bar dataKey="quantidade" name="Pedidos" fill={SERIES.saida} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EstadoVazio texto="Nenhum pedido cancelado no período." />}
        </PainelGrafico>
        <PainelGrafico titulo="Por contrato" subtitulo="Os 10 contratos com mais pedidos cancelados no período.">
          {painel.por_contrato.length ? (
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={painel.por_contrato.map((c) => ({ ...c, nome: c.contrato }))}
                  layout="vertical"
                  margin={{ left: 25, right: 18 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CINZA_GRADE} />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="nome" width={170} interval={0} tick={<TickCategoria maximo={30} />} />
                  <Tooltip content={<TooltipQuantidadeValor />} />
                  <Bar dataKey="quantidade" name="Pedidos" fill={AZUL_MAGNITUDE} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EstadoVazio texto="Nenhum pedido cancelado no período." />}
        </PainelGrafico>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <PainelGrafico titulo="Quem pediu o cancelamento">
          {painel.por_origem.length ? (
            <ul className="space-y-2 text-sm">
              {painel.por_origem.map((o) => (
                <li key={o.nome} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <span className="text-slate-700">{o.nome}</span>
                  <span className="font-bold text-slate-950">{formatarNumero(o.quantidade)}</span>
                </li>
              ))}
            </ul>
          ) : <EstadoVazio altura={120} texto="Nenhum pedido cancelado no período." />}
        </PainelGrafico>
        <PainelGrafico
          titulo="Situação do pedido ao cancelar"
          subtitulo="Antes do despacho, a reserva volta ao estoque disponível. Depois do despacho só existe em registro antigo."
        >
          {painel.por_situacao.length ? (
            <ul className="space-y-2 text-sm">
              {painel.por_situacao.map((s) => (
                <li key={s.situacao} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <span className="text-slate-700">{rotuloSituacaoCancelamento(s.situacao)}</span>
                  <span className="whitespace-nowrap text-right">
                    <b className="text-slate-950">{formatarNumero(s.quantidade)}</b>
                    <span className="ml-2 text-xs text-slate-500">{formatarMoeda(s.valor)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : <EstadoVazio altura={120} texto="Nenhum pedido cancelado no período." />}
        </PainelGrafico>
      </div>

      {painel.pendentes.length > 0 && (
        <PainelGrafico
          titulo="Solicitações aguardando o Suprimentos"
          subtitulo="Ainda não contam como cancelados. A decisão é feita em Pedidos de Materiais."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr>
                  <CabecalhoTabela>Pedido</CabecalhoTabela>
                  <CabecalhoTabela>Pedido em</CabecalhoTabela>
                  <CabecalhoTabela>Contrato</CabecalhoTabela>
                  <CabecalhoTabela>Motivo</CabecalhoTabela>
                  <CabecalhoTabela>Solicitado por</CabecalhoTabela>
                </tr>
              </thead>
              <tbody>
                {painel.pendentes.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-3 py-2"><Link className="font-semibold text-blue-700 underline" to={`${ROTA_PEDIDOS}?busca=${encodeURIComponent(p.pedido_id)}`}>{p.pedido_id}</Link></td>
                    <td className="px-3 py-2">{data(p.cancelamento_solicitado_em)}</td>
                    <td className="px-3 py-2">{p.contrato_nome ?? "—"}</td>
                    <td className="px-3 py-2">{rotuloCategoriaCancelamento(p.cancelamento_categoria)}</td>
                    <td className="px-3 py-2">{p.cancelamento_solicitado_por_nome ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PainelGrafico>
      )}

      <PainelGrafico
        titulo="Pedidos cancelados"
        subtitulo={`${formatarNumero(linhas.length)} de ${formatarNumero(painel.linhas.length)} no período, do mais recente para o mais antigo.`}
        acao={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar pedido, contrato, colaborador ou motivo"
              className="h-9 w-full sm:w-72"
              aria-label="Buscar nos pedidos cancelados"
            />
            <AcessoGate menu="sup_dashboard_compras_estoque" acao="exportar">
              <Button variant="outline" size="sm" className="gap-1" disabled={!linhas.length} onClick={exportar}>
                <Download className="h-4 w-4" /> Exportar CSV
              </Button>
            </AcessoGate>
          </div>
        }
      >
        {painel.linhas_truncadas && (
          <p className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
            A tabela mostra os 500 cancelamentos mais recentes. Os cartões e gráficos contam todos; diminua o período
            para ver os demais.
          </p>
        )}
        {linhas.length ? (
          <div className="max-h-[560px] overflow-auto rounded-lg border">
            <table className="w-full min-w-[1180px] text-sm">
              <thead className="sticky top-0">
                <tr>
                  <CabecalhoTabela>Pedido</CabecalhoTabela>
                  <CabecalhoTabela>Cancelado em</CabecalhoTabela>
                  <CabecalhoTabela>Contrato · posto · função</CabecalhoTabela>
                  <CabecalhoTabela>Colaborador</CabecalhoTabela>
                  <CabecalhoTabela>Motivo</CabecalhoTabela>
                  <CabecalhoTabela>Quem pediu / quem decidiu</CabecalhoTabela>
                  <CabecalhoTabela>Situação ao cancelar</CabecalhoTabela>
                  <CabecalhoTabela alinhar="right">Valor estimado</CabecalhoTabela>
                  <CabecalhoTabela>Novo pedido p/ a vaga</CabecalhoTabela>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.id} className="border-b align-top last:border-0">
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link className="font-semibold text-blue-700 underline" to={`${ROTA_PEDIDOS}?busca=${encodeURIComponent(l.pedido_id)}`}>{l.pedido_id}</Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{data(l.cancelado_em)}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">{l.contrato_nome ?? "—"}</p>
                      <p className="text-xs text-slate-500">{[l.posto_nome, l.funcao_nome].filter(Boolean).join(" · ") || "—"}</p>
                    </td>
                    <td className="px-3 py-2">{l.nome_colaborador ?? "—"}</td>
                    <td className="max-w-[280px] px-3 py-2">
                      {l.legado ? <Badge variant="outline" className="mb-1">Registro antigo</Badge> : <p className="font-medium text-slate-800">{l.motivo_nome}</p>}
                      <p className="whitespace-pre-wrap break-words text-xs text-slate-600">{l.detalhe ?? (l.legado ? "Sem texto registrado na época." : "—")}</p>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {!l.legado && <p><span className="text-slate-500">{l.origem_nome}:</span> {l.solicitado_por_nome ?? "—"}</p>}
                      <p><span className="text-slate-500">Decidiu:</span> {l.decidido_por_nome ?? "—"}</p>
                    </td>
                    <td className="px-3 py-2 text-xs">{rotuloSituacaoCancelamento(l.situacao)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {formatarMoeda(l.valor)}
                      {l.unidades_sem_preco > 0 && <p className="text-[11px] text-amber-700">{formatarNumero(l.unidades_sem_preco)} un. sem preço</p>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {l.reposicao_pedido_id ? (
                        <>
                          <Link className="font-semibold text-blue-700 underline" to={`${ROTA_PEDIDOS}?busca=${encodeURIComponent(l.reposicao_pedido_id)}`}>{l.reposicao_pedido_id}</Link>
                          <p className="text-[11px] text-slate-500">{data(l.reposicao_criado_em)} · {formatarMoeda(l.reposicao_valor)}</p>
                        </>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EstadoVazio altura={120} texto={busca ? "Nenhum cancelamento encontrado para a busca." : "Nenhum pedido cancelado no período."} />}
      </PainelGrafico>
    </div>
  );
}
