import { useMemo, useState, type ReactNode } from "react";
import {
  BarChart3,
  Boxes,
  Clock3,
  FileCheck2,
  FileText,
  PackageCheck,
  PiggyBank,
  RefreshCw,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { useDashboardComprasEstoque } from "@/hooks/useDashboardComprasEstoque";
import {
  classeSituacaoEstoque,
  formatarMoeda,
  formatarNumero,
  percentual,
  rotuloCategoria,
  type DashboardComprasEstoqueDados,
  type FiltroDashboardCompras,
  type ItemMovimentado,
} from "@/lib/suprimentos/dashboardComprasEstoque";
import { cn } from "@/lib/utils";

const AZUIS = ["#0969da", "#2f8fea", "#60a5fa", "#93c5fd", "#bfdbfe"];
const SAUDE_CORES: Record<string, string> = {
  Adequado: "#10b981",
  Atenção: "#f59e0b",
  Baixo: "#ef4444",
  "Sem estoque": "#94a3b8",
};

function dataIso(data: Date): string {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function filtrosIniciais(): FiltroDashboardCompras {
  const hoje = new Date();
  return {
    inicio: `${hoje.getFullYear()}-01-01`,
    fim: dataIso(hoje),
    contratoId: null,
    categoria: null,
    comprador: null,
  };
}

function CartaoIndicador({
  titulo,
  valor,
  detalhe,
  icone,
  tom = "blue",
}: {
  titulo: string;
  valor: ReactNode;
  detalhe?: ReactNode;
  icone: ReactNode;
  tom?: "blue" | "green" | "amber" | "red" | "violet";
}) {
  const tons = {
    blue: "border-blue-100 bg-gradient-to-br from-white to-blue-50 text-blue-700",
    green: "border-emerald-100 bg-gradient-to-br from-white to-emerald-50 text-emerald-700",
    amber: "border-amber-100 bg-gradient-to-br from-white to-amber-50 text-amber-700",
    red: "border-rose-100 bg-gradient-to-br from-white to-rose-50 text-rose-700",
    violet: "border-violet-100 bg-gradient-to-br from-white to-violet-50 text-violet-700",
  };
  return (
    <Card className={cn("overflow-hidden border shadow-sm", tons[tom])}>
      <CardContent className="flex min-h-[116px] items-start gap-3 p-4">
        <div className="mt-0.5 rounded-xl bg-current/10 p-2.5">{icone}</div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-600">{titulo}</p>
          <p className="mt-1 break-words text-2xl font-extrabold tracking-tight text-slate-950">{valor}</p>
          {detalhe && <div className="mt-1.5 text-xs text-slate-500">{detalhe}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function PainelGrafico({ titulo, children, className }: { titulo: string; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("border-slate-200 shadow-sm", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-bold text-blue-950">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function TooltipMoeda({ active, payload, label }: {
  active?: boolean;
  payload?: { dataKey?: string; name?: string; value?: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-white p-2 text-xs shadow-lg">
      {label && <p className="mb-1 font-semibold">{label}</p>}
      {payload.map((p) => <p key={p.dataKey} style={{ color: p.color }}>{p.name}: {formatarMoeda(p.value)}</p>)}
    </div>
  );
}

function EstadoVazio({ texto }: { texto: string }) {
  return <div className="flex h-[220px] items-center justify-center text-sm text-slate-500">{texto}</div>;
}

function CabecalhoTabela({ children }: { children: ReactNode }) {
  return <th className="whitespace-nowrap border-b bg-slate-50 px-3 py-2 text-left text-[11px] font-bold text-slate-600">{children}</th>;
}

function statusPedido(status: string) {
  const mapa: Record<string, string> = {
    DESPACHADO: "bg-emerald-100 text-emerald-700",
    "AGUARDANDO COMPRA": "bg-amber-100 text-amber-700",
    "AGUARDANDO ENVIO": "bg-blue-100 text-blue-700",
    "EM PREPARACAO": "bg-violet-100 text-violet-700",
    CANCELADO: "bg-rose-100 text-rose-700",
  };
  return mapa[status] ?? "bg-slate-100 text-slate-700";
}

function TabelaSolicitacoes({ dados }: { dados: DashboardComprasEstoqueDados }) {
  return (
    <PainelGrafico titulo="Solicitações Recentes">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr><CabecalhoTabela>ID</CabecalhoTabela><CabecalhoTabela>Data</CabecalhoTabela><CabecalhoTabela>Contrato</CabecalhoTabela><CabecalhoTabela>Itens solicitados</CabecalhoTabela><CabecalhoTabela>Solicitante</CabecalhoTabela><CabecalhoTabela>Status</CabecalhoTabela><CabecalhoTabela>Tempo</CabecalhoTabela></tr></thead>
          <tbody>
            {dados.solicitacoes_recentes.map((linha) => (
              <tr key={linha.id} className="border-b last:border-0 hover:bg-slate-50">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-blue-700">{linha.id}</td>
                <td className="whitespace-nowrap px-3 py-2">{new Date(`${linha.data}T12:00:00`).toLocaleDateString("pt-BR")}</td>
                <td className="max-w-40 truncate px-3 py-2" title={linha.contrato}>{linha.contrato}</td>
                <td className="max-w-64 truncate px-3 py-2" title={linha.item}>{linha.item}</td>
                <td className="whitespace-nowrap px-3 py-2">{linha.solicitante}</td>
                <td className="px-3 py-2"><Badge className={cn("border-0 text-[10px]", statusPedido(linha.status))}>{linha.status}</Badge></td>
                <td className="whitespace-nowrap px-3 py-2">{formatarNumero(linha.tempo_dias, 1)} dias</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!dados.solicitacoes_recentes.length && <EstadoVazio texto="Nenhuma solicitação no período." />}
      </div>
    </PainelGrafico>
  );
}

function TabelaCotacoes({ dados }: { dados: DashboardComprasEstoqueDados }) {
  return (
    <PainelGrafico titulo="Cotações Realizadas">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr><CabecalhoTabela>ID</CabecalhoTabela><CabecalhoTabela>Data</CabecalhoTabela><CabecalhoTabela>Contrato</CabecalhoTabela><CabecalhoTabela>Solicitação</CabecalhoTabela><CabecalhoTabela>Comprador</CabecalhoTabela><CabecalhoTabela>Qtd. cotações</CabecalhoTabela><CabecalhoTabela>Origem</CabecalhoTabela><CabecalhoTabela>Status</CabecalhoTabela></tr></thead>
          <tbody>
            {dados.cotacoes_recentes.map((linha) => (
              <tr key={`${linha.id}-${linha.data}`} className="border-b last:border-0 hover:bg-slate-50">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-blue-700">{linha.id}</td>
                <td className="whitespace-nowrap px-3 py-2">{new Date(linha.data).toLocaleDateString("pt-BR")}</td>
                <td className="max-w-36 truncate px-3 py-2" title={linha.contrato ?? ""}>{linha.contrato ?? "—"}</td>
                <td className="max-w-52 truncate px-3 py-2" title={linha.item}>{linha.item}</td>
                <td className="whitespace-nowrap px-3 py-2">{linha.comprador ?? "—"}</td>
                <td className="text-center px-3 py-2">{linha.qtd_cotacoes}</td>
                <td className="px-3 py-2"><Badge variant="outline">{linha.licitacao ? "Licitação" : "Malote"}</Badge></td>
                <td className="whitespace-nowrap px-3 py-2">{linha.status.replace(/_/g, " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!dados.cotacoes_recentes.length && <EstadoVazio texto="Nenhuma cotação no período." />}
      </div>
    </PainelGrafico>
  );
}

function CardsSolicitacoes({ dados }: { dados: DashboardComprasEstoqueDados }) {
  const r = dados.resumo;
  return (
    <>
      <CartaoIndicador titulo="Solicitações realizadas" valor={formatarNumero(r.solicitacoes)} icone={<FileText className="h-6 w-6" />} detalhe="no período selecionado" />
      <CartaoIndicador titulo="Despachadas" valor={formatarNumero(r.despachadas)} icone={<PackageCheck className="h-6 w-6" />} tom="green" detalhe={`${percentual(r.despachadas, r.solicitacoes)}% das solicitações`} />
      <CartaoIndicador titulo="Pendentes" valor={formatarNumero(r.pendentes)} icone={<Clock3 className="h-6 w-6" />} tom="amber" detalhe="em preparação, compra ou envio" />
      <CartaoIndicador titulo="Tempo médio de atendimento" valor={`${formatarNumero(r.tempo_medio_dias, 1)} dias`} icone={<Clock3 className="h-6 w-6" />} detalhe="da solicitação ao despacho" />
    </>
  );
}

function CardsCotacoes({ dados }: { dados: DashboardComprasEstoqueDados }) {
  const r = dados.resumo;
  return (
    <>
      <CartaoIndicador titulo="Cotações realizadas" valor={formatarNumero(r.cotacoes)} icone={<FileCheck2 className="h-6 w-6" />} tom="violet" detalhe="Malote + solicitações de Licitações" />
      <CartaoIndicador titulo="Média por solicitação" valor={formatarNumero(r.media_cotacoes, 1)} icone={<BarChart3 className="h-6 w-6" />} detalhe="propostas registradas no Malote" />
      <CartaoIndicador titulo="Participação de licitações" valor={`${formatarNumero(r.participacao_licitacoes, 1)}%`} icone={<ShoppingCart className="h-6 w-6" />} tom="red" detalhe={`${formatarNumero(r.licitacoes)} cotações de Licitações`} />
    </>
  );
}

function GraficosSolicitacoes({ dados }: { dados: DashboardComprasEstoqueDados }) {
  return (
    <>
      <div className="grid gap-3 xl:grid-cols-3">
        <PainelGrafico titulo="Solicitações por Contrato (Quantidade)">
          {dados.solicitacoes_por_contrato.length ? <div className="h-[260px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={dados.solicitacoes_por_contrato} layout="vertical" margin={{ left: 20, right: 18 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="nome" width={105} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="quantidade" name="Solicitações" fill="#2f8fea" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div> : <EstadoVazio texto="Sem solicitações para exibir." />}
        </PainelGrafico>
        <PainelGrafico titulo="Motivos das Pendências">
          {dados.motivos_pendencias.length ? <div className="h-[260px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={dados.motivos_pendencias} layout="vertical" margin={{ left: 25, right: 18 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="nome" width={115} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="quantidade" name="Pendências" fill="#ef8888" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div> : <EstadoVazio texto="Nenhuma pendência no período." />}
        </PainelGrafico>
          <PainelGrafico titulo="Cotações por Comprador">
          {dados.cotacoes_por_comprador.length ? <div className="h-[260px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={dados.cotacoes_por_comprador} layout="vertical" margin={{ left: 10, right: 18 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="nome" width={95} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="quantidade" name="Cotações" fill="#2f8fea" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div> : <EstadoVazio texto="Nenhum comprador no período." />}
        </PainelGrafico>
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <PainelGrafico titulo="Quantidade de Cotações por Solicitação">
          {dados.cotacoes_por_solicitacao.length ? <div className="h-[260px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={dados.cotacoes_por_solicitacao} dataKey="quantidade" nameKey="nome" innerRadius={58} outerRadius={92} paddingAngle={2}>{dados.cotacoes_por_solicitacao.map((_, i) => <Cell key={i} fill={AZUIS[i % AZUIS.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div> : <EstadoVazio texto="Nenhuma cotação do Malote no período." />}
        </PainelGrafico>
        <PainelGrafico titulo="Participação das Licitações nas Cotações">
          <div className="relative h-[260px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ nome: "Cotações de Licitações", valor: dados.resumo.licitacoes }, { nome: "Outras cotações", valor: Math.max(0, dados.resumo.cotacoes - dados.resumo.licitacoes) }]} dataKey="valor" nameKey="nome" innerRadius={63} outerRadius={92}><Cell fill="#2f8fea" /><Cell fill="#d9e1ea" /></Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className="text-center"><p className="text-2xl font-extrabold text-blue-950">{formatarNumero(dados.resumo.participacao_licitacoes, 1)}%</p><p className="text-xs text-slate-500">Licitações</p></div></div></div>
        </PainelGrafico>
        <PainelGrafico titulo="Evolução das Solicitações e Cotações">
          {dados.evolucao.length ? <div className="h-[260px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={dados.evolucao}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="rotulo" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Line type="monotone" dataKey="solicitacoes" name="Solicitações" stroke="#0969da" strokeWidth={2.5} /><Line type="monotone" dataKey="cotacoes" name="Cotações" stroke="#159957" strokeWidth={2.5} /></LineChart></ResponsiveContainer></div> : <EstadoVazio texto="Sem evolução para exibir." />}
        </PainelGrafico>
      </div>
    </>
  );
}

function TabelaMovimentacao({ titulo, linhas }: { titulo: string; linhas: ItemMovimentado[] }) {
  return (
    <PainelGrafico titulo={titulo}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr><CabecalhoTabela>#</CabecalhoTabela><CabecalhoTabela>Item</CabecalhoTabela><CabecalhoTabela>Categoria</CabecalhoTabela><CabecalhoTabela>Qtde. movimentada</CabecalhoTabela><CabecalhoTabela>Valor em estoque</CabecalhoTabela></tr></thead>
          <tbody>{linhas.map((linha, i) => <tr key={`${linha.item}-${i}`} className="border-b last:border-0"><td className="px-3 py-2">{i + 1}</td><td className="px-3 py-2 font-medium">{linha.item}</td><td className="px-3 py-2">{rotuloCategoria(linha.categoria)}</td><td className="px-3 py-2 text-right">{formatarNumero(linha.quantidade)}</td><td className="px-3 py-2 text-right">{formatarMoeda(linha.valor_total)}</td></tr>)}</tbody>
        </table>
        {!linhas.length && <EstadoVazio texto="Nenhuma movimentação no período." />}
      </div>
    </PainelGrafico>
  );
}

function TelaEstoqueSaving({ dados }: { dados: DashboardComprasEstoqueDados }) {
  const e = dados.estoque_resumo;
  const s = dados.saving_resumo;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CartaoIndicador titulo="Valor total do estoque" valor={formatarMoeda(e.valor_total)} icone={<PiggyBank className="h-6 w-6" />} tom="green" detalhe={`${formatarNumero(e.itens_distintos)} itens distintos`} />
        <CartaoIndicador titulo="Quantidade disponível" valor={formatarNumero(e.quantidade_itens)} icone={<Boxes className="h-6 w-6" />} detalhe="unidades livres de reserva" />
        <CartaoIndicador titulo="Entradas no período" valor={formatarNumero(e.entradas)} icone={<TrendingUp className="h-6 w-6" />} tom="amber" detalhe="entradas + devoluções" />
        <CartaoIndicador titulo="Saídas no período" valor={formatarNumero(e.saidas)} icone={<TrendingDown className="h-6 w-6" />} tom="red" detalhe="saídas + remoções" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <CartaoIndicador titulo="Saving total" valor={formatarMoeda(s.total)} icone={<PiggyBank className="h-6 w-6" />} tom="violet" detalhe="valor inicial menos cotação aprovada" />
        <CartaoIndicador titulo="Saving na implantação" valor={formatarMoeda(s.implantacao)} icone={<BarChart3 className="h-6 w-6" />} detalhe="solicitações identificadas como implantação" />
        <CartaoIndicador titulo="Saving em execução" valor={formatarMoeda(s.execucao)} icone={<TrendingUp className="h-6 w-6" />} tom="green" detalhe="demais contratos e solicitações" />
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <PainelGrafico titulo="Valor do Estoque por Categoria">
          {dados.estoque_por_categoria.length ? <div className="h-[250px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={dados.estoque_por_categoria} layout="vertical" margin={{ left: 15, right: 20 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={(v) => `R$ ${Math.round(v / 1000)} mil`} /><YAxis type="category" dataKey="nome" width={90} tick={{ fontSize: 10 }} /><Tooltip content={<TooltipMoeda />} /><Bar dataKey="valor" name="Valor" fill="#3495ed" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div> : <EstadoVazio texto="Nenhum item em estoque." />}
        </PainelGrafico>
        <PainelGrafico titulo="Saúde do Estoque (por item)">
          {dados.saude_estoque.length ? <div className="h-[250px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={dados.saude_estoque} dataKey="quantidade" nameKey="nome" innerRadius={58} outerRadius={90}>{dados.saude_estoque.map((x) => <Cell key={x.nome} fill={SAUDE_CORES[x.nome] ?? "#94a3b8"} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div> : <EstadoVazio texto="Nenhum item em estoque." />}
        </PainelGrafico>
        <PainelGrafico titulo="Movimentação do Estoque">
          {dados.evolucao.length ? <div className="h-[250px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={dados.evolucao}><defs><linearGradient id="entrada" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.35}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient><linearGradient id="saida" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/><stop offset="95%" stopColor="#ef4444" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="rotulo" tick={{ fontSize: 10 }} /><YAxis /><Tooltip /><Legend /><Area type="monotone" dataKey="entradas" name="Entradas" stroke="#10b981" fill="url(#entrada)" /><Area type="monotone" dataKey="saidas" name="Saídas" stroke="#ef4444" fill="url(#saida)" /></AreaChart></ResponsiveContainer></div> : <EstadoVazio texto="Sem movimentações no período." />}
        </PainelGrafico>
      </div>
      <div className="grid gap-3 xl:grid-cols-2"><TabelaMovimentacao titulo="Top 10 Itens Mais Movimentados" linhas={dados.mais_movimentados} /><TabelaMovimentacao titulo="Top 10 Itens Menos Movimentados" linhas={dados.menos_movimentados} /></div>
      <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr]">
        <PainelGrafico titulo="Estoque Detalhado">
          <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><CabecalhoTabela>Item</CabecalhoTabela><CabecalhoTabela>Categoria</CabecalhoTabela><CabecalhoTabela>Disponível</CabecalhoTabela><CabecalhoTabela>Reservado</CabecalhoTabela><CabecalhoTabela>Valor unitário</CabecalhoTabela><CabecalhoTabela>Valor total</CabecalhoTabela><CabecalhoTabela>Situação</CabecalhoTabela></tr></thead><tbody>{dados.estoque_detalhado.map((linha, i) => <tr key={`${linha.item}-${i}`} className="border-b last:border-0"><td className="max-w-48 truncate px-3 py-2 font-medium" title={linha.item}>{linha.item}</td><td className="px-3 py-2">{rotuloCategoria(linha.categoria)}</td><td className="px-3 py-2 text-right">{formatarNumero(linha.disponivel)}</td><td className="px-3 py-2 text-right">{formatarNumero(linha.reservado)}</td><td className="px-3 py-2 text-right">{formatarMoeda(linha.valor_unitario)}</td><td className="px-3 py-2 text-right font-medium">{formatarMoeda(linha.valor_total)}</td><td className="px-3 py-2"><Badge className={cn("border-0 text-[10px]", classeSituacaoEstoque(linha.situacao))}>{linha.situacao}</Badge></td></tr>)}</tbody></table>{!dados.estoque_detalhado.length && <EstadoVazio texto="Nenhum item em estoque." />}</div>
        </PainelGrafico>
        <PainelGrafico titulo="Saving por Contrato">
          <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><CabecalhoTabela>Contrato</CabecalhoTabela><CabecalhoTabela>Valor inicial</CabecalhoTabela><CabecalhoTabela>Valor comprado</CabecalhoTabela><CabecalhoTabela>Saving</CabecalhoTabela><CabecalhoTabela>Saving %</CabecalhoTabela></tr></thead><tbody>{dados.saving_por_contrato.map((linha) => <tr key={linha.contrato} className="border-b last:border-0"><td className="max-w-48 truncate px-3 py-2 font-medium" title={linha.contrato}>{linha.contrato}</td><td className="px-3 py-2 text-right">{formatarMoeda(linha.valor_inicial)}</td><td className="px-3 py-2 text-right">{formatarMoeda(linha.valor_comprado)}</td><td className="px-3 py-2 text-right font-semibold text-emerald-700">{formatarMoeda(linha.saving)}</td><td className="px-3 py-2 text-right font-semibold text-emerald-700">{formatarNumero(linha.percentual, 1)}%</td></tr>)}</tbody></table>{!dados.saving_por_contrato.length && <EstadoVazio texto="Nenhuma cotação aprovada com saving no período." />}</div>
        </PainelGrafico>
      </div>
    </div>
  );
}

function Carregando() {
  return <div className="space-y-3"><div className="grid gap-3 md:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div><div className="grid gap-3 md:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-72" />)}</div><Skeleton className="h-72" /></div>;
}

export default function DashboardComprasEstoque() {
  const { empresa } = useEmpresaAtiva();
  const [filtros, setFiltros] = useState<FiltroDashboardCompras>(filtrosIniciais);
  const consulta = useDashboardComprasEstoque(empresa?.id, filtros);
  const dados = consulta.data;
  const atualizado = useMemo(() => dados?.atualizado_em ? new Date(dados.atualizado_em).toLocaleString("pt-BR") : "—", [dados?.atualizado_em]);
  const trocar = <K extends keyof FiltroDashboardCompras>(campo: K, valor: FiltroDashboardCompras[K]) => setFiltros((f) => ({ ...f, [campo]: valor }));

  return (
    <AcessoGate menu="sup_dashboard_compras_estoque" acao="visualizar" fallback={<Alert><AlertTitle>Acesso não liberado</AlertTitle><AlertDescription>Solicite acesso ao Dashboard de Compras, Estoque e Saving no Gerenciamento de Acesso.</AlertDescription></Alert>}>
      <div className="min-h-full space-y-3 bg-slate-50/70 p-3 md:p-5">
        <div className="rounded-xl bg-gradient-to-r from-[#062b53] via-[#0a4d88] to-[#0d75c5] p-5 text-white shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3"><div className="rounded-xl bg-white/15 p-3"><ShoppingCart className="h-8 w-8" /></div><div><h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Compras, Estoque e Solicitações</h1><p className="mt-1 text-sm text-blue-100">Visão executiva com dados reais do Suprimentos, Malote e Licitações</p></div></div>
            <div className="text-right text-xs text-blue-100"><p>Última atualização</p><p className="font-semibold text-white">{atualizado}</p><p className="mt-1">{empresa?.razao}</p></div>
          </div>
        </div>

        <Card className="border-slate-200 shadow-sm"><CardContent className="p-3"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <div><label className="mb-1 block text-xs font-semibold text-slate-700">Início</label><Input type="date" value={filtros.inicio} max={filtros.fim} onChange={(e) => trocar("inicio", e.target.value)} /></div>
          <div><label className="mb-1 block text-xs font-semibold text-slate-700">Fim</label><Input type="date" value={filtros.fim} min={filtros.inicio} onChange={(e) => trocar("fim", e.target.value)} /></div>
          <div><label className="mb-1 block text-xs font-semibold text-slate-700">Contrato</label><Select value={filtros.contratoId ?? "todos"} onValueChange={(v) => trocar("contratoId", v === "todos" ? null : v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todos</SelectItem>{dados?.filtros.contratos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent></Select></div>
          <div><label className="mb-1 block text-xs font-semibold text-slate-700">Categoria</label><Select value={filtros.categoria ?? "todas"} onValueChange={(v) => trocar("categoria", v === "todas" ? null : v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todas">Todas</SelectItem>{dados?.filtros.categorias.map((c) => <SelectItem key={c.valor} value={c.valor}>{c.nome}</SelectItem>)}</SelectContent></Select></div>
          <div><label className="mb-1 block text-xs font-semibold text-slate-700">Comprador responsável</label><Select value={filtros.comprador ?? "todos"} onValueChange={(v) => trocar("comprador", v === "todos" ? null : v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todos</SelectItem>{dados?.filtros.compradores.map((nome) => <SelectItem key={nome} value={nome}>{nome}</SelectItem>)}</SelectContent></Select></div>
          <div className="flex items-end"><Button variant="outline" className="w-full" onClick={() => consulta.refetch()} disabled={consulta.isFetching}><RefreshCw className={cn("mr-2 h-4 w-4", consulta.isFetching && "animate-spin")} />Atualizar</Button></div>
        </div></CardContent></Card>

        {consulta.isLoading && <Carregando />}
        {consulta.error && <Alert variant="destructive"><AlertTitle>Não foi possível carregar o dashboard</AlertTitle><AlertDescription>{(consulta.error as Error).message}. Se a migration do SIS-2026-0607 ainda não foi aplicada no Supabase, execute-a antes de abrir esta tela.</AlertDescription></Alert>}
        {dados && <Tabs defaultValue="geral" className="space-y-3">
          <TabsList className="grid h-auto w-full grid-cols-3 rounded-xl bg-white p-1 shadow-sm"><TabsTrigger value="geral" className="gap-2 py-2.5"><BarChart3 className="h-4 w-4" /><span className="hidden sm:inline">Visão Geral</span></TabsTrigger><TabsTrigger value="solicitacoes" className="gap-2 py-2.5"><FileText className="h-4 w-4" /><span className="hidden sm:inline">Solicitações e Compras</span></TabsTrigger><TabsTrigger value="estoque" className="gap-2 py-2.5"><Boxes className="h-4 w-4" /><span className="hidden sm:inline">Estoque e Saving</span></TabsTrigger></TabsList>
          <TabsContent value="geral" className="space-y-3"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8"><CartaoIndicador titulo="Solicitações" valor={formatarNumero(dados.resumo.solicitacoes)} icone={<FileText className="h-6 w-6" />} /><CartaoIndicador titulo="Pendentes" valor={formatarNumero(dados.resumo.pendentes)} icone={<Clock3 className="h-6 w-6" />} tom="amber" /><CartaoIndicador titulo="Despachadas" valor={formatarNumero(dados.resumo.despachadas)} icone={<PackageCheck className="h-6 w-6" />} tom="green" /><CartaoIndicador titulo="Tempo médio" valor={`${formatarNumero(dados.resumo.tempo_medio_dias, 1)} dias`} icone={<Clock3 className="h-6 w-6" />} /><CartaoIndicador titulo="Cotações" valor={formatarNumero(dados.resumo.cotacoes)} icone={<FileCheck2 className="h-6 w-6" />} tom="violet" /><CartaoIndicador titulo="Saving" valor={formatarMoeda(dados.saving_resumo.total)} icone={<PiggyBank className="h-6 w-6" />} tom="green" /><CartaoIndicador titulo="Saving %" valor={`${formatarNumero(percentual(dados.saving_resumo.total, dados.saving_por_contrato.reduce((s, x) => s + Number(x.valor_inicial), 0)), 1)}%`} icone={<TrendingUp className="h-6 w-6" />} tom="green" /><CartaoIndicador titulo="Estoque" valor={formatarMoeda(dados.estoque_resumo.valor_total)} icone={<Boxes className="h-6 w-6" />} /></div><div className="grid gap-3 xl:grid-cols-3"><PainelGrafico titulo="Solicitações por Contrato"><div className="h-[260px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={dados.solicitacoes_por_contrato.slice(0, 6)}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="nome" tick={{ fontSize: 9 }} interval={0} angle={-15} height={54} /><YAxis /><Tooltip /><Legend /><Bar dataKey="quantidade" name="Solicitações" fill="#0969da" /><Bar dataKey="despachadas" name="Despachadas" fill="#60a5fa" /><Bar dataKey="pendentes" name="Pendentes" fill="#94a3b8" /></BarChart></ResponsiveContainer></div></PainelGrafico><PainelGrafico titulo="Saving por Contrato"><div className="h-[260px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={dados.saving_por_contrato.slice(0, 6)}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="contrato" tick={{ fontSize: 9 }} interval={0} angle={-15} height={54} /><YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} /><Tooltip content={<TooltipMoeda />} /><Bar dataKey="saving" name="Saving" fill="#0969da" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></PainelGrafico><PainelGrafico titulo="Motivos das Pendências"><div className="h-[260px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={dados.motivos_pendencias} dataKey="quantidade" nameKey="nome" innerRadius={60} outerRadius={90}>{dados.motivos_pendencias.map((_, i) => <Cell key={i} fill={AZUIS[i % AZUIS.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div></PainelGrafico></div><div className="grid gap-3 xl:grid-cols-[1.3fr_0.7fr]"><PainelGrafico titulo="Movimentação de Estoque (Entradas x Saídas)"><div className="h-[250px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={dados.evolucao}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="rotulo" /><YAxis /><Tooltip /><Legend /><Bar dataKey="entradas" name="Entradas" fill="#0969da" /><Bar dataKey="saidas" name="Saídas" fill="#60a5fa" /></BarChart></ResponsiveContainer></div></PainelGrafico><PainelGrafico titulo="Resumo do Estoque"><div className="grid h-[250px] grid-cols-2 items-center gap-3"><div className="rounded-xl border bg-blue-50 p-4 text-center"><Boxes className="mx-auto h-7 w-7 text-blue-600" /><p className="mt-2 text-xs text-slate-500">Itens disponíveis</p><p className="text-2xl font-extrabold text-blue-950">{formatarNumero(dados.estoque_resumo.quantidade_itens)}</p></div><div className="rounded-xl border bg-emerald-50 p-4 text-center"><PiggyBank className="mx-auto h-7 w-7 text-emerald-600" /><p className="mt-2 text-xs text-slate-500">Valor total</p><p className="text-xl font-extrabold text-blue-950">{formatarMoeda(dados.estoque_resumo.valor_total)}</p></div></div></PainelGrafico></div></TabsContent>
          <TabsContent value="solicitacoes" className="space-y-3"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7"><CardsSolicitacoes dados={dados} /><CardsCotacoes dados={dados} /></div><GraficosSolicitacoes dados={dados} /><div className="grid gap-3 xl:grid-cols-2"><TabelaSolicitacoes dados={dados} /><TabelaCotacoes dados={dados} /></div></TabsContent>
          <TabsContent value="estoque"><TelaEstoqueSaving dados={dados} /></TabsContent>
        </Tabs>}
      </div>
    </AcessoGate>
  );
}
