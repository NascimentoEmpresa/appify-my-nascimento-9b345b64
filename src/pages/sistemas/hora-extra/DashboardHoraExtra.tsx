// =====================================================================
// DASHBOARD DE HORA EXTRA — /app/sistemas/hora-extra/liberacao/dashboards
//
// Chamado SIS-2026-0474. Tela de leitura: nenhuma ação escreve no banco,
// tudo vem da RPC `hora_extra_dashboard` numa chamada só.
//
// Menu próprio (`sistemas_hora_extra_dashboard`) — quem tem a Liberação
// de HE não ganha o dashboard junto, e a RPC repete a regra de linha do
// módulo: sem `aprovar` em `sistemas_hora_extra`, os números são só das
// HEs da própria pessoa.
// =====================================================================
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  ChartColumnBig,
  Clock,
  Database,
  Download,
  FileText,
  Hourglass,
  Lightbulb,
  PlayCircle,
  ArrowDown,
  ArrowUp,
  Search,
  Trophy,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useDashboardHoraExtra } from "@/hooks/useHoraExtra";
import { dataLocalISO, mensagemErro } from "./horaExtraUtils";
import {
  escalaHoras,
  formatarMoeda,
  insightsDashboard,
  linhasExcelDashboard,
  nivelEfetividade,
  percentual,
  quebrarNome,
  rotuloHoras,
  rotuloMes,
  rotuloMotivo,
  seriePorDiaSemana,
  textoVariacao,
} from "./dashboardHoraExtraUtils";
import { BreadcrumbHoraExtra } from "./HoraExtraUI";
import type { FiltrosDashboardHoraExtra } from "./types";

