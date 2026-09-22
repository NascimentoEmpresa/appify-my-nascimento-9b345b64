import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  AreaChart, Area, PieChart, Pie, LineChart, Line,
} from "recharts";
import {
  ArrowLeft, Trophy, CheckCircle2, Timer, Zap, CalendarDays, Star, TrendingUp,
  ShieldAlert, Sparkles,
} from "lucide-react";
import { STATUS_CHAMADO, CATEGORIAS, labelDe, mediaAvaliacao, type Chamado } from "./types";

// =====================================================================
// MEU DASHBOARD (Painel do Desenvolvedor) — visão pessoal, só do dev
// logado: cada um enxerga exclusivamente os próprios chamados (a query
// já filtra por responsavel_id = auth.uid(), sem opção de trocar de
// usuário nesta tela — diferente do Dashboard de Chamados, que é da
// equipe inteira e mora em /sistemas/chamados/dashboard-tv).
// =====================================================================

const DONUT: Record<string, string> = {
  aberto: "hsl(var(--warning))", em_andamento: "hsl(var(--info))",
  aguardando_retorno: "hsl(var(--primary))", concluido: "hsl(var(--success))",
  reprovado: "hsl(var(--destructive))",
};

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const TT_STYLE = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 } as const;

/** Conta de 0 até o valor quando ele muda — dá vida aos números do hero. */
function useContagem(valor: number, ms = 900) {
  const [n, setN] = useState(0);
  const anterior = useRef(0);
  useEffect(() => {
    const de = anterior.current, ate = valor;
    if (de === ate) return;
    let raf = 0; const t0 = performance.now();
    const passo = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setN(Math.round(de + (ate - de) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(passo); else anterior.current = ate;
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [valor, ms]);
  return n;
}

/** Tile do hero: número animado (aceita 1 casa decimal via `casas`). */
function Metrica({
  icon: Icon, label, valor, casas = 0, sufixo = "", hint, i,
}: { icon: typeof Trophy; label: string; valor: number; casas?: number; sufixo?: string; hint?: string; i: number }) {
  const fator = 10 ** casas;
  const n = useContagem(Math.round(valor * fator));
  return (
    <Card
      className="animate-rise-in relative overflow-hidden border-0 bg-gradient-to-br from-primary via-primary to-primary/70 p-4 text-primary-foreground shadow-lg"
      style={{ animationDelay: `${i * 70}ms` }}
    >
      <div className="motion-reduce:animate-none absolute -right-6 -top-8 h-24 w-24 animate-float-soft rounded-full bg-white/10 blur-2xl" />
      <div className="relative flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</p>
          <p className="font-display text-2xl font-black tabular-nums leading-tight">
            {(n / fator).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}{sufixo}
          </p>
        </div>
      </div>
      {hint && <p className="relative mt-1.5 truncate text-[11px] opacity-85">{hint}</p>}
    </Card>
  );
}

export default function DashboardDesenvolvedor() {
  const nav = useNavigate();
  const { user } = useAuth();
  const { data: access } = useAccessibleMenus("visualizar");
  const dev = access?.codes.has("chamados_sistemas_dev") ?? false;
  const nome = (user?.user_metadata as any)?.nome || user?.email || "";

  // Histórico completo do dev (não só a fila ativa) — é a base de todos os
  // gráficos. Sem filtro de status de propósito: dá pra ver a distribuição
  // por status também.
  const { data: chamados = [], isLoading } = useQuery({
    queryKey: ["chamados-dev-dashboard", user?.id],
    enabled: !!user?.id && dev,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("CHAMADO_SISTEMA")
        .select("*")
        .eq("responsavel_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as Chamado[];
    },
  });

  const { data: avaliacoes = [] } = useQuery({
    queryKey: ["chamados-dev-dashboard-avaliacoes", user?.id],
    enabled: !!user?.id && dev,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("CHAMADO_SISTEMA_AVALIACAO")
        .select("qualidade,prazo,comunicacao,clareza,facilidade,satisfacao,created_at,CHAMADO_SISTEMA!inner(responsavel_id)")
        .eq("CHAMADO_SISTEMA.responsavel_id", user!.id)
        .order("created_at", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as Array<{
        qualidade: number; prazo: number; comunicacao: number; clareza: number; facilidade: number; satisfacao: number;
        created_at: string;
      }>;
    },
  });

  const concluidos = useMemo(
    () => chamados.filter((c) => c.status === "concluido" && c.concluido_em),
    [chamados],
  );

  // ---- Horário do dia em que mais concluo chamados --------------------
  const porHora = useMemo(() => {
    const arr = Array.from({ length: 24 }, (_, h) => ({ hora: h, label: `${String(h).padStart(2, "0")}h`, v: 0 }));
    concluidos.forEach((c) => { arr[new Date(c.concluido_em!).getHours()].v++; });
    return arr;
  }, [concluidos]);
  const picoHora = useMemo(
    () => porHora.reduce((best, cur) => (cur.v > best.v ? cur : best), porHora[0]),
    [porHora],
  );
  const maxHora = Math.max(1, ...porHora.map((h) => h.v));

  // ---- Dia da semana ----------------------------------------------------
  const porDiaSemana = useMemo(() => {
    const arr = DIAS_SEMANA.map((label) => ({ label, v: 0 }));
    concluidos.forEach((c) => { arr[new Date(c.concluido_em!).getDay()].v++; });
    return arr;
  }, [concluidos]);
  const maxDia = Math.max(1, ...porDiaSemana.map((d) => d.v));
  const picoDia = useMemo(
    () => porDiaSemana.reduce((best, cur) => (cur.v > best.v ? cur : best), porDiaSemana[0]),
    [porDiaSemana],
  );

  // ---- Entregas nos últimos 12 meses ------------------------------------
  const porMes = useMemo(() => {
    const hoje = new Date();
    return Array.from({ length: 12 }, (_, k) => {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - (11 - k), 1);
      const fim = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      return {
        mes: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
        v: concluidos.filter((c) => { const dt = new Date(c.concluido_em!); return dt >= d && dt < fim; }).length,
      };
    });
  }, [concluidos]);

  // ---- Por status (todo o histórico) ------------------------------------
  const porStatus = useMemo(() => {
    const m: Record<string, number> = {};
    chamados.forEach((c) => { m[c.status] = (m[c.status] ?? 0) + 1; });
    return Object.entries(m).map(([status, value]) => ({ status, value }));
  }, [chamados]);

  // ---- Por categoria (top 6) ---------------------------------------------
  const porCategoria = useMemo(() => {
    const m = new Map<string, number>();
    chamados.forEach((c) => (c.categorias ?? []).forEach((cat) => {
      const label = labelDe(CATEGORIAS, cat);
      m.set(label, (m.get(label) ?? 0) + 1);
    }));
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([nome, v]) => ({ nome, v })).reverse();
  }, [chamados]);
  const maxCategoria = Math.max(1, ...porCategoria.map((c) => c.v));

  // ---- Satisfação ao longo do tempo (média por mês) ----------------------
  const satisfacaoPorMes = useMemo(() => {
    const m = new Map<string, { label: string; soma: number; n: number }>();
    avaliacoes.forEach((a) => {
      const d = new Date(a.created_at);
      const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const atual = m.get(chave) ?? { label: d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", ""), soma: 0, n: 0 };
      atual.soma += mediaAvaliacao(a as any);
      atual.n += 1;
      m.set(chave, atual);
    });
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12)
      .map(([, v]) => ({ mes: v.label, media: +(v.soma / v.n).toFixed(2) }));
  }, [avaliacoes]);

  // ---- Números do hero ----------------------------------------------------
  const mediaSatisfacao = avaliacoes.length
    ? avaliacoes.reduce((s, a) => s + mediaAvaliacao(a as any), 0) / avaliacoes.length
    : 0;
  const tempoMedioDias = useMemo(() => {
    if (!concluidos.length) return 0;
    const soma = concluidos.reduce((s, c) => s + (+new Date(c.concluido_em!) - +new Date(c.created_at)) / 86_400_000, 0);
    return soma / concluidos.length;
  }, [concluidos]);

  if (!dev) {
    return (
      <div>
        <PageHeader title="Meu Dashboard" module="Sistemas" breadcrumb={["Chamados de Sistemas", "Painel do Desenvolvedor", "Meu Dashboard"]} />
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" />
          Acesso restrito a desenvolvedores. Peça a liberação de <b>Chamados — Painel do Desenvolvedor</b> em Acesso por Usuário.
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Meu Dashboard"
        subtitle={`Seus números em Chamados de Sistemas${nome ? `, ${nome}` : ""} — só os seus dados, ninguém mais enxerga isto.`}
        module="Sistemas"
        breadcrumb={["Chamados de Sistemas", "Painel do Desenvolvedor", "Meu Dashboard"]}
        actions={
          <Button variant="outline" size="sm" onClick={() => nav("/app/sistemas/chamados/dev")} className="gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" /> Voltar ao painel
          </Button>
        }
      />

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Carregando seu histórico…</p>
      ) : (
        <div className="space-y-4">
          {/* ---------- Hero: 4 números animados ---------- */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metrica i={0} icon={CheckCircle2} label="Concluídos (total)" valor={concluidos.length} hint="Desde que você entrou na equipe" />
            <Metrica i={1} icon={Star} label="Minha satisfação" valor={mediaSatisfacao} casas={1} hint={`${avaliacoes.length} avaliação(ões) recebida(s)`} />
            <Metrica i={2} icon={Timer} label="Tempo médio de resolução" valor={tempoMedioDias} casas={1} sufixo=" dias" hint="Da abertura até a conclusão" />
            <Metrica
              i={3} icon={Zap} label="Horário mais produtivo"
              valor={picoHora?.v ? picoHora.hora : 0} sufixo="h"
              hint={picoHora?.v ? `${picoHora.v} conclusões às ${picoHora.label}` : "Ainda sem conclusões"}
            />
          </div>

          {/* ---------- Destaque: horário do dia (o gráfico pedido) ---------- */}
          <Card className="animate-rise-in relative overflow-hidden border-primary/10 bg-gradient-to-br from-card via-card to-primary/5 p-4 shadow-lg" style={{ animationDelay: "140ms" }}>
            <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
            <div className="relative">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-bold">
                  <Sparkles className="h-4 w-4 text-primary" /> Em qual horário eu mais concluo chamados
                </p>
                {picoHora?.v > 0 && (
                  <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                    Pico às {picoHora.label} · {picoHora.v} conclusões
                  </span>
                )}
              </div>
              <p className="mb-2 text-[11px] text-muted-foreground">Contagem de conclusões por hora do dia, considerando todo o seu histórico.</p>
              <div className="h-64">
                {concluidos.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Sem chamados concluídos ainda.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={porHora} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={1} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={TT_STYLE} formatter={(v: number) => [`${v} conclusão(ões)`, ""]} labelFormatter={(l) => `Às ${l}`} cursor={{ fill: "hsl(var(--primary) / 0.06)" }} />
                      <Bar dataKey="v" radius={[5, 5, 0, 0]} maxBarSize={28}>
                        {porHora.map((h, i) => (
                          <Cell key={i} fill={`hsl(var(--primary) / ${h.v === 0 ? 0.12 : 0.35 + (h.v / maxHora) * 0.65})`} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </Card>

          {/* ---------- Dia da semana + evolução mensal ---------- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="animate-rise-in relative overflow-hidden border-accent/20 bg-gradient-to-br from-card via-card to-accent/10 p-4 shadow-lg" style={{ animationDelay: "200ms" }}>
              <div className="absolute -left-8 -bottom-8 h-32 w-32 rounded-full bg-accent/15 blur-3xl" />
              <div className="relative">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-bold"><CalendarDays className="h-4 w-4 text-accent-foreground" /> Dia da semana</p>
                  {picoDia?.v > 0 && <span className="text-[11px] text-muted-foreground">Seu melhor dia: <b className="text-foreground">{picoDia.label}</b></span>}
                </div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={porDiaSemana} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={TT_STYLE} formatter={(v: number) => [`${v} conclusão(ões)`, ""]} cursor={{ fill: "hsl(var(--accent) / 0.08)" }} />
                      <Bar dataKey="v" radius={[5, 5, 0, 0]} maxBarSize={40}>
                        {porDiaSemana.map((d, i) => (
                          <Cell key={i} fill={`hsl(var(--accent) / ${d.v === 0 ? 0.15 : 0.4 + (d.v / maxDia) * 0.6})`} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </Card>

            <Card className="animate-rise-in relative overflow-hidden border-success/20 bg-gradient-to-br from-card via-card to-success/10 p-4 shadow-lg" style={{ animationDelay: "260ms" }}>
              <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-success/15 blur-3xl" />
              <div className="relative">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-bold"><TrendingUp className="h-4 w-4 text-success" /> Entregas nos últimos 12 meses</p>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={porMes} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="grad-entregas" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0.03} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="mes" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={TT_STYLE} formatter={(v: number) => [`${v} entrega(s)`, ""]} cursor={{ stroke: "hsl(var(--success))", strokeWidth: 1 }} />
                      <Area type="monotone" dataKey="v" stroke="hsl(var(--success))" strokeWidth={2.5} fill="url(#grad-entregas)" dot={{ r: 2.5, fill: "hsl(var(--success))" }} activeDot={{ r: 5 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </Card>
          </div>

          {/* ---------- Status + categoria ---------- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="animate-rise-in p-4 shadow-lg" style={{ animationDelay: "320ms" }}>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-bold"><CheckCircle2 className="h-4 w-4 text-primary" /> Meus chamados por status (histórico)</p>
              <div className="flex items-center gap-4">
                <div className="h-44 w-44 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={porStatus} dataKey="value" nameKey="status" cx="50%" cy="50%" innerRadius={42} outerRadius={68} paddingAngle={2}>
                        {porStatus.map((d) => <Cell key={d.status} fill={DONUT[d.status] ?? "hsl(var(--muted-foreground))"} />)}
                      </Pie>
                      <Tooltip contentStyle={TT_STYLE} formatter={(v: number, _n, p: any) => [`${v} chamado(s)`, STATUS_CHAMADO[p.payload.status]?.label ?? p.payload.status]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  {porStatus.map((d) => (
                    <div key={d.status} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 truncate">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: DONUT[d.status] ?? "hsl(var(--muted-foreground))" }} />
                        {STATUS_CHAMADO[d.status]?.label ?? d.status}
                      </span>
                      <span className="font-semibold">{d.value}</span>
                    </div>
                  ))}
                  {porStatus.length === 0 && <p className="text-xs text-muted-foreground">Sem chamados ainda.</p>}
                </div>
              </div>
            </Card>

            <Card className="animate-rise-in p-4 shadow-lg" style={{ animationDelay: "380ms" }}>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-bold"><Sparkles className="h-4 w-4 text-info" /> Categorias que mais resolvo</p>
              <div className="h-52">
                {porCategoria.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Sem dados ainda.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={porCategoria} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="nome" width={130} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={TT_STYLE} formatter={(v: number) => [`${v} chamado(s)`, ""]} cursor={{ fill: "hsl(var(--info) / 0.06)" }} />
                      <Bar dataKey="v" radius={[0, 5, 5, 0]} label={{ position: "right", fontSize: 11, fill: "hsl(var(--foreground))", fontWeight: 700 }}>
                        {porCategoria.map((c, i) => (
                          <Cell key={i} fill={`hsl(var(--info) / ${0.4 + (c.v / maxCategoria) * 0.6})`} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
          </div>

          {/* ---------- Satisfação ao longo do tempo ---------- */}
          <Card className="animate-rise-in relative overflow-hidden border-warning/20 bg-gradient-to-br from-card via-card to-warning/10 p-4 shadow-lg" style={{ animationDelay: "440ms" }}>
            <div className="absolute -right-10 -bottom-10 h-40 w-40 rounded-full bg-warning/15 blur-3xl" />
            <div className="relative">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-bold"><Trophy className="h-4 w-4 text-warning" /> Minha satisfação ao longo do tempo</p>
              <div className="h-52">
                {satisfacaoPorMes.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Você ainda não recebeu avaliações.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={satisfacaoPorMes} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="mes" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 5]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={TT_STYLE} formatter={(v: number) => [v.toFixed(1).replace(".", ","), "Média"]} />
                      <Line type="monotone" dataKey="media" stroke="hsl(var(--warning))" strokeWidth={2.5} dot={{ r: 3, fill: "hsl(var(--warning))" }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
