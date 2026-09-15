// Estúdio de BI — desenha UM widget a partir de (tipo, config, resultado).
//
// Regras de forma que valem pra todos (do skill de dataviz): marcas finas,
// cor por série em ordem fixa (nunca reciclada), legenda só com 2+ séries,
// texto sempre em tinta de texto (nunca na cor da série), tooltip em tudo
// que tem plot, grid recessivo. Um eixo Y só — duas escalas nunca.
import { useMemo } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import {
  COR_NEGATIVO, COR_POSITIVO, MAX_SERIES, corDaSerie, formatarCurto, formatarRotuloX, formatarValor,
  type ResultadoSql, type TipoWidget, type WidgetConfig,
} from "@/lib/bi/estudio";
import { cn } from "@/lib/utils";

interface Props {
  tipo: TipoWidget;
  config: WidgetConfig;
  dados: ResultadoSql | null | undefined;
  escuro?: boolean;
  /** altura do plot em px — o card decide */
  altura?: number;
  className?: string;
}

const INK = { primario: "#0b0b0b", secundario: "#52514e", mudo: "#898781", grade: "#e7e6e2" };
const INK_ESCURO = { primario: "#ffffff", secundario: "#c3c2b7", mudo: "#898781", grade: "#383835" };

export function WidgetGrafico({ tipo, config, dados, escuro = false, altura = 260, className }: Props) {
  const ink = escuro ? INK_ESCURO : INK;
  const formato = config.formato ?? "numero";
  const casas = config.casas;
  const fmt = (v: unknown) => formatarValor(v, formato, casas);

  const series = useMemo(() => (config.series ?? []).slice(0, MAX_SERIES), [config.series]);
  const linhas = dados?.linhas ?? [];

  if (!dados) return <Vazio className={className}>Sem dados.</Vazio>;
  if (!linhas.length) return <Vazio className={className}>A consulta não devolveu linhas.</Vazio>;

  // ── KPI ──────────────────────────────────────────────────────────────
  if (tipo === "kpi") {
    const col = config.kpi?.coluna ?? dados.colunas.find(c => c.tipo === "number")?.nome ?? dados.colunas[0]?.nome;
    const v = col ? linhas[0]?.[col] : undefined;
    const ant = config.kpi?.comparar_coluna ? Number(linhas[0]?.[config.kpi.comparar_coluna]) : NaN;
    const atual = Number(v);
    const varPct = !Number.isNaN(ant) && ant !== 0 && !Number.isNaN(atual) ? ((atual - ant) / Math.abs(ant)) * 100 : null;
    return (
      <div className={cn("flex h-full flex-col justify-center px-1", className)}>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tracking-tight" style={{ color: ink.primario }}>
            {config.kpi?.prefixo ?? ""}{fmt(v)}{config.kpi?.sufixo ?? ""}
          </span>
        </div>
        {varPct !== null && (
          <div className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: ink.secundario }}>
            <span className="font-semibold" style={{ color: varPct >= 0 ? COR_POSITIVO : COR_NEGATIVO }}>
              {varPct >= 0 ? "▲" : "▼"} {formatarValor(Math.abs(varPct), "percentual", 1)}
            </span>
            <span>vs. anterior ({fmt(ant)})</span>
          </div>
        )}
      </div>
    );
  }

  // ── Tabela ───────────────────────────────────────────────────────────
  if (tipo === "tabela") {
    const cols = (config.colunas?.length ? config.colunas : dados.colunas.map(c => c.nome));
    const tipoDe = Object.fromEntries(dados.colunas.map(c => [c.nome, c.tipo]));
    return (
      <div className={cn("h-full overflow-auto", className)}>
        <table className="w-full text-xs">
          <thead className="sticky top-0" style={{ background: escuro ? "#1a1a19" : "#fcfcfb" }}>
            <tr>
              {cols.map(c => (
                <th key={c} className={cn("border-b px-2 py-1.5 font-semibold", tipoDe[c] === "number" ? "text-right" : "text-left")}
                    style={{ color: ink.secundario, borderColor: ink.grade }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i} className="hover:bg-black/5 dark:hover:bg-white/5">
                {cols.map(c => {
                  const f = config.formatos?.[c];
                  const num = tipoDe[c] === "number";
                  return (
                    <td key={c} className={cn("border-b px-2 py-1 tabular-nums", num ? "text-right" : "text-left")}
                        style={{ color: ink.primario, borderColor: ink.grade }}>
                      {f ? formatarValor(l[c], f) : num ? formatarValor(l[c], "numero") : String(l[c] ?? "")}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {dados.truncado && <div className="px-2 py-1 text-[11px]" style={{ color: ink.mudo }}>Mostrando as primeiras {dados.total} linhas.</div>}
      </div>
    );
  }

  const x = config.x ?? dados.colunas.find(c => c.tipo !== "number")?.nome ?? dados.colunas[0]?.nome ?? "";
  const tooltipStyle = {
    background: escuro ? "#1a1a19" : "#fcfcfb", border: `1px solid ${ink.grade}`, borderRadius: 8,
    color: ink.primario, fontSize: 12, boxShadow: "0 8px 24px rgba(15,23,42,.12)",
  };
  const tooltipFmt = (v: unknown) => fmt(v);
  const mostraLegenda = config.mostrar_legenda ?? series.length > 1;
  const eixoX = <XAxis dataKey={x} tickFormatter={formatarRotuloX} tick={{ fill: ink.mudo, fontSize: 11 }} axisLine={{ stroke: ink.grade }} tickLine={false} interval="preserveStartEnd" />;
  const eixoY = <YAxis tickFormatter={v => formatarCurto(v, formato)} tick={{ fill: ink.mudo, fontSize: 11 }} axisLine={false} tickLine={false} width={64} />;
  const grade = <CartesianGrid stroke={ink.grade} strokeDasharray="0" vertical={false} />;
  const legenda = mostraLegenda ? <Legend wrapperStyle={{ fontSize: 12, color: ink.secundario }} iconType="circle" iconSize={8} /> : null;

  // ── Pizza / rosca ────────────────────────────────────────────────────
  if (tipo === "pizza" || tipo === "rosca") {
    const val = series[0]?.coluna ?? dados.colunas.find(c => c.tipo === "number")?.nome ?? "";
    const fatias = agruparOutros(linhas, x, val);
    const total = fatias.reduce((s, f) => s + Number(f[val] ?? 0), 0);
    return (
      <div className={cn("h-full", className)}>
        <ResponsiveContainer width="100%" height={altura}>
          <PieChart>
            <Pie data={fatias} dataKey={val} nameKey={x} innerRadius={tipo === "rosca" ? "58%" : 0} outerRadius="88%"
                 paddingAngle={2} stroke={escuro ? "#1a1a19" : "#fcfcfb"} strokeWidth={2}
                 label={config.mostrar_rotulos ? (p: any) => `${formatarRotuloX(p.name)} ${formatarValor((p.percent ?? 0) * 100, "percentual", 0)}` : false}
                 labelLine={config.mostrar_rotulos}>
              {fatias.map((_, i) => <Cell key={i} fill={corDaSerie(i, escuro)} />)}
            </Pie>
            {tipo === "rosca" && (
              <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" style={{ fill: ink.primario, fontSize: 18, fontWeight: 700 }}>
                {formatarCurto(total, formato)}
              </text>
            )}
            <Tooltip contentStyle={tooltipStyle} formatter={tooltipFmt} />
            <Legend wrapperStyle={{ fontSize: 12, color: ink.secundario }} iconType="circle" iconSize={8} formatter={(v) => formatarRotuloX(v)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── Dispersão ────────────────────────────────────────────────────────
  if (tipo === "dispersao") {
    const y = config.y ?? dados.colunas.filter(c => c.tipo === "number").map(c => c.nome).find(c => c !== x) ?? "";
    return (
      <div className={cn("h-full", className)}>
        <ResponsiveContainer width="100%" height={altura}>
          <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            {grade}
            <XAxis dataKey={x} type="number" name={x} tickFormatter={v => formatarCurto(v)} tick={{ fill: ink.mudo, fontSize: 11 }} axisLine={{ stroke: ink.grade }} tickLine={false} />
            <YAxis dataKey={y} type="number" name={y} tickFormatter={v => formatarCurto(v, formato)} tick={{ fill: ink.mudo, fontSize: 11 }} axisLine={false} tickLine={false} width={64} />
            {config.rotulo_ponto && <ZAxis dataKey={config.rotulo_ponto} name={config.rotulo_ponto} />}
            <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: ink.grade }} formatter={tooltipFmt} />
            <Scatter data={linhas} fill={corDaSerie(0, escuro, config.cor)} fillOpacity={0.85} stroke={escuro ? "#1a1a19" : "#fcfcfb"} strokeWidth={2} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── Linha / área ─────────────────────────────────────────────────────
  if (tipo === "linha" || tipo === "area") {
    const Chart = tipo === "linha" ? LineChart : AreaChart;
    return (
      <div className={cn("h-full", className)}>
        <ResponsiveContainer width="100%" height={altura}>
          <Chart data={linhas} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            {grade}{eixoX}{eixoY}
            <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: ink.mudo, strokeDasharray: "3 3" }} formatter={tooltipFmt} labelFormatter={formatarRotuloX} />
            {legenda}
            {series.map((s, i) => tipo === "linha" ? (
              <Line key={s.coluna} type="monotone" dataKey={s.coluna} name={s.rotulo ?? s.coluna} stroke={corDaSerie(i, escuro, s.cor ?? (series.length === 1 ? config.cor : undefined))}
                    strokeWidth={2} dot={{ r: 3, strokeWidth: 2, stroke: escuro ? "#1a1a19" : "#fcfcfb" }} activeDot={{ r: 5 }} isAnimationActive={false}>
                {config.mostrar_rotulos && <LabelList dataKey={s.coluna} position="top" formatter={(v: unknown) => formatarCurto(v, formato)} style={{ fill: ink.secundario, fontSize: 10 }} />}
              </Line>
            ) : (
              <Area key={s.coluna} type="monotone" dataKey={s.coluna} name={s.rotulo ?? s.coluna}
                    stroke={corDaSerie(i, escuro, s.cor ?? (series.length === 1 ? config.cor : undefined))}
                    fill={corDaSerie(i, escuro, s.cor ?? (series.length === 1 ? config.cor : undefined))} fillOpacity={0.18}
                    strokeWidth={2} stackId={config.empilhar ? "a" : undefined} isAnimationActive={false} />
            ))}
          </Chart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── Barras (vertical, horizontal, empilhadas) ────────────────────────
  const horizontal = tipo === "barras_h";
  const empilhar = tipo === "barras_empilhadas" || !!config.empilhar;
  const umaSerie = series.length === 1;
  return (
    <div className={cn("h-full", className)}>
      <ResponsiveContainer width="100%" height={altura}>
        <BarChart data={linhas} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, left: 0, bottom: 4 }} barCategoryGap={umaSerie ? "28%" : "20%"} barGap={2}>
          {horizontal ? <CartesianGrid stroke={ink.grade} horizontal={false} /> : grade}
          {horizontal ? (
            <>
              <XAxis type="number" tickFormatter={v => formatarCurto(v, formato)} tick={{ fill: ink.mudo, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey={x} tickFormatter={formatarRotuloX} tick={{ fill: ink.mudo, fontSize: 11 }} axisLine={{ stroke: ink.grade }} tickLine={false} width={140} interval={0} />
            </>
          ) : (<>{eixoX}{eixoY}</>)}
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: escuro ? "rgba(255,255,255,.05)" : "rgba(15,23,42,.05)" }} formatter={tooltipFmt} labelFormatter={formatarRotuloX} />
          {legenda}
          {series.map((s, i) => (
            <Bar key={s.coluna} dataKey={s.coluna} name={s.rotulo ?? s.coluna} stackId={empilhar ? "a" : undefined}
                 fill={corDaSerie(i, escuro, s.cor ?? (umaSerie ? config.cor : undefined))}
                 radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} stroke={escuro ? "#1a1a19" : "#fcfcfb"} strokeWidth={empilhar ? 2 : 0}
                 isAnimationActive={false} maxBarSize={48}>
              {config.mostrar_rotulos && !empilhar && (
                <LabelList dataKey={s.coluna} position={horizontal ? "right" : "top"} formatter={(v: unknown) => formatarCurto(v, formato)} style={{ fill: ink.secundario, fontSize: 10 }} />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Pizza com mais de 8 fatias: da 8ª em diante vira "Outros" (regra da paleta). */
function agruparOutros(linhas: Record<string, unknown>[], x: string, val: string) {
  if (linhas.length <= MAX_SERIES) return linhas;
  const ord = [...linhas].sort((a, b) => Number(b[val] ?? 0) - Number(a[val] ?? 0));
  const top = ord.slice(0, MAX_SERIES - 1);
  const resto = ord.slice(MAX_SERIES - 1).reduce((s, l) => s + Number(l[val] ?? 0), 0);
  return [...top, { [x]: "Outros", [val]: resto }];
}

function Vazio({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex h-full min-h-[120px] items-center justify-center text-xs text-muted-foreground", className)}>{children}</div>;
}
