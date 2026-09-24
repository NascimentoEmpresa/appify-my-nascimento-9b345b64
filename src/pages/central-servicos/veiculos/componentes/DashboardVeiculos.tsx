import { useMemo, useState, type ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  BarChart3, CalendarCheck, CalendarClock, CalendarDays, Car, Download, FileText, Fuel, Gauge, Loader2, Search, Users, XCircle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModalExportarDados } from "@/components/exportar/ModalExportarDados";
import { useAuth } from "@/hooks/useAuth";
import { baixar } from "@/lib/exportarRelatorio";
import {
  COR_SERIE_UNICA, COR_SITUACAO, LABEL_TURNO_DASH, ROTULO_PERIODO, SITUACOES,
  diasDaReserva, filtrar, hojeBR, indicadores, intervaloDo, kmRodados, porContrato, porDiaSemana, porMes,
  porSolicitante, porTurno, porVeiculo, situacaoDe, type Filtros, type Periodo, type Situacao,
} from "@/lib/veiculos/dashboardVeiculos";
import { carregarHistorico, gerarExcel, gerarHtml, nomeArquivo, useDadosDashboardVeiculos } from "./relatorioAgendamentos";
import { ViagemDialog } from "./ViagemDialog";
import { toast } from "sonner";

// =====================================================================
// DASHBOARD — Agendamento de Veículos (24/09/2026)
//
// Pedido do Pablo: aba ao lado do Calendário Geral com todas as informações
// de todos os agendamentos, gráficos e "Exportar relatório". Os cálculos
// moram em src/lib/veiculos/dashboardVeiculos.ts (com teste) e são os
// mesmos do relatório exportado. Cores de situação: paleta categórica
// validada (dataviz) em ordem fixa; gráficos de uma série usam uma cor só.
// Aparece para quem vê "Toda a Frota" (sup_patrimonio): tem nome de quem
// agenda e gasto, é visão de gestão.
// =====================================================================

const num = (n: number) => n.toLocaleString("pt-BR");
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (n: number) => `${(n * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const dataBr = (s: string) => s.split("-").reverse().join("/");
const EIXO = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const GRADE = "hsl(var(--border))";

function Tile({ icone, rotulo, valor, sub, cor = "#0f3171" }: { icone: ReactNode; rotulo: string; valor: string; sub?: string; cor?: string }) {
  return (
    <Card className="flex items-start gap-3 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${cor}14`, color: cor }}>{icone}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{rotulo}</p>
        <p className="text-2xl font-extrabold leading-tight text-foreground">{valor}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </Card>
  );
}

