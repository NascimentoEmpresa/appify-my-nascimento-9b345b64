import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Info,
  PackageSearch,
  Repeat,
  Ruler,
  Shirt,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AZUL_MAGNITUDE,
  CINZA_GRADE,
  CabecalhoTabela,
  TickCategoria,
  formatarEixoMoeda,
  CartaoDestaque,
  CartaoIndicador,
  EstadoVazio,
  PainelGrafico,
  SERIES,
} from "@/components/suprimentos/dashboard/PainelBase";
import { useDashboardRotatividadeEstoque } from "@/hooks/useDashboardRotatividadeEstoque";
import { formatarMoeda, formatarNumero } from "@/lib/suprimentos/dashboardComprasEstoque";
import {
  avisoMovimento,
  classeSituacaoCobertura,
  classeSituacaoGiro,
  compararGrade,
  coberturaDePreco,
  formatarCobertura,
  formatarGap,
  formatarGiro,
  formatarPercentual,
  maiorDesalinhamento,
  rotuloSituacaoCobertura,
  rotuloSituacaoGiro,
  situacaoCobertura,
  situacaoGiro,
  type RotatividadeEstoqueDados,
} from "@/lib/suprimentos/rotatividadeEstoque";
import { cn } from "@/lib/utils";

/**
 * Aba "Rotatividade do Estoque".
 *
 * Responde, nesta ordem, o que a diretoria pediu: qual tamanho mais sai, qual
 * mais entra, qual mais roda dentro do estoque, por contrato, com valor e ao
 * longo do tempo. E fecha com a comparação que só o levantamento de uniformes
 * permite: a grade que a equipe declara vestir contra a que de fato sai.
 *
 * Período, empresa e contrato vêm do filtro da página, compartilhados com as
 * outras abas. A CATEGORIA é local: a aba abre em Uniformes porque foi o que
 * o diretor pediu, enquanto o filtro global da página segue em "Todas" para
 * não mexer no que as outras abas mostram.
 */

interface Props {
  empresaId: string | null;
  inicio: string;
  fim: string;
  contratoId: string | null;
}

/** Tooltip padrão: marca colorida + nome em tinta de texto, nunca na cor da série. */
function TooltipPadrao({
  active,
  payload,
  label,
  sufixo = "",
}: {
  active?: boolean;
  payload?: { dataKey?: string; name?: string; value?: number; color?: string }[];
  label?: string;
  sufixo?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-white p-2 text-xs shadow-lg">
      {label && <p className="mb-1 font-semibold text-slate-700">{label}</p>}
      {payload.map((p) => (
        <p key={p.dataKey} className="text-slate-600">
          <span
            className="mr-1 inline-block h-2 w-2 rounded-sm align-middle"
            style={{ background: p.color }}
          />
          {p.name}: {formatarNumero(p.value)}
          {sufixo}
        </p>
      ))}
    </div>
  );
}

function TooltipPercentual(props: Parameters<typeof TooltipPadrao>[0]) {
  if (!props.active || !props.payload?.length) return null;
  return (
    <div className="rounded-lg border bg-white p-2 text-xs shadow-lg">
      {props.label && <p className="mb-1 font-semibold text-slate-700">{props.label}</p>}
      {props.payload.map((p) => (
        <p key={p.dataKey} className="text-slate-600">
          <span
            className="mr-1 inline-block h-2 w-2 rounded-sm align-middle"
            style={{ background: p.color }}
          />
          {p.name}: {formatarPercentual(p.value)}
        </p>
      ))}
    </div>
  );
}

const ICONE_ALERTA: Record<string, typeof AlertTriangle> = {
  grade_sem_declaracao: Ruler,
  declarado_sem_estoque: Users,
  sem_preco: Info,
  catalogo_duplicado: PackageSearch,
};

