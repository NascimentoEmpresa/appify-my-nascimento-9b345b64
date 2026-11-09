import { useMemo, useState, type ComponentType } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertCircle, ArrowDown, ArrowUp, BarChart3, CalendarDays, CircleDollarSign, Clock3, Equal, Landmark, Minus, Percent,
  ShieldAlert, Wallet,
} from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import {
  avisoSemDre, fatiasSituacao, fmtBRL, fmtCompacto, montarCards, rotuloCompetencia, rotuloEixo,
  type CardIndicador, type DadosPainelExecutivo, type FatiaSituacao,
} from "@/lib/operacional/painelExecutivo";
import { cn } from "@/lib/utils";

// =====================================================================
// Operacional › Indicadores › PAINEL EXECUTIVO (09/11/2026)
// Mig 20261109002000. Uma requisição por competência (RPC
// ope_painel_executivo); contas e permissão ficam no banco.
// =====================================================================

const MENU = "ope_indicadores_painel_executivo";
const COR_RECEITA = "#2563eb";
const COR_LUCRO = "#f97316";
const COR_SITUACAO: Record<FatiaSituacao["chave"], string> = { saudavel: "#16a34a", atencao: "#f59e0b", critico: "#dc2626" };

const ICONES: Record<string, { icone: ComponentType<{ className?: string }>; cor: string }> = {
  receita: { icone: Landmark, cor: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  lucro: { icone: CircleDollarSign, cor: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  margem: { icone: Percent, cor: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  no_prazo: { icone: Clock3, cor: "bg-muted text-muted-foreground" },
  recebido: { icone: CircleDollarSign, cor: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  saldo: { icone: Clock3, cor: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  vencido: { icone: Wallet, cor: "bg-red-500/10 text-red-600 dark:text-red-400" },
  criticos: { icone: ShieldAlert, cor: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
};

const COR_VARIACAO = {
  melhor: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  pior: "bg-red-500/10 text-red-700 dark:text-red-400",
  neutro: "bg-muted text-muted-foreground",
};

function CardKpi({ card }: { card: CardIndicador }) {
  const { icone: Icone, cor } = ICONES[card.chave];
  const SetaVar = card.variacao?.seta === "sobe" ? ArrowUp : card.variacao?.seta === "desce" ? ArrowDown : Equal;
  return (
    <Card className="flex items-start gap-3 p-4">
      <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-lg", cor)}>
        <Icone className="h-6 w-6" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm text-muted-foreground">{card.titulo}</p>
          {card.medida !== "real" && (
            <span className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {card.medida === "parcial" ? "Parcial" : "Sem fonte"}
            </span>
          )}
        </div>
        {card.valor !== null ? (
          <p className="mt-0.5 truncate text-xl font-bold tabular-nums text-foreground">{card.valor}</p>
        ) : (
          <p className="mt-0.5 flex h-7 items-center text-muted-foreground" aria-label="Sem número">
            <Minus className="h-5 w-5" />
          </p>
        )}
        {card.variacao && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium tabular-nums", COR_VARIACAO[card.variacao.sentido])}>
              <SetaVar className="h-3 w-3" />
              {card.variacao.texto}
            </span>
            vs. mês anterior
          </p>
        )}
        {card.aviso && <p className="mt-1 text-xs text-muted-foreground">{card.aviso}</p>}
      </div>
    </Card>
  );
}

function SemDados({ texto }: { texto: string }) {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center gap-2 text-sm text-muted-foreground">
      <AlertCircle className="h-4 w-4" />
      {texto}
    </div>
  );
}

function TooltipEvolucao({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold text-popover-foreground">{rotuloCompetencia(label)}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-popover-foreground">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-medium tabular-nums">{fmtBRL(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

function GraficoEvolucao({ serie }: { serie: DadosPainelExecutivo["serie"] }) {
  if (serie.length === 0) return <SemDados texto="DRE sem competência carregada" />;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
        <XAxis dataKey="competencia" tickFormatter={rotuloEixo} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={fmtCompacto} width={52} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
        <Tooltip content={<TooltipEvolucao />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }} />
        <Legend verticalAlign="top" align="right" iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 13, paddingBottom: 8 }} />
        <Bar dataKey="receita" name="Receita" fill={COR_RECEITA} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
        <Line dataKey="lucro" name="Lucro Bruto" stroke={COR_LUCRO} strokeWidth={2} dot={{ r: 4, fill: COR_LUCRO, strokeWidth: 2, stroke: "hsl(var(--card))" }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function RoscaSituacao({ dados }: { dados: DadosPainelExecutivo }) {
  const { total, fatias } = useMemo(() => fatiasSituacao(dados.situacao), [dados.situacao]);
  if (!dados.situacao) return <SemDados texto={avisoSemDre(dados)} />;
  if (total === 0) return <SemDados texto="Nenhum contrato com receita nesta competência" />;
  return (
    <div className="flex flex-col items-center gap-4 2xl:flex-row 2xl:justify-around">
      <div className="relative h-[200px] w-[200px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={fatias} dataKey="qtd" nameKey="nome" innerRadius={62} outerRadius={94} startAngle={90} endAngle={-270} stroke="hsl(var(--card))" strokeWidth={2} isAnimationActive={false}>
              {fatias.map((f) => <Cell key={f.chave} fill={COR_SITUACAO[f.chave]} />)}
            </Pie>
            <Tooltip formatter={(v: number, n: string) => [`${v} contrato(s)`, n]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums text-foreground">{total}</span>
          <span className="text-xs text-muted-foreground">Contratos</span>
        </div>
      </div>
      <ul className="space-y-3 text-sm">
        {fatias.map((f) => (
          <li key={f.chave} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: COR_SITUACAO[f.chave] }} />
            <span className="w-20 text-muted-foreground">{f.nome}</span>
            <span className="font-semibold tabular-nums text-foreground">
              {f.qtd} ({f.pct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ConteudoPainelExecutivo({ dados, competencia, onCompetencia }: {
  dados: DadosPainelExecutivo | undefined;
  competencia: string | undefined;
  onCompetencia: (c: string) => void;
}) {
  const cards = useMemo(() => (dados ? montarCards(dados) : []), [dados]);
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-orange-500 text-white">
            <BarChart3 className="h-7 w-7" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">1. Painel Executivo</h1>
            <p className="text-sm text-muted-foreground">Visão geral do desempenho da empresa, integrando resultados financeiros, operacionais e de pessoas.</p>
          </div>
        </div>
        <div className="w-full sm:w-44">
          <label className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
            <CalendarDays className="h-3 w-3" /> Competência
          </label>
          <Select value={competencia ?? dados?.competencia ?? ""} onValueChange={onCompetencia} disabled={!dados}>
            <SelectTrigger><SelectValue placeholder="Carregando" /></SelectTrigger>
            <SelectContent>
              {(dados?.competencias ?? []).map((c) => (
                <SelectItem key={c} value={c}>{rotuloCompetencia(c)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!dados ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((c) => <CardKpi key={c.chave} card={c} />)}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <h2 className="mb-2 font-semibold text-foreground">Evolução da Receita e Lucro Bruto</h2>
              <GraficoEvolucao serie={dados.serie} />
            </Card>
            <Card className="p-5">
              <h2 className="mb-4 font-semibold text-foreground">Contratos por Situação</h2>
              <RoscaSituacao dados={dados} />
              <p className="mt-4 text-xs text-muted-foreground">
                Só pela margem do DRE, contratos com receita de R$ 10 mil ou mais. Saudável: 10% ou mais. Atenção: de 0 a 10%. Crítico: negativa.
              </p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

export default function PainelExecutivo() {
  const [competencia, setCompetencia] = useState<string | undefined>(undefined);
  const q = useQuery({
    queryKey: ["ope-painel-executivo", competencia ?? "padrao"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("ope_painel_executivo", { _competencia: competencia ?? null });
      if (error) throw error;
      return data as DadosPainelExecutivo;
    },
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

  return (
    <AcessoGate
      menu={MENU}
      acao="visualizar"
      fallback={<SemDados texto="Você não tem acesso ao Painel Executivo." />}
    >
      {q.isError ? (
        <SemDados texto="Não foi possível carregar o Painel Executivo. Tente novamente em instantes." />
      ) : (
        <ConteudoPainelExecutivo dados={q.data} competencia={competencia} onCompetencia={setCompetencia} />
      )}
    </AcessoGate>
  );
}