function Grafico({ titulo, sub, children, className = "", vazio }: { titulo: string; sub?: string; children: ReactNode; className?: string; vazio?: boolean }) {
  return (
    <Card className={`p-4 ${className}`}>
      <div className="mb-3">
        <h3 className="text-sm font-bold text-foreground">{titulo}</h3>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      {vazio ? <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">Sem dados neste recorte.</p> : children}
    </Card>
  );
}

/** Barras horizontais de uma série (ranking), com o valor na ponta. */
function Ranking({ dados: todos, chave, rotulo, fmt = num }: { dados: { nome: string; qtd: number }[]; chave?: string; rotulo: string; fmt?: (n: number) => string }) {
  // "Outros" não vira barra: somando dezenas de itens, ela era a maior do
  // gráfico e esmagava o ranking que interessa. Sai como nota embaixo.
  const outros = todos.find((d) => d.nome.startsWith("Outros ("));
  const dados = todos.filter((d) => d !== outros);
  const altura = Math.max(120, dados.length * 30 + 20);
  return (
    <>
    <ResponsiveContainer width="100%" height={altura}>
      <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }} barCategoryGap={6}>
        <CartesianGrid horizontal={false} stroke={GRADE} strokeDasharray="3 3" />
        <XAxis type="number" hide allowDecimals={false} />
        {/* Nome numa linha só, cortado com reticências (o tick padrão quebrava em duas linhas pela metade). */}
        <YAxis type="category" dataKey="nome" width={190} tickLine={false} axisLine={false}
          tick={({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => (
            <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill="hsl(var(--foreground))">
              <title>{payload.value}</title>
              {payload.value.length > 25 ? `${payload.value.slice(0, 24)}…` : payload.value}
            </text>
          )} />
        <Tooltip cursor={{ fill: "hsl(var(--muted))" }} formatter={(v: number) => [fmt(v), rotulo]} />
        <Bar dataKey={chave ?? "qtd"} fill={COR_SERIE_UNICA} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
          <LabelList dataKey={chave ?? "qtd"} position="right" formatter={(v: number) => fmt(v)} style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    {outros && (
      <p className="mt-1 text-xs text-muted-foreground">
        + {outros.nome.match(/\d+/)?.[0]} outros fora do ranking, somando {fmt(outros.qtd)}
      </p>
    )}
    </>
  );
}

export function DashboardVeiculos() {
  const dados = useDadosDashboardVeiculos(true);
  const { user } = useAuth();
  const hoje = hojeBR();
  const [filtros, setFiltros] = useState<Filtros>({ periodo: "ano", de: "", ate: "", veiculo: "", situacao: "" });
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [viagem, setViagem] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);

  const todos = dados.data?.agendamentos ?? [];
  const abast = dados.data?.abastecimentos ?? [];
  const veiculos = useMemo(() => {
    const m = new Map<string, string>();
    todos.forEach((a) => m.set(a.patrimonio_id, `${a.veiculo_nome}${a.veiculo_identificador ? ` · ${a.veiculo_identificador}` : ""}`));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [todos]);

  const lista = useMemo(() => filtrar(todos, filtros, hoje).sort((a, b) => b.data_inicio.localeCompare(a.data_inicio) || b.numero - a.numero), [todos, filtros, hoje]);
  const ind = useMemo(() => indicadores(lista, abast, hoje), [lista, abast, hoje]);
  const mes = useMemo(() => porMes(lista, hoje), [lista, hoje]);
  const veic = useMemo(() => porVeiculo(lista, abast), [lista, abast]);
  const contratos = useMemo(() => porContrato(lista), [lista]);
  const solicitantes = useMemo(() => porSolicitante(lista), [lista]);
  const semana = useMemo(() => porDiaSemana(lista), [lista]);
  const turnos = useMemo(() => porTurno(lista), [lista]);
  const pizza = SITUACOES.map((s) => ({ nome: s, qtd: ind.porSituacao[s] })).filter((x) => x.qtd > 0);

  const recorte = useMemo(() => {
    const [ini, fim] = intervaloDo(filtros.periodo, hoje, filtros.de, filtros.ate);
    const partes = [filtros.periodo === "tudo" ? "todo o período" : `${ini ? dataBr(ini) : "início"} a ${fim ? dataBr(fim) : "hoje"}`];
    if (filtros.veiculo) partes.push(veiculos.find(([id]) => id === filtros.veiculo)?.[1] ?? "");
    if (filtros.situacao) partes.push(filtros.situacao);
    return partes.filter(Boolean).join(" · ");
  }, [filtros, hoje, veiculos]);

  const tabela = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? lista.filter((a) => `${a.numero} ${a.veiculo_nome} ${a.veiculo_identificador ?? ""} ${a.solicitante_nome ?? ""} ${a.destino ?? ""} ${a.contratos.map((c) => c.contrato_nome).join(" ")}`.toLowerCase().includes(q)) : lista;
  }, [lista, busca]);
  const POR_PAGINA = 15;
  const paginas = Math.max(1, Math.ceil(tabela.length / POR_PAGINA));
  const visiveis = tabela.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);

  const mudar = (p: Partial<Filtros>) => { setFiltros((f) => ({ ...f, ...p })); setPagina(0); };
  const sel = "h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground";

  if (dados.isLoading) return <p className="flex items-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando o painel…</p>;
  if (dados.isError) return <p className="py-16 text-sm text-destructive">Não consegui carregar o painel: {(dados.error as Error)?.message}</p>;

  const semKm = ind.viagensComKm === 0 && ind.notas === 0;

  return (
    <div className="space-y-4">
      {/* Filtros numa linha, acima de tudo; exportar leva o MESMO recorte. */}
      <Card className="flex flex-wrap items-end gap-3 p-3">
        <label className="space-y-1">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Período</span>
          <select className={sel} value={filtros.periodo} onChange={(e) => mudar({ periodo: e.target.value as Periodo })}>
            {(Object.keys(ROTULO_PERIODO) as Periodo[]).map((p) => <option key={p} value={p}>{ROTULO_PERIODO[p]}</option>)}
          </select>
        </label>
        {filtros.periodo === "personalizado" && (
          <>
            <label className="space-y-1"><span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">De</span>
              <Input type="date" className="h-9 w-40" value={filtros.de} max={filtros.ate || undefined} onChange={(e) => mudar({ de: e.target.value })} /></label>
            <label className="space-y-1"><span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Até</span>
              <Input type="date" className="h-9 w-40" value={filtros.ate} min={filtros.de || undefined} onChange={(e) => mudar({ ate: e.target.value })} /></label>
          </>
        )}
        <label className="space-y-1">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Veículo</span>
          <select className={`${sel} max-w-[240px]`} value={filtros.veiculo} onChange={(e) => mudar({ veiculo: e.target.value })}>
            <option value="">Todos os veículos</option>
            {veiculos.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Situação</span>
          <select className={sel} value={filtros.situacao} onChange={(e) => mudar({ situacao: e.target.value as Situacao | "" })}>
            <option value="">Todas</option>
            {SITUACOES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <p className="pb-2 text-xs text-muted-foreground">{num(lista.length)} agendamento{lista.length === 1 ? "" : "s"} · {recorte}</p>
        <Button className="ml-auto gap-2" onClick={() => setExportando(true)} disabled={!lista.length}>
          <Download className="h-4 w-4" /> Exportar relatório
        </Button>
      </Card>

      {/* Indicadores */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Tile icone={<BarChart3 className="h-5 w-5" />} rotulo="Agendamentos" valor={num(ind.total)} sub={`${num(ind.solicitantes)} solicitante${ind.solicitantes === 1 ? "" : "s"}`} />
        <Tile icone={<CalendarCheck className="h-5 w-5" />} rotulo="Realizados" valor={num(ind.porSituacao.Realizado)} cor={COR_SITUACAO.Realizado} />
        <Tile icone={<CalendarClock className="h-5 w-5" />} rotulo="Pela frente" valor={num(ind.porSituacao.Agendado + ind.porSituacao["Em andamento"])}
          sub={`${num(ind.porSituacao["Em andamento"])} em andamento`} cor={COR_SITUACAO.Agendado} />
        <Tile icone={<XCircle className="h-5 w-5" />} rotulo="Cancelados" valor={num(ind.porSituacao.Cancelado)} sub={`${pct(ind.taxaCancelamento)} do total`} cor={COR_SITUACAO.Cancelado} />
        <Tile icone={<CalendarDays className="h-5 w-5" />} rotulo="Dias de uso" valor={num(ind.diasReservados)} sub={`${num(ind.veiculosUsados)} veículo${ind.veiculosUsados === 1 ? "" : "s"} usado${ind.veiculosUsados === 1 ? "" : "s"}`} />
        <Tile icone={<FileText className="h-5 w-5" />} rotulo="Contratos atendidos" valor={num(ind.contratosAtendidos)} />
      </div>

      {/* Tempo + situação */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Grafico titulo="Agendamentos por mês" sub="Pelo mês de início, por situação" className="lg:col-span-2" vazio={!mes.length}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={mes} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke={GRADE} strokeDasharray="3 3" />
              <XAxis dataKey="rotulo" tick={EIXO} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={EIXO} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: "hsl(var(--muted))" }} />
              <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12 }} />
              {SITUACOES.map((s, i) => (
                <Bar key={s} dataKey={s} stackId="m" fill={COR_SITUACAO[s]} stroke="hsl(var(--card))" strokeWidth={1}
                  radius={i === SITUACOES.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} maxBarSize={44} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Grafico>
        <Grafico titulo="Situação" sub="Onde cada agendamento está no tempo" vazio={!pizza.length}>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="50%" height={200}>
              <PieChart>
                <Pie data={pizza} dataKey="qtd" nameKey="nome" innerRadius="58%" outerRadius="92%" paddingAngle={2} stroke="hsl(var(--card))" strokeWidth={2} isAnimationActive={false}>
                  {pizza.map((p) => <Cell key={p.nome} fill={COR_SITUACAO[p.nome as Situacao]} />)}
                </Pie>
                <Tooltip formatter={(v: number, n: string) => [`${num(v)} (${pct(v / Math.max(1, ind.total))})`, n]} />
              </PieChart>
            </ResponsiveContainer>
            <ul className="flex-1 space-y-2">
              {SITUACOES.map((s) => (
                <li key={s} className="flex items-center gap-2 text-sm">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COR_SITUACAO[s] }} />
                  <span className="flex-1 text-foreground">{s}</span>
                  <b className="tabular-nums text-foreground">{num(ind.porSituacao[s])}</b>
                  <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{pct(ind.porSituacao[s] / Math.max(1, ind.total))}</span>
                </li>
              ))}
            </ul>
          </div>
        </Grafico>
      </div>

      {/* Frota e contratos */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Grafico titulo="Uso por veículo" sub="Dias reservados (sem as canceladas)" vazio={!veic.length}>
          <Ranking dados={veic.map((v) => ({ nome: `${v.veiculo}${v.placa ? ` · ${v.placa}` : ""}`, qtd: v.dias }))} rotulo="Dias reservados" />
        </Grafico>
        <Grafico titulo="Contratos mais atendidos" sub="Viagens por contrato (uma viagem pode atender vários)" vazio={!contratos.length}>
          <Ranking dados={contratos} rotulo="Viagens" />
        </Grafico>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Grafico titulo="Quem mais agenda" sub="Agendamentos por solicitante" vazio={!solicitantes.length}>
          <Ranking dados={solicitantes} rotulo="Agendamentos" />
        </Grafico>
        <Grafico titulo="Dia da semana" sub="Pelo dia de início" vazio={!lista.length}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={semana} margin={{ top: 16, right: 8, bottom: 0, left: -24 }}>
              <CartesianGrid vertical={false} stroke={GRADE} strokeDasharray="3 3" />
              <XAxis dataKey="dia" tick={EIXO} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={EIXO} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: "hsl(var(--muted))" }} formatter={(v: number) => [num(v), "Agendamentos"]} />
              <Bar dataKey="qtd" fill={COR_SERIE_UNICA} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Grafico>
        <Grafico titulo="Turno" sub="Agendamentos por turno" vazio={!lista.length}>
          <Ranking dados={turnos} rotulo="Agendamentos" />
        </Grafico>
      </div>

      {/* Quilometragem e abastecimento */}
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-foreground">Quilometragem e abastecimento</h3>
            <p className="text-xs text-muted-foreground">KM final − inicial das viagens fechadas e as notas anexadas nas viagens</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile icone={<Gauge className="h-5 w-5" />} rotulo="KM rodados" valor={num(ind.kmRodados)} sub={`${num(ind.viagensComKm)} viage${ind.viagensComKm === 1 ? "m" : "ns"} com KM`} />
          <Tile icone={<Fuel className="h-5 w-5" />} rotulo="Gasto com abastecimento" valor={brl(ind.valorAbastecido)} sub={`${num(ind.notas)} nota${ind.notas === 1 ? "" : "s"}`} />
          <Tile icone={<Fuel className="h-5 w-5" />} rotulo="Litros" valor={ind.litros.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} />
          <Tile icone={<Car className="h-5 w-5" />} rotulo="Custo por KM" valor={ind.custoPorKm != null ? brl(ind.custoPorKm) : "—"} sub="gasto ÷ KM rodados" />
        </div>
        {semKm ? (
          <p className="mt-4 rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
            Ainda não há KM final nem notas de abastecimento registradas neste recorte — o controle começou em 22/09/2026. Os gráficos aparecem aqui assim que as viagens forem fechadas.
          </p>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div><p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">KM rodados por veículo</p>
              <Ranking dados={veic.filter((v) => v.km > 0).map((v) => ({ nome: v.veiculo, qtd: v.km }))} rotulo="KM" /></div>
            <div><p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Abastecimento por veículo</p>
              <Ranking dados={veic.filter((v) => v.valor > 0).map((v) => ({ nome: v.veiculo, qtd: v.valor }))} rotulo="Gasto" fmt={brl} /></div>
          </div>
        )}
      </Card>

      {/* Tabela — a visão de "linha por linha" dos gráficos */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-foreground"><Users className="h-4 w-4 text-primary" /> Todos os agendamentos do recorte</h3>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="h-9 pl-8" placeholder="Buscar nº, veículo, pessoa, contrato…" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(0); }} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>{["Nº", "Veículo", "Período", "Turno", "Solicitante", "Contratos", "KM", "Situação"].map((h) => <th key={h} className="px-3 py-2 font-bold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {visiveis.map((a) => {
                const s = situacaoDe(a, hoje), km = kmRodados(a);
                return (
                  <tr key={a.id} className="cursor-pointer border-t border-border hover:bg-muted/40" onClick={() => setViagem(a.id)}>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">#{a.numero}</td>
                    <td className="px-3 py-2 font-semibold text-foreground">{a.veiculo_nome}{a.veiculo_identificador && <span className="ml-1 text-xs font-normal text-muted-foreground">{a.veiculo_identificador}</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2">{a.data_inicio === a.data_fim ? dataBr(a.data_inicio) : `${dataBr(a.data_inicio)} a ${dataBr(a.data_fim)}`}<span className="ml-1 text-xs text-muted-foreground">({diasDaReserva(a)}d)</span></td>
                    <td className="px-3 py-2">{LABEL_TURNO_DASH[a.turno]}</td>
                    <td className="px-3 py-2">{a.solicitante_nome ?? "—"}</td>
                    <td className="max-w-[260px] truncate px-3 py-2 text-muted-foreground" title={a.contratos.map((c) => c.contrato_nome).join(", ")}>{a.contratos.map((c) => c.contrato_nome).join(", ") || "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{km != null ? num(km) : "—"}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-xs font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full" style={{ background: COR_SITUACAO[s] }} />{s}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!visiveis.length && <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">Nenhum agendamento neste recorte.</td></tr>}
            </tbody>
          </table>
        </div>
        {paginas > 1 && (
          <div className="flex items-center justify-between border-t border-border p-3 text-xs text-muted-foreground">
            <span>{num(tabela.length)} agendamentos · página {pagina + 1} de {paginas}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</Button>
              <Button size="sm" variant="outline" disabled={pagina >= paginas - 1} onClick={() => setPagina((p) => p + 1)}>Próxima</Button>
            </div>
          </div>
        )}
      </Card>

      <ViagemDialog agendamentoId={viagem} aberto={!!viagem} onFechar={() => setViagem(null)} souDono={false} />

      {exportando && (
        <ModalExportarDados
          nome={{ um: "agendamento", varios: "agendamentos" }}
          conteudo={`Sai a ficha de cada agendamento (veículo, período, turno, situação, solicitante, contratos, destino, motivo e quilometragem), os contratos atendidos, as notas de abastecimento e o histórico. Recorte: ${recorte}.`}
          registros={lista.map((a) => ({ id: a.id, titulo: `#${a.numero} · ${a.veiculo_nome}`, detalhe: `${dataBr(a.data_inicio)} · ${a.solicitante_nome ?? ""}`, busca: a.contratos.map((c) => c.contrato_nome).join(" ") }))}
          onFechar={() => setExportando(false)}
          onErro={(msg) => toast.error(msg)}
          onExportar={async (formato, id, progresso) => {
            const alvo = id == null ? [...lista].sort((a, b) => a.data_inicio.localeCompare(b.data_inicio) || a.numero - b.numero) : lista.filter((a) => a.id === id);
            if (!alvo.length) throw new Error("nenhum agendamento para exportar.");
            progresso("Buscando o histórico…");
            // Muitos ids no .in() estouram a URL (foi o que apagou a Caixa do WhatsApp):
            // acima de 100, traz o histórico todo e o relatório pega só o de cada viagem.
            const hist = await carregarHistorico(alvo.length > 100 ? null : alvo.map((a) => a.id));
            const ids = new Set(alvo.map((a) => a.id));
            const notas = abast.filter((b) => ids.has(b.agendamento_id));
            const autor = (user?.user_metadata?.nome as string | undefined) ?? user?.email ?? "";
            const nome = nomeArquivo(alvo, recorte);
            progresso("Montando o arquivo…");
            if (formato === "excel") baixar(gerarExcel(alvo, notas, hist, autor, recorte), `${nome}.xlsx`);
            else baixar(gerarHtml(alvo, notas, hist, autor, recorte), `${nome}.html`);
          }}
        />
      )}
    </div>
  );
}