function BlocoAlertas({ dados }: { dados: RotatividadeEstoqueDados }) {
  if (!dados.alertas.length) return null;
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      {dados.alertas.map((alerta) => {
        const Icone = ICONE_ALERTA[alerta.tipo] ?? AlertTriangle;
        return (
          <Alert key={alerta.tipo} className="border-amber-200 bg-amber-50/70">
            <Icone className="h-4 w-4 text-amber-700" />
            <AlertTitle className="text-sm text-amber-900">
              {alerta.titulo}
              {alerta.unidades > 0 && (
                <span className="ml-2 font-mono text-xs font-semibold">
                  {formatarNumero(alerta.unidades)}
                </span>
              )}
            </AlertTitle>
            {alerta.detalhe && (
              <AlertDescription className="text-xs text-amber-800">{alerta.detalhe}</AlertDescription>
            )}
          </Alert>
        );
      })}
    </div>
  );
}

function TabelaPorTamanho({ dados }: { dados: RotatividadeEstoqueDados }) {
  const linhas = dados.por_tamanho.filter(
    (t) => t.pedidas > 0 || t.saidas > 0 || t.entradas > 0 || t.saldo_disponivel > 0,
  );
  return (
    <PainelGrafico
      titulo="Detalhe por Tamanho"
      subtitulo="A mesma informação dos gráficos em números — ordenada pela escala de tamanho, não pelo volume."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <CabecalhoTabela>Tamanho</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Pedidas</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">% do total</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Entradas</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Saídas</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Devoluções</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Em estoque</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Giro</CabecalhoTabela>
              <CabecalhoTabela>Rotatividade</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Cobertura</CabecalhoTabela>
              <CabecalhoTabela>Situação</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Declararam</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Valor</CabecalhoTabela>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => {
              const giro = situacaoGiro(linha);
              const cobertura = situacaoCobertura(linha);
              return (
                <tr key={linha.tamanho} className="border-b last:border-0 hover:bg-slate-50">
                  <td className="px-3 py-2 font-bold text-blue-950">{linha.tamanho}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatarNumero(linha.pedidas)}</td>
                  <td className="px-3 py-2 text-right text-slate-500">
                    {formatarPercentual(linha.pct_pedidas)}
                  </td>
                  <td className="px-3 py-2 text-right">{formatarNumero(linha.entradas)}</td>
                  <td className="px-3 py-2 text-right">{formatarNumero(linha.saidas)}</td>
                  <td className="px-3 py-2 text-right text-slate-500">
                    {formatarNumero(linha.devolucoes)}
                  </td>
                  <td className="px-3 py-2 text-right">{formatarNumero(linha.saldo_disponivel)}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatarGiro(linha.giro)}</td>
                  <td className="px-3 py-2">
                    <Badge className={cn("border-0 text-[10px]", classeSituacaoGiro(giro))}>
                      {rotuloSituacaoGiro(giro)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">{formatarCobertura(linha.dias_cobertura)}</td>
                  <td className="px-3 py-2">
                    <Badge className={cn("border-0 text-[10px]", classeSituacaoCobertura(cobertura))}>
                      {rotuloSituacaoCobertura(cobertura)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">
                    {linha.declarado_pessoas > 0 ? formatarNumero(linha.declarado_pessoas) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {formatarMoeda(linha.valor_pedido)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!linhas.length && <EstadoVazio texto="Nenhum tamanho movimentado no período." />}
      </div>
    </PainelGrafico>
  );
}

function TabelaPorPeca({ dados }: { dados: RotatividadeEstoqueDados }) {
  const linhas = dados.por_peca.slice(0, 15);
  return (
    <PainelGrafico
      titulo="Peças que Mais Rodam"
      subtitulo="Top 15 por unidades pedidas, com o tamanho dominante de cada peça."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <CabecalhoTabela>#</CabecalhoTabela>
              <CabecalhoTabela>Peça</CabecalhoTabela>
              <CabecalhoTabela alinhar="center">Tamanho top</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Pedidas</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Entradas</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Saídas</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Em estoque</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Giro</CabecalhoTabela>
              <CabecalhoTabela alinhar="right">Valor</CabecalhoTabela>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha, i) => (
              <tr key={linha.peca} className="border-b last:border-0 hover:bg-slate-50">
                <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                <td className="max-w-64 truncate px-3 py-2 font-medium" title={linha.peca}>
                  {linha.peca}
                </td>
                <td className="px-3 py-2 text-center">
                  {linha.tamanho_top ? (
                    <Badge variant="outline" className="text-[10px] font-bold">
                      {linha.tamanho_top}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2 text-right font-medium">{formatarNumero(linha.pedidas)}</td>
                <td className="px-3 py-2 text-right">{formatarNumero(linha.entradas)}</td>
                <td className="px-3 py-2 text-right">{formatarNumero(linha.saidas)}</td>
                <td className="px-3 py-2 text-right">{formatarNumero(linha.saldo_disponivel)}</td>
                <td className="px-3 py-2 text-right">{formatarGiro(linha.giro)}</td>
                <td className="px-3 py-2 text-right font-medium">{formatarMoeda(linha.valor_pedido)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!linhas.length && <EstadoVazio texto="Nenhuma peça movimentada no período." />}
      </div>
    </PainelGrafico>
  );
}

function Carregando() {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
      <Skeleton className="h-96" />
    </div>
  );
}

export function RotatividadeEstoque({ empresaId, inicio, fim, contratoId }: Props) {
  const [categoria, setCategoria] = useState<string>("uniforme");
  const filtros = useMemo(
    () => ({ inicio, fim, contratoId, categoria }),
    [inicio, fim, contratoId, categoria],
  );
  const consulta = useDashboardRotatividadeEstoque(empresaId, filtros);
  const dados = consulta.data;

  const comparativo = useMemo(() => (dados ? compararGrade(dados.por_tamanho) : []), [dados]);
  const desalinhamento = useMemo(() => maiorDesalinhamento(comparativo), [comparativo]);
  const aviso = useMemo(
    () => (dados ? avisoMovimento(dados.periodo.inicio, dados.movimento_desde) : null),
    [dados],
  );

  // Gráficos de volume leem melhor ordenados por volume; a tabela abaixo
  // mantém a ordem da escala de tamanho, para quem quer conferir a grade.
  const porVolume = useMemo(
    () =>
      dados
        ? [...dados.por_tamanho]
            .filter((t) => t.pedidas > 0)
            .sort((a, b) => b.pedidas - a.pedidas)
            .slice(0, 12)
        : [],
    [dados],
  );
  const fluxoPorTamanho = useMemo(
    () =>
      dados
        ? dados.por_tamanho
            .filter((t) => t.entradas > 0 || t.saidas > 0)
            .sort((a, b) => a.ordem - b.ordem)
        : [],
    [dados],
  );
  const giroPorTamanho = useMemo(
    () =>
      dados
        ? [...dados.por_tamanho]
            .filter((t) => t.giro !== null && t.saidas > 0)
            .sort((a, b) => (b.giro ?? 0) - (a.giro ?? 0))
            .slice(0, 12)
        : [],
    [dados],
  );

  if (consulta.isLoading) return <Carregando />;

  if (consulta.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Não foi possível carregar a rotatividade</AlertTitle>
        <AlertDescription>
          {(consulta.error as Error).message}. Se as migrations de 13/10/2026 (
          <code className="font-mono text-xs">20261013000010</code> a{" "}
          <code className="font-mono text-xs">20261013000012</code>) ainda não foram aplicadas no
          Supabase, aplique-as antes de abrir esta aba.
        </AlertDescription>
      </Alert>
    );
  }

  if (!dados) return null;

  const r = dados.resumo;
  const cobertura = coberturaDePreco(r);
  const nomeCategoria =
    dados.filtros.categorias.find((c) => c.valor === categoria)?.nome ?? "Todas as categorias";

  return (
    <div className="space-y-3">
      {/* Seletor de categoria — local da aba, ver comentário do componente. */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="min-w-[220px]">
          <label className="mb-1 block text-xs font-semibold text-slate-700">
            Categoria analisada
          </label>
          <Select value={categoria || "todas"} onValueChange={(v) => setCategoria(v === "todas" ? "" : v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="uniforme">Uniformes</SelectItem>
              {dados.filtros.categorias
                .filter((c) => c.valor !== "uniforme")
                .map((c) => (
                  <SelectItem key={c.valor} value={c.valor}>
                    {c.nome}
                  </SelectItem>
                ))}
              <SelectItem value="todas">Todas as categorias</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="max-w-xl text-xs text-slate-500">
          Mostrando <span className="font-semibold text-slate-700">{nomeCategoria}</span> de{" "}
          {new Date(`${dados.periodo.inicio}T12:00:00`).toLocaleDateString("pt-BR")} a{" "}
          {new Date(`${dados.periodo.fim}T12:00:00`).toLocaleDateString("pt-BR")} (
          {formatarNumero(dados.periodo.dias)} dias). Período, empresa e contrato vêm do filtro no
          topo da página.
        </p>
      </div>

      {aviso && (
        <Alert className="border-blue-200 bg-blue-50/70">
          <Info className="h-4 w-4 text-blue-700" />
          <AlertTitle className="text-sm text-blue-900">Duas janelas de tempo diferentes</AlertTitle>
          <AlertDescription className="text-xs text-blue-800">{aviso}</AlertDescription>
        </Alert>
      )}

      {/* Números-herói: a resposta direta às quatro perguntas do diretor. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CartaoDestaque
          titulo="Tamanho que mais sai"
          valor={r.tamanho_mais_sai?.tamanho ?? "—"}
          icone={<Shirt className="h-6 w-6" />}
          detalhe={
            r.tamanho_mais_sai
              ? `${formatarNumero(r.tamanho_mais_sai.unidades)} unidades · ${formatarPercentual(
                  r.tamanho_mais_sai.percentual,
                )} de tudo que saiu`
              : "sem saída no período"
          }
        />
        <CartaoDestaque
          titulo="Tamanho que mais entra"
          valor={r.tamanho_mais_entra?.tamanho ?? "—"}
          tom="green"
          icone={<ArrowDownToLine className="h-6 w-6" />}
          detalhe={
            r.tamanho_mais_entra
              ? `${formatarNumero(r.tamanho_mais_entra.unidades)} unidades recebidas`
              : "nenhuma entrada registrada"
          }
        />
        <CartaoDestaque
          titulo="Maior rotatividade"
          valor={r.tamanho_maior_giro?.tamanho ?? "—"}
          tom="amber"
          icone={<Repeat className="h-6 w-6" />}
          detalhe={
            r.tamanho_maior_giro
              ? `gira ${formatarGiro(r.tamanho_maior_giro.giro)} no período · ${formatarNumero(
                  r.tamanho_maior_giro.saldo,
                )} em estoque`
              : "nenhum tamanho com volume suficiente"
          }
        />
        <CartaoDestaque
          titulo="Peça que mais sai"
          valor={
            <span className="text-2xl leading-tight">{r.peca_mais_sai?.peca ?? "—"}</span>
          }
          tom="red"
          icone={<Boxes className="h-6 w-6" />}
          detalhe={
            r.peca_mais_sai ? `${formatarNumero(r.peca_mais_sai.unidades)} unidades pedidas` : "—"
          }
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <CartaoIndicador
          titulo="Unidades pedidas"
          valor={formatarNumero(r.unidades_pedidas)}
          icone={<Shirt className="h-6 w-6" />}
          detalhe={`em ${formatarNumero(r.pedidos)} pedidos · ${formatarNumero(
            r.itens_distintos,
          )} peças distintas`}
        />
        <CartaoIndicador
          titulo="Valor movimentado"
          valor={formatarMoeda(r.valor_pedido)}
          tom="violet"
          icone={<TrendingUp className="h-6 w-6" />}
          detalhe={`estimado · ${formatarPercentual(cobertura)} das unidades têm preço cadastrado`}
        />
        <CartaoIndicador
          titulo="Entradas no estoque"
          valor={formatarNumero(r.entradas)}
          tom="green"
          icone={<ArrowDownToLine className="h-6 w-6" />}
          detalhe={`${formatarNumero(r.devolucoes)} devoluções no período`}
        />
        <CartaoIndicador
          titulo="Saídas do estoque"
          valor={formatarNumero(r.saidas)}
          tom="red"
          icone={<ArrowUpFromLine className="h-6 w-6" />}
          detalhe="baixas e remoções confirmadas no almoxarifado"
        />
        <CartaoIndicador
          titulo="Giro do estoque"
          valor={formatarGiro(r.giro)}
          tom="amber"
          icone={<Repeat className="h-6 w-6" />}
          detalhe="saídas ÷ saldo atual, no período"
        />
        <CartaoIndicador
          titulo="Em estoque hoje"
          valor={formatarNumero(r.saldo_disponivel)}
          icone={<Boxes className="h-6 w-6" />}
          detalhe={
            r.tamanhos_zerados > 0
              ? `${formatarNumero(r.tamanhos_zerados)} tamanhos pedidos estão zerados`
              : "nenhum tamanho pedido está zerado"
          }
        />
      </div>

      <BlocoAlertas dados={dados} />

      <div className="grid gap-3 xl:grid-cols-2">
        {/* MAGNITUDE: hue única, a barra já codifica o valor. */}
        <PainelGrafico
          titulo="Tamanho que Mais Sai"
          subtitulo="Unidades pedidas por tamanho, do maior para o menor."
        >
          {porVolume.length ? (
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={porVolume} layout="vertical" margin={{ left: 8, right: 44, top: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CINZA_GRADE} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "#64748b" }} />
                  <YAxis
                    type="category"
                    dataKey="tamanho"
                    width={52}
                    tick={{ fontSize: 11, fontWeight: 600, fill: "#334155" }}
                  />
                  <Tooltip content={<TooltipPadrao sufixo=" un." />} cursor={{ fill: "#f1f5f9" }} />
                  <Bar
                    dataKey="pedidas"
                    name="Unidades pedidas"
                    fill={AZUL_MAGNITUDE}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={22}
                  >
                    <LabelList
                      dataKey="pedidas"
                      position="right"
                      className="text-[10px]"
                      fill="#475569"
                      formatter={(v: number) => formatarNumero(v)}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EstadoVazio texto="Nenhuma unidade pedida no período." altura={320} />
          )}
        </PainelGrafico>

        {/* DUAS SÉRIES na mesma unidade (unidades) — um eixo só. */}
        <PainelGrafico
          titulo="Entrada x Saída por Tamanho"
          subtitulo="Movimentação física do almoxarifado, na ordem da escala de tamanho."
        >
          {fluxoPorTamanho.length ? (
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={fluxoPorTamanho} margin={{ top: 4 }} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CINZA_GRADE} />
                  <XAxis
                    dataKey="tamanho"
                    tick={{ fontSize: 10, fontWeight: 600, fill: "#334155" }}
                    interval={0}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#64748b" }} />
                  <Tooltip content={<TooltipPadrao sufixo=" un." />} cursor={{ fill: "#f1f5f9" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="entradas"
                    name="Entradas"
                    fill={SERIES.entrada}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={26}
                  />
                  <Bar
                    dataKey="saidas"
                    name="Saídas"
                    fill={SERIES.saida}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={26}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EstadoVazio
              texto="Nenhuma entrada ou saída registrada no almoxarifado neste período."
              altura={320}
            />
          )}
        </PainelGrafico>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {/* Giro é razão, não unidade: gráfico próprio, nunca segundo eixo do
            gráfico de volume. */}
        <PainelGrafico
          titulo="Quanto Cada Tamanho Roda"
          subtitulo="Giro = saídas ÷ saldo atual. Acima de 1× o tamanho girou o estoque inteiro no período."
        >
          {giroPorTamanho.length ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={giroPorTamanho} layout="vertical" margin={{ left: 8, right: 48, top: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CINZA_GRADE} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "#64748b" }} />
                  <YAxis
                    type="category"
                    dataKey="tamanho"
                    width={52}
                    tick={{ fontSize: 11, fontWeight: 600, fill: "#334155" }}
                  />
                  <Tooltip
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div className="rounded-lg border bg-white p-2 text-xs shadow-lg">
                          <p className="mb-1 font-semibold text-slate-700">Tamanho {label}</p>
                          <p className="text-slate-600">
                            Giro: {formatarGiro(payload[0].payload.giro)}
                          </p>
                          <p className="text-slate-600">
                            {formatarNumero(payload[0].payload.saidas)} saíram ·{" "}
                            {formatarNumero(payload[0].payload.saldo_disponivel)} em estoque
                          </p>
                          <p className="text-slate-600">
                            Cobertura: {formatarCobertura(payload[0].payload.dias_cobertura)}
                          </p>
                        </div>
                      ) : null
                    }
                    cursor={{ fill: "#f1f5f9" }}
                  />
                  <Bar dataKey="giro" name="Giro" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    {giroPorTamanho.map((linha) => (
                      // Cor por ESTADO (parado/lento/saudável/acelerado), com o
                      // rótulo do estado na tabela abaixo — nunca cor sozinha.
                      <Cell
                        key={linha.tamanho}
                        fill={
                          (linha.giro ?? 0) >= 1
                            ? SERIES.pedido
                            : (linha.giro ?? 0) >= 0.25
                              ? SERIES.entrada
                              : SERIES.declarado
                        }
                      />
                    ))}
                    <LabelList
                      dataKey="giro"
                      position="right"
                      className="text-[10px]"
                      fill="#475569"
                      formatter={(v: number) => formatarGiro(v)}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EstadoVazio texto="Sem saídas no período para calcular giro." altura={300} />
          )}
        </PainelGrafico>

        {/* Dois percentuais — mesma unidade, um eixo. */}
        <PainelGrafico
          titulo="Grade Declarada x Saída Real"
          subtitulo={`Levantamento de ${formatarNumero(
            dados.levantamento_resumo.pessoas,
          )} colaboradores comparado com o que saiu. Em % para as duas escalas se compararem.`}
          acao={
            desalinhamento ? (
              <Badge
                className={cn(
                  "border-0 text-[10px]",
                  Math.abs(desalinhamento.gap) >= 5
                    ? "bg-amber-100 text-amber-800"
                    : "bg-emerald-100 text-emerald-700",
                )}
              >
                Maior desvio: {desalinhamento.tamanho} {formatarGap(desalinhamento.gap)}
              </Badge>
            ) : null
          }
        >
          {comparativo.length ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparativo} margin={{ top: 4 }} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CINZA_GRADE} />
                  <XAxis
                    dataKey="tamanho"
                    tick={{ fontSize: 11, fontWeight: 600, fill: "#334155" }}
                    interval={0}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip content={<TooltipPercentual />} cursor={{ fill: "#f1f5f9" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="pct_declarado"
                    name="Declarado pela equipe"
                    fill={SERIES.declarado}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={26}
                  />
                  <Bar
                    dataKey="pct_saida"
                    name="Saída real"
                    fill={SERIES.pedido}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={26}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EstadoVazio
              texto="Sem grade declarada para esta categoria. O levantamento cobre peças de vestuário."
              altura={300}
            />
          )}
        </PainelGrafico>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.4fr_1fr]">
        {/* Unidades e reais não dividem eixo: duas séries de unidade aqui, o
            valor fica no gráfico ao lado. */}
        <PainelGrafico
          titulo="Movimentação Mês a Mês"
          subtitulo="Unidades pedidas acompanhadas de entrada e saída física."
        >
          {dados.evolucao.length ? (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dados.evolucao} margin={{ top: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CINZA_GRADE} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 10, fill: "#64748b" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#64748b" }} />
                  <Tooltip content={<TooltipPadrao sufixo=" un." />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="pedidas"
                    name="Pedidas"
                    stroke={SERIES.pedido}
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="entradas"
                    name="Entradas"
                    stroke={SERIES.entrada}
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="saidas"
                    name="Saídas"
                    stroke={SERIES.saida}
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EstadoVazio texto="Sem movimentação no período." altura={280} />
          )}
        </PainelGrafico>

        <PainelGrafico titulo="Valor Pedido por Mês" subtitulo="Estimado pelo preço de estoque.">
          {dados.evolucao.length ? (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dados.evolucao} margin={{ top: 4 }}>
                  <defs>
                    <linearGradient id="rotatividadeValor" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={SERIES.pedido} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={SERIES.pedido} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={CINZA_GRADE} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 10, fill: "#64748b" }} />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    tickFormatter={formatarEixoMoeda}
                  />
                  <Tooltip
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div className="rounded-lg border bg-white p-2 text-xs shadow-lg">
                          <p className="mb-1 font-semibold text-slate-700">{label}</p>
                          <p className="text-slate-600">
                            Valor pedido: {formatarMoeda(payload[0].value as number)}
                          </p>
                        </div>
                      ) : null
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="valor"
                    name="Valor pedido"
                    stroke={SERIES.pedido}
                    strokeWidth={2}
                    fill="url(#rotatividadeValor)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EstadoVazio texto="Sem valor no período." altura={280} />
          )}
        </PainelGrafico>
      </div>

      <PainelGrafico
        titulo="Rotatividade por Contrato"
        subtitulo="Unidades pedidas por contrato, com o tamanho dominante de cada um."
      >
        {dados.por_contrato.length ? (
          <div className="overflow-x-auto">
            <div className="h-[340px] min-w-[560px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={dados.por_contrato.slice(0, 12)}
                  layout="vertical"
                  margin={{ left: 8, right: 56, top: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CINZA_GRADE} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "#64748b" }} />
                  <YAxis
                    type="category"
                    dataKey="contrato"
                    width={210}
                    interval={0}
                    tick={<TickCategoria maximo={32} />}
                  />
                  <Tooltip
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div className="rounded-lg border bg-white p-2 text-xs shadow-lg">
                          <p className="mb-1 max-w-64 font-semibold text-slate-700">{label}</p>
                          <p className="text-slate-600">
                            {formatarNumero(payload[0].payload.unidades)} unidades em{" "}
                            {formatarNumero(payload[0].payload.pedidos)} pedidos
                          </p>
                          <p className="text-slate-600">
                            {formatarMoeda(payload[0].payload.valor)}
                          </p>
                          {payload[0].payload.tamanho_top && (
                            <p className="text-slate-600">
                              Tamanho dominante: {payload[0].payload.tamanho_top}
                            </p>
                          )}
                        </div>
                      ) : null
                    }
                    cursor={{ fill: "#f1f5f9" }}
                  />
                  <Bar
                    dataKey="unidades"
                    name="Unidades pedidas"
                    fill={AZUL_MAGNITUDE}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={20}
                  >
                    <LabelList
                      dataKey="tamanho_top"
                      position="right"
                      className="text-[10px]"
                      fill="#475569"
                      formatter={(v: string) => (v ? `top ${v}` : "")}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <EstadoVazio texto="Nenhum contrato com pedidos no período." altura={340} />
        )}
      </PainelGrafico>

      <TabelaPorTamanho dados={dados} />
      <TabelaPorPeca dados={dados} />

      <p className="px-1 pb-2 text-xs text-slate-500">
        Grade declarada: {formatarNumero(dados.levantamento_resumo.respostas)} respostas de{" "}
        {formatarNumero(dados.levantamento_resumo.pessoas)} colaboradores em{" "}
        {formatarNumero(dados.levantamento_resumo.contratos)} contratos
        {dados.levantamento_resumo.sem_contrato > 0 &&
          `, ${formatarNumero(dados.levantamento_resumo.sem_contrato)} sem contrato identificado`}
        {dados.levantamento_resumo.ultima_resposta &&
          ` · última resposta em ${new Date(
            `${dados.levantamento_resumo.ultima_resposta}T12:00:00`,
          ).toLocaleDateString("pt-BR")}`}
        . Quem respondeu mais de uma vez conta uma vez, pela resposta mais recente.
      </p>
    </div>
  );
}