// Rampa de azul do mais alto para o mais baixo: a ordem da barra já é a
// ordem da cor, então a leitura do ranking não depende de ler o número.
const AZUIS_RANKING = ["#1d4ed8", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe"];
const AZUL_PREVISTO = "#93c5fd";
const AZUL_REALIZADO = "#1d4ed8";
const AZUL_DIA = "#93c5fd";
const AZUL_DIA_DESTAQUE = "#3b82f6";
const CORES_STATUS = { aprovadas: "#16a34a", concluidas: "#2563eb", pendentes: "#f97316" };

function inicioMes() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function fimMes() {
  const d = new Date();
  return dataLocalISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}
const FILTROS_PADRAO: FiltrosDashboardHoraExtra = {
  inicio: inicioMes(),
  fim: fimMes(),
  empresa: "todos",
  setor: "todos",
  colaborador: "todos",
  meses: 4,
};

export default function DashboardHoraExtra() {
  const navegar = useNavigate();
  const [filtros, setFiltros] = useState<FiltrosDashboardHoraExtra>(FILTROS_PADRAO);
  const { data, isLoading, isFetching, refetch } = useDashboardHoraExtra(filtros);
  const mudar = (campo: keyof FiltrosDashboardHoraExtra, valor: string | number) =>
    setFiltros((atual) => ({ ...atual, [campo]: valor }));

  const indicadores = data?.indicadores;
  const insights = useMemo(() => insightsDashboard(data), [data]);
  const dias = useMemo(() => seriePorDiaSemana(data?.por_dia_semana ?? []), [data]);
  const evolucao = useMemo(
    () => (data?.evolucao ?? []).map((m) => ({ ...m, rotulo: rotuloMes(m.mes) })),
    [data],
  );
  const motivos = useMemo(
    () => (data?.por_motivo ?? []).map((m) => ({ ...m, rotulo: rotuloMotivo(m.motivo) })),
    [data],
  );

  const exportar = () => {
    try {
      const planilha = XLSX.utils.json_to_sheet(linhasExcelDashboard(data?.efetividade ?? []));
      const pasta = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(pasta, planilha, "Efetividade");
      XLSX.writeFile(pasta, `dashboard-hora-extra-${filtros.inicio}-${filtros.fim}.xlsx`);
    } catch (erro: unknown) {
      toast.error(mensagemErro(erro, "Não foi possível gerar o relatório."));
    }
  };

  return (
    <div className="min-h-full bg-slate-50/60 p-4 text-[#07194b] md:p-6">
      <BreadcrumbHoraExtra atual="Dashboard de HE" />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Dashboard de Hora Extra</h1>
          <p className="text-sm text-slate-500">
            Acompanhe horas extras, produtividade e efetividade da equipe
          </p>
        </div>
        <AcessoGate menu="sistemas_hora_extra_dashboard" acao="exportar">
          <Button variant="outline" onClick={exportar} className="bg-white">
            <Download className="mr-2 h-4 w-4" />
            Exportar Relatório
          </Button>
        </AcessoGate>
      </div>

      {/* Filtros */}
      <div className="mb-3 rounded-lg border bg-white p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr_auto_auto]">
          <label className="text-xs text-slate-600">
            Período
            <div className="mt-1 flex items-center gap-1">
              <Input type="date" value={filtros.inicio} onChange={(e) => mudar("inicio", e.target.value)} />
              <span className="text-slate-400">–</span>
              <Input type="date" value={filtros.fim} onChange={(e) => mudar("fim", e.target.value)} />
            </div>
          </label>
          <FiltroSelect
            label="Empresa"
            valor={filtros.empresa}
            aoMudar={(v) => mudar("empresa", v)}
            rotuloTodos="Todas"
            itens={(data?.opcoes.empresas ?? []).map((e) => ({ valor: e, rotulo: e }))}
          />
          <FiltroSelect
            label="Setor"
            valor={filtros.setor}
            aoMudar={(v) => mudar("setor", v)}
            rotuloTodos="Todos"
            itens={(data?.opcoes.setores ?? []).map((s) => ({ valor: s, rotulo: s }))}
          />
          <FiltroSelect
            label="Colaborador"
            valor={filtros.colaborador}
            aoMudar={(v) => mudar("colaborador", v)}
            rotuloTodos="Todos"
            itens={(data?.opcoes.colaboradores ?? []).map((c) => ({ valor: c.id, rotulo: c.nome }))}
          />
          <Button variant="outline" className="self-end bg-white" onClick={() => setFiltros(FILTROS_PADRAO)}>
            Limpar filtros
          </Button>
          <Button className="self-end bg-[#07194b] hover:bg-[#07194b]/90" onClick={() => refetch()}>
            <Search className="mr-2 h-4 w-4" />
            Pesquisar
          </Button>
        </div>
      </div>

      {/* Indicadores */}
      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <CartaoIndicador
          icone={<Clock />}
          tom="azul"
          valor={rotuloHoras(indicadores?.aprovadas_min ?? 0)}
          titulo="HE aprovadas no mês"
          variacao={indicadores?.aprovadas_variacao}
        />
        <CartaoIndicador
          icone={<PlayCircle />}
          tom="verde"
          valor={rotuloHoras(indicadores?.realizadas_min ?? 0)}
          titulo="HE realizadas"
          variacao={indicadores?.realizadas_variacao}
        />
        <CartaoIndicador
          icone={<Hourglass />}
          tom="ambar"
          valor={indicadores?.pendentes_conclusao ?? 0}
          titulo="Pendentes de conclusão"
          variacao={indicadores?.pendentes_variacao}
        />
        <CartaoIndicador
          icone={<Database />}
          tom="roxo"
          valor={data && Number(data.valor_hora) > 0 ? formatarMoeda(indicadores?.custo_estimado) : "R$ —"}
          titulo="Custo estimado"
          variacao={data && Number(data.valor_hora) > 0 ? indicadores?.custo_variacao : 0}
          aviso={data && Number(data.valor_hora) > 0 ? undefined : "Valor-hora não definido"}
        />
        <CartaoIndicador
          icone={<Users />}
          tom="claro"
          valor={indicadores?.colaboradores ?? 0}
          titulo="Colaboradores com HE"
          variacao={indicadores?.colaboradores_variacao}
        />
        <CartaoIndicador
          icone={<FileText />}
          tom="laranja"
          valor={indicadores?.chamados ?? 0}
          titulo="Chamados trabalhados"
          variacao={indicadores?.chamados_variacao}
        />
      </div>

      {/* Linha 1 — ranking, evolução e previsto x realizado */}
      <div className="mb-3 grid gap-3 xl:grid-cols-3">
        <CartaoGrafico
          titulo="HE por colaborador"
          acao={
            <BotaoDetalhes aoClicar={() => navegar("/app/sistemas/hora-extra/liberacao")} />
          }
          vazio={!isLoading && !(data?.por_colaborador.length ?? 0)}
        >
          <BarrasHorizontais
            dados={(data?.por_colaborador ?? []).slice(0, 6).map((c) => ({ rotulo: c.nome, minutos: c.minutos }))}
            larguraRotulo={140}
            linhasRotulo={2}
            altura={186}
          />
        </CartaoGrafico>

        <CartaoGrafico
          titulo="Evolução das horas extras"
          acao={
            <select
              className="rounded-md border-0 bg-transparent text-xs font-medium text-blue-600 focus:outline-none"
              value={filtros.meses}
              onChange={(e) => mudar("meses", Number(e.target.value))}
            >
              <option value={4}>Últimos 4 meses</option>
              <option value={6}>Últimos 6 meses</option>
              <option value={12}>Últimos 12 meses</option>
            </select>
          }
          vazio={!isLoading && !evolucao.some((m) => m.previsto_min > 0)}
        >
          <div className="h-[186px] w-full">
            <ResponsiveContainer>
              <AreaChart data={evolucao} margin={{ top: 22, right: 20, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="#f1f5f9" />
                <defs>
                  <linearGradient id="gradienteEvolucaoHe" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="rotulo"
                  tickLine={false}
                  axisLine={{ stroke: "#e2e8f0" }}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                />
                <YAxis {...propsEixoHoras(evolucao.map((m) => m.previsto_min), 4)} />
                <Tooltip content={<DicaHoras />} />
                <Area
                  type="linear"
                  dataKey="previsto_min"
                  name="HE aprovada"
                  stroke={AZUL_REALIZADO}
                  strokeWidth={2}
                  fill="url(#gradienteEvolucaoHe)"
                  dot={{ r: 3.5, fill: AZUL_REALIZADO, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  label={<RotuloPonto />}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CartaoGrafico>

        <CartaoGrafico
          titulo="Previsto x Realizado"
          acao={
            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              <Legenda cor={AZUL_PREVISTO} texto="Previsto" />
              <Legenda cor={AZUL_REALIZADO} texto="Realizado" />
            </div>
          }
          vazio={!isLoading && !evolucao.some((m) => m.previsto_min > 0 || m.realizado_min > 0)}
        >
          <div className="h-[186px] w-full">
            <ResponsiveContainer>
              <BarChart data={evolucao} margin={{ top: 22, right: 8, left: 4, bottom: 0 }} barGap={4}>
                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="rotulo"
                  tickLine={false}
                  axisLine={{ stroke: "#e2e8f0" }}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                />
                <YAxis {...propsEixoHoras(evolucao.flatMap((m) => [m.previsto_min, m.realizado_min]), 4)} />
                <Tooltip cursor={{ fill: "#f1f5f9" }} content={<DicaHoras />} />
                <Bar
                  dataKey="previsto_min"
                  name="Previsto"
                  fill={AZUL_PREVISTO}
                  radius={[3, 3, 0, 0]}
                  label={<RotuloBarraVertical />}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="realizado_min"
                  name="Realizado"
                  fill={AZUL_REALIZADO}
                  radius={[3, 3, 0, 0]}
                  label={<RotuloBarraVertical />}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CartaoGrafico>
      </div>

      {/* Linha 2 — motivo, dia da semana e status */}
      <div className="mb-3 grid gap-3 xl:grid-cols-3">
        <CartaoGrafico
          titulo="HE por motivo"
          acao={<BotaoDetalhes aoClicar={() => navegar("/app/sistemas/hora-extra/liberacao")} />}
          vazio={!isLoading && !motivos.length}
        >
          <BarrasHorizontais
            dados={motivos.slice(0, 5).map((m) => ({ rotulo: m.rotulo, minutos: m.minutos }))}
            larguraRotulo={120}
            linhasRotulo={2}
            altura={168}
          />
        </CartaoGrafico>

        <CartaoGrafico titulo="HE por dia da semana" vazio={!isLoading && !dias.some((d) => d.minutos > 0)}>
          <div className="h-[168px] w-full">
            <ResponsiveContainer>
              <BarChart data={dias} margin={{ top: 22, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="#f1f5f9" />
                <XAxis
                  dataKey="curto"
                  tickLine={false}
                  axisLine={{ stroke: "#e2e8f0" }}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                />
                <YAxis {...propsEixoHoras(dias.map((d) => d.minutos), 3)} />
                <Tooltip cursor={{ fill: "#f1f5f9" }} content={<DicaHoras />} />
                <Bar
                  dataKey="minutos"
                  name="Hora extra"
                  radius={[3, 3, 0, 0]}
                  label={<RotuloBarraVertical />}
                  isAnimationActive={false}
                >
                  {dias.map((dia) => (
                    <Cell
                      key={dia.dia}
                      fill={
                        dia.minutos > 0 && dia.minutos === Math.max(...dias.map((d) => d.minutos))
                          ? AZUL_DIA_DESTAQUE
                          : AZUL_DIA
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CartaoGrafico>

        <CartaoGrafico titulo="Status das HEs" vazio={!isLoading && !(data?.status.total_min ?? 0)}>
          <RoscaStatus status={data?.status} />
        </CartaoGrafico>
      </div>

      {/* Linha 3 — tabela de efetividade e insights */}
      <div className="grid gap-3 xl:grid-cols-[2.5fr_1fr]">
        <section className="overflow-hidden rounded-lg border bg-white">
          <h2 className="px-4 pb-2 pt-3 text-sm font-bold text-[#07194b]">Efetividade da equipe</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Colaborador</th>
                  <th className="px-3 py-2.5 text-center font-medium">Qtd. HEs</th>
                  <th className="px-3 py-2.5 text-center font-medium">Horas aprovadas</th>
                  <th className="px-3 py-2.5 text-center font-medium">Horas realizadas</th>
                  <th className="px-3 py-2.5 text-center font-medium">Chamados</th>
                  <th className="px-3 py-2.5 text-center font-medium">Conclusão média</th>
                  <th className="px-3 py-2.5 text-center font-medium">Efetividade</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      Carregando...
                    </td>
                  </tr>
                )}
                {!isLoading &&
                  (data?.efetividade ?? []).map((colaborador) => {
                    const nivel = nivelEfetividade(colaborador.conclusao_media);
                    return (
                      <tr key={colaborador.id} className="border-t">
                        <td className="px-3 py-2 font-bold">{colaborador.nome}</td>
                        <td className="px-3 py-2 text-center">{colaborador.qtd}</td>
                        <td className="px-3 py-2 text-center">{rotuloHoras(colaborador.aprovadas_min)}</td>
                        <td className="px-3 py-2 text-center">{rotuloHoras(colaborador.realizadas_min)}</td>
                        <td className="px-3 py-2 text-center">{colaborador.chamados}</td>
                        <td className="px-3 py-2 text-center">{Math.round(Number(colaborador.conclusao_media) || 0)}%</td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={cn(
                              "inline-flex rounded-md px-2 py-1 text-[11px] font-semibold",
                              nivel.classe,
                            )}
                          >
                            {nivel.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                {!isLoading && !(data?.efetividade.length ?? 0) && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      Nenhuma hora extra no período selecionado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border bg-white p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#07194b]">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            Insights do mês
          </h2>
          {!insights.length ? (
            <p className="rounded-lg border border-dashed bg-slate-50 p-3 text-xs text-slate-500">
              {isLoading ? "Carregando..." : "Sem hora extra no período para destacar."}
            </p>
          ) : (
            <div className="divide-y">
              {insights.map((insight) => (
                <div key={insight.chave} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span
                    className={cn(
                      "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                      insight.chave === "volume" && "bg-orange-50 text-orange-500",
                      insight.chave === "efetividade" && "bg-amber-50 text-amber-500",
                      insight.chave === "dia" && "bg-blue-50 text-blue-600",
                    )}
                  >
                    {insight.chave === "volume" && <ChartColumnBig className="h-4 w-4" />}
                    {insight.chave === "efetividade" && <Trophy className="h-4 w-4" />}
                    {insight.chave === "dia" && <CalendarDays className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-slate-500">{insight.titulo}</div>
                    <div className="truncate text-xs font-bold" title={insight.destaque}>
                      {insight.destaque}
                    </div>
                  </div>
                  <span className="shrink-0 self-center text-[10px] text-slate-500">{insight.detalhe}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {isFetching && !isLoading && (
        <p className="mt-3 text-center text-[11px] text-slate-400">Atualizando…</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Peças da tela
// ---------------------------------------------------------------------

function FiltroSelect({
  label,
  valor,
  aoMudar,
  itens,
  rotuloTodos,
}: {
  label: string;
  valor: string;
  aoMudar: (valor: string) => void;
  itens: Array<{ valor: string; rotulo: string }>;
  rotuloTodos: string;
}) {
  return (
    <label className="text-xs text-slate-600">
      {label}
      <select
        className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-sm"
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
      >
        <option value="todos">{rotuloTodos}</option>
        {itens.map((item) => (
          <option key={item.valor} value={item.valor}>
            {item.rotulo}
          </option>
        ))}
      </select>
    </label>
  );
}

const TONS_INDICADOR = {
  azul: { cartao: "bg-blue-50/40", icone: "bg-blue-100 text-blue-600" },
  verde: { cartao: "bg-emerald-50/40", icone: "bg-emerald-100 text-emerald-600" },
  ambar: { cartao: "bg-amber-50/50", icone: "bg-amber-100 text-amber-500" },
  roxo: { cartao: "bg-violet-50/50", icone: "bg-violet-100 text-violet-600" },
  claro: { cartao: "bg-white", icone: "bg-blue-100 text-blue-600" },
  laranja: { cartao: "bg-orange-50/50", icone: "bg-orange-100 text-orange-500" },
} as const;

function CartaoIndicador({
  icone,
  valor,
  titulo,
  variacao,
  aviso,
  tom,
}: {
  icone: ReactNode;
  valor: ReactNode;
  titulo: string;
  variacao?: number | null;
  aviso?: string;
  tom: keyof typeof TONS_INDICADOR;
}) {
  const tons = TONS_INDICADOR[tom];
  const { texto, tom: tomVariacao } = textoVariacao(variacao);
  return (
    <div className={cn("flex flex-col justify-between rounded-xl border border-slate-200 p-3", tons.cartao)}>
      <div className="flex items-center gap-3">
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl [&_svg]:h-5 [&_svg]:w-5", tons.icone)}>
          {icone}
        </span>
        <div className="min-w-0">
          <div className="text-2xl font-extrabold leading-tight text-[#07194b]">{valor}</div>
          <div className="truncate text-[11px] font-medium text-slate-600" title={titulo}>
            {titulo}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-500">
        {aviso ? (
          <span className="text-slate-400">{aviso}</span>
        ) : tomVariacao === "neutro" ? (
          <span>{texto}</span>
        ) : (
          <>
            {tomVariacao === "alta" ? (
              <ArrowUp className="h-3 w-3 text-emerald-600" />
            ) : (
              <ArrowDown className="h-3 w-3 text-red-500" />
            )}
            <strong className={tomVariacao === "alta" ? "text-emerald-600" : "text-red-500"}>
              {texto.split(" ")[0]}
            </strong>
            <span>{texto.split(" ").slice(1).join(" ")}</span>
          </>
        )}
      </div>
    </div>
  );
}

function CartaoGrafico({
  titulo,
  acao,
  vazio,
  children,
}: {
  titulo: string;
  acao?: ReactNode;
  vazio?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-white p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-[#07194b]">{titulo}</h2>
        {acao}
      </div>
      {vazio ? (
        <div className="flex h-[168px] items-center justify-center text-xs text-slate-500">
          Sem dados no período selecionado.
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function BotaoDetalhes({ aoClicar }: { aoClicar: () => void }) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
    >
      Ver detalhes
      <ArrowRight className="h-3 w-3" />
    </button>
  );
}

function Legenda({ cor, texto }: { cor: string; texto: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: cor }} />
      {texto}
    </span>
  );
}

/**
 * Props do eixo de horas com marcações redondas. É função, e não
 * componente: o recharts só monta o eixo quando o `<YAxis>` é filho DIRETO
 * do gráfico — embrulhar em outro componente faz o eixo sumir do gráfico.
 */
function propsEixoHoras(dados: number[], divisoes: number) {
  const ticks = escalaHoras(Math.max(0, ...dados.map((d) => Number(d) || 0)), divisoes);
  return {
    type: "number" as const,
    domain: [0, ticks[ticks.length - 1]] as [number, number],
    ticks,
    tickFormatter: rotuloHoras,
    tickLine: false,
    axisLine: false,
    width: 34,
    tick: { fontSize: 11, fill: "#64748b" },
  };
}

interface PropsRotuloRecharts {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  value?: number | string;
  index?: number;
}

function RotuloBarraVertical({ x, y, width, value }: PropsRotuloRecharts) {
  const minutos = Number(value) || 0;
  if (minutos <= 0) return null;
  return (
    <text
      x={Number(x) + Number(width) / 2}
      y={Number(y) - 6}
      textAnchor="middle"
      className="fill-[#07194b] text-[11px] font-bold"
    >
      {rotuloHoras(minutos)}
    </text>
  );
}

function RotuloPonto({ x, y, value }: PropsRotuloRecharts) {
  const minutos = Number(value) || 0;
  if (minutos <= 0) return null;
  return (
    <text x={Number(x)} y={Number(y) - 12} textAnchor="middle" className="fill-[#07194b] text-[11px] font-bold">
      {rotuloHoras(minutos)}
    </text>
  );
}

interface PropsDica {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
}

function DicaHoras({ active, label, payload }: PropsDica) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-white px-2.5 py-1.5 text-[11px] shadow-sm">
      <div className="font-bold text-[#07194b]">{label}</div>
      {payload.map((item) => (
        <div key={item.name} className="flex items-center gap-1.5 text-slate-600">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: item.color }} />
          {item.name}: <strong className="text-[#07194b]">{rotuloHoras(Number(item.value))}</strong>
        </div>
      ))}
    </div>
  );
}

/**
 * Ranking horizontal. O nome fica fora da área do gráfico, alinhado à
 * direita, e quebra em até `linhasRotulo` linhas — nome completo de
 * colaborador não cabe numa linha só e cortar com reticências tira
 * justamente o sobrenome que diferencia duas pessoas.
 */
function BarrasHorizontais({
  dados,
  larguraRotulo,
  linhasRotulo,
  altura,
}: {
  dados: Array<{ rotulo: string; minutos: number }>;
  larguraRotulo: number;
  linhasRotulo: number;
  altura: number;
}) {
  const ticks = escalaHoras(Math.max(0, ...dados.map((d) => d.minutos)), 6);
  return (
    <div style={{ height: altura }} className="w-full">
      <ResponsiveContainer>
        <BarChart data={dados} layout="vertical" margin={{ top: 8, right: 46, left: 0, bottom: 0 }} barSize={16}>
          <CartesianGrid stroke="#f1f5f9" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, ticks[ticks.length - 1]]}
            ticks={ticks}
            tickFormatter={rotuloHoras}
            tickLine={false}
            axisLine={{ stroke: "#e2e8f0" }}
            tick={{ fontSize: 11, fill: "#64748b" }}
          />
          <YAxis
            type="category"
            dataKey="rotulo"
            width={larguraRotulo}
            tickLine={false}
            axisLine={false}
            interval={0}
            tick={<TickRotulo linhas={linhasRotulo} largura={larguraRotulo} />}
          />
          <Tooltip cursor={{ fill: "#f1f5f9" }} content={<DicaHoras />} />
          <Bar dataKey="minutos" name="Hora extra" radius={[0, 3, 3, 0]} label={<RotuloBarraHorizontal />} isAnimationActive={false}>
            {dados.map((item, indice) => (
              <Cell key={item.rotulo} fill={AZUIS_RANKING[Math.min(indice, AZUIS_RANKING.length - 1)]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function RotuloBarraHorizontal({ x, y, width, height, value }: PropsRotuloRecharts) {
  const minutos = Number(value) || 0;
  if (minutos <= 0) return null;
  return (
    <text
      x={Number(x) + Number(width) + 6}
      y={Number(y) + Number(height) / 2 + 4}
      className="fill-[#07194b] text-[11px] font-bold"
    >
      {rotuloHoras(minutos)}
    </text>
  );
}

function TickRotulo({
  x,
  y,
  payload,
  linhas,
  largura,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
  linhas: number;
  largura: number;
}) {
  const partes = quebrarNome(String(payload?.value ?? ""), Math.floor((largura - 12) / 6.2), linhas);
  return (
    <g transform={`translate(${x},${y})`}>
      {partes.map((parte, indice) => (
        <text
          key={parte + indice}
          x={-8}
          y={(indice - (partes.length - 1) / 2) * 12 + 4}
          textAnchor="end"
          className="fill-slate-600 text-[11px]"
        >
          {parte}
        </text>
      ))}
    </g>
  );
}

function RoscaStatus({ status }: { status?: { aprovadas_min: number; concluidas_min: number; pendentes_min: number; total_min: number } }) {
  const total = Number(status?.total_min) || 0;
  const fatias = [
    { chave: "aprovadas", rotulo: "Aprovadas", minutos: Number(status?.aprovadas_min) || 0, cor: CORES_STATUS.aprovadas },
    { chave: "concluidas", rotulo: "Concluídas", minutos: Number(status?.concluidas_min) || 0, cor: CORES_STATUS.concluidas },
    { chave: "pendentes", rotulo: "Pendentes", minutos: Number(status?.pendentes_min) || 0, cor: CORES_STATUS.pendentes },
  ];
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-[168px] w-[168px] shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={fatias.filter((f) => f.minutos > 0)}
              dataKey="minutos"
              nameKey="rotulo"
              innerRadius="62%"
              outerRadius="92%"
              startAngle={90}
              endAngle={-270}
              paddingAngle={1}
              stroke="none"
              isAnimationActive={false}
            >
              {fatias
                .filter((f) => f.minutos > 0)
                .map((fatia) => (
                  <Cell key={fatia.chave} fill={fatia.cor} />
                ))}
            </Pie>
            <Tooltip content={<DicaHoras />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <strong className="text-lg font-extrabold text-[#07194b]">{rotuloHoras(total)}</strong>
          <span className="text-[10px] text-slate-500">Horas totais</span>
        </div>
      </div>
      <ul className="flex-1 space-y-3">
        {fatias.map((fatia) => (
          <li key={fatia.chave} className="flex items-start gap-2">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: fatia.cor }} />
            <div>
              <div className="text-[11px] text-slate-500">{fatia.rotulo}</div>
              <div className="text-xs font-bold text-[#07194b]">
                {rotuloHoras(fatia.minutos)} ({percentual(fatia.minutos, total)}%)
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
