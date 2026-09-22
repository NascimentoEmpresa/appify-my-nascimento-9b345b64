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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  AreaChart, Area, PieChart, Pie, LineChart, Line,
} from "recharts";
import {
  ArrowLeft, Trophy, CheckCircle2, Timer, Zap, CalendarDays, Star, TrendingUp,
  ShieldAlert, Sparkles, Users, Hourglass, Clock4, Flame,
} from "lucide-react";
import { STATUS_CHAMADO, CATEGORIAS, labelDe, mediaAvaliacao, type Chamado } from "./types";

// =====================================================================
// MEU DASHBOARD (Painel do Desenvolvedor) — visão pessoal do dev logado
// por padrão: os gráficos vêm SÓ dos próprios chamados.
//
// Quem tem a capacidade "chamados_sistemas_dev_dashboard_geral" (liberada
// à parte, em Acesso por Usuário — NUNCA por cargo) ganha um seletor extra
// no topo: dá pra escolher outro desenvolvedor, ou "Todos" para uma visão
// agregada da equipe inteira. É só leitura — não entra em
// chamado_sistema_gestor(), então não libera mudar status/prioridade de
// chamado de ninguém.
//
// A capacidade nova reaproveita chamado_sistema_pode_ver_todos() (RLS já
// existente) em vez de policy nova — ver migration
// 20260930000214_chamados_dev_dashboard_permissao_geral.sql.
// =====================================================================

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] || nome;

const DONUT: Record<string, string> = {
  aberto: "hsl(var(--warning))", em_andamento: "hsl(var(--info))",
  aguardando_retorno: "hsl(var(--primary))", concluido: "hsl(var(--success))",
  reprovado: "hsl(var(--destructive))",
};

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// Hora Extra tem enum e RLS próprios (ver src/pages/sistemas/hora-extra/types.tsx
// e useHoraExtra.ts) — aqui só lê o histórico pessoal pros gráficos, sem duplicar
// a tela de Solicitações de Hora Extra.
const LABEL_STATUS_HE: Record<string, string> = {
  aguardando_liberacao: "Aguardando liberação", aprovada: "Aprovada",
  aguardando_validacao: "Aguardando validação", concluida: "Concluída", reprovada: "Reprovada",
};
const COR_STATUS_HE: Record<string, string> = {
  aguardando_liberacao: "hsl(var(--warning))", aprovada: "hsl(var(--info))",
  aguardando_validacao: "hsl(var(--primary))", concluida: "hsl(var(--success))", reprovada: "hsl(var(--destructive))",
};
// Faixa ampla o bastante para pegar todo o histórico sem precisar calcular hoje.
const HE_DATA_INICIO = "2000-01-01";
const HE_DATA_FIM = "2099-12-31";

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
  const podeVerOutros = access?.codes.has("chamados_sistemas_dev_dashboard_geral") ?? false;
  const nome = (user?.user_metadata as any)?.nome || user?.email || "";

  // "eu" (padrão) | "todos" | id de outro dev — só sai de "eu" quem tem a
  // capacidade extra. Some do seletor sozinho se a permissão for revogada, e
  // quem tem a capacidade mas não é "dev" (ex.: gestor que só revisa a
  // equipe) começa direto em "todos" — "eu" não faria sentido pra ele.
  const [alvo, setAlvo] = useState<string>("eu");
  useEffect(() => {
    if (!podeVerOutros && alvo !== "eu") { setAlvo("eu"); return; }
    if (!dev && podeVerOutros && alvo === "eu") setAlvo("todos");
  }, [podeVerOutros, dev, alvo]);

  const { data: devs = [] } = useQuery({
    queryKey: ["chamados-dev-dashboard-devs"],
    enabled: !!user?.id && dev && podeVerOutros,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("listar_desenvolvedores_chamados");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; display_name: string }>;
    },
  });

  // null = "todos" (sem filtro de responsavel_id — a RLS de
  // chamado_sistema_pode_ver_todos() é quem decide se isso retorna algo).
  const alvoId = alvo === "eu" ? user?.id ?? null : alvo === "todos" ? null : alvo;
  const nomeAlvo = alvo === "eu" ? (nome || "você")
    : alvo === "todos" ? "toda a equipe"
    : devs.find((d) => d.id === alvo)?.display_name ?? "esse desenvolvedor";
  // Só busca dado de terceiro se a permissão realmente estiver ligada — mesma
  // checagem da RLS, mas evita disparar a query à toa sem a capacidade.
  const podeCarregarAlvo = alvo === "eu" || podeVerOutros;

  // Histórico completo do alvo (não só a fila ativa) — é a base de todos os
  // gráficos. Sem filtro de status de propósito: dá pra ver a distribuição
  // por status também.
  const { data: chamados = [], isLoading } = useQuery({
    queryKey: ["chamados-dev-dashboard", alvoId ?? "todos"],
    enabled: !!user?.id && dev && podeCarregarAlvo,
    queryFn: async () => {
      let q = (supabase as any).from("CHAMADO_SISTEMA").select("*");
      if (alvoId) q = q.eq("responsavel_id", alvoId);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(5000);
      if (error) throw error;
      return (data ?? []) as Chamado[];
    },
  });

  const { data: avaliacoes = [] } = useQuery({
    queryKey: ["chamados-dev-dashboard-avaliacoes", alvoId ?? "todos"],
    enabled: !!user?.id && dev && podeCarregarAlvo,
    queryFn: async () => {
      let q = (supabase as any).from("CHAMADO_SISTEMA_AVALIACAO")
        .select("qualidade,prazo,comunicacao,clareza,facilidade,satisfacao,created_at,CHAMADO_SISTEMA!inner(responsavel_id)");
      if (alvoId) q = q.eq("CHAMADO_SISTEMA.responsavel_id", alvoId);
      const { data, error } = await q.order("created_at", { ascending: true }).limit(5000);
      if (error) throw error;
      return (data ?? []) as Array<{
        qualidade: number; prazo: number; comunicacao: number; clareza: number; facilidade: number; satisfacao: number;
        created_at: string;
      }>;
    },
  });

  // Histórico de Hora Extra do alvo — a RLS de HORA_EXTRA_SOLICITACAO só
  // libera a própria linha (ou quem tem "sistemas_hora_extra"/aprovar), então
  // em "todos"/outro dev sem essa outra permissão a consulta volta vazia em
  // vez de dar erro — o card mostra "sem dados" normalmente.
  const { data: horasExtras = [] } = useQuery({
    queryKey: ["chamados-dev-dashboard-he", alvoId ?? "todos"],
    enabled: !!user?.id && dev && podeCarregarAlvo,
    queryFn: async () => {
      let q = (supabase as any).from("HORA_EXTRA_SOLICITACAO")
        .select("data_he,tipo,status,total_previsto_min,total_real_min");
      if (alvoId) q = q.eq("colaborador_id", alvoId);
      const { data, error } = await q.gte("data_he", HE_DATA_INICIO).lte("data_he", HE_DATA_FIM)
        .order("data_he", { ascending: true }).limit(5000);
      if (error) throw error;
      return (data ?? []) as Array<{
        data_he: string; tipo: string; status: string; total_previsto_min: number; total_real_min: number | null;
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

  // ---- Horas extras --------------------------------------------------
  const heConcluidas = useMemo(() => horasExtras.filter((h) => h.status === "concluida"), [horasExtras]);
  const totalHorasHE = useMemo(
    () => heConcluidas.reduce((s, h) => s + (h.total_real_min ?? h.total_previsto_min ?? 0), 0) / 60,
    [heConcluidas],
  );
  const hePorMes = useMemo(() => {
    const hoje = new Date();
    return Array.from({ length: 12 }, (_, k) => {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - (11 - k), 1);
      const fim = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const minutos = heConcluidas
        .filter((h) => { const dt = new Date(`${h.data_he}T12:00:00`); return dt >= d && dt < fim; })
        .reduce((s, h) => s + (h.total_real_min ?? h.total_previsto_min ?? 0), 0);
      return { mes: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""), horas: +(minutos / 60).toFixed(1) };
    });
  }, [heConcluidas]);
  const maxHorasMes = Math.max(1, ...hePorMes.map((m) => m.horas));
  const hePorStatus = useMemo(() => {
    const m: Record<string, number> = {};
    horasExtras.forEach((h) => { m[h.status] = (m[h.status] ?? 0) + 1; });
    return Object.entries(m).map(([status, value]) => ({ status, value }));
  }, [horasExtras]);
  const heEmergenciais = useMemo(() => horasExtras.filter((h) => h.tipo === "emergencial").length, [horasExtras]);

  if (!dev && !podeVerOutros) {
    return (
      <div>
        <PageHeader title="Meu Dashboard" module="Sistemas" breadcrumb={["Chamados de Sistemas", "Painel do Desenvolvedor", "Meu Dashboard"]} />
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" />
          Acesso restrito. Peça a liberação de <b>Chamados — Painel do Desenvolvedor</b> (para ver o seu) ou de <b>Chamados — Ver Meu Dashboard de outros desenvolvedores</b> (para ver o da equipe) em Acesso por Usuário.
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={alvo === "eu" ? "Meu Dashboard" : alvo === "todos" ? "Dashboard — Todos os desenvolvedores" : `Dashboard — ${nomeAlvo}`}
        subtitle={
          alvo === "eu"
            ? `Seus números em Chamados de Sistemas${nome ? `, ${nome}` : ""} — só os seus dados, ninguém mais enxerga isto.`
            : alvo === "todos"
            ? "Visão agregada de todos os desenvolvedores — você está vendo por causa da sua permissão de Ver Dashboard de outros desenvolvedores."
            : `Números de ${nomeAlvo} — você está vendo por causa da sua permissão de Ver Dashboard de outros desenvolvedores.`
        }
        module="Sistemas"
        breadcrumb={["Chamados de Sistemas", "Painel do Desenvolvedor", "Meu Dashboard"]}
        actions={
          <>
            {podeVerOutros && (
              <Select value={alvo} onValueChange={setAlvo}>
                <SelectTrigger className="h-9 w-[220px] gap-1.5 text-xs">
                  <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dev && <SelectItem value="eu">Meu dashboard</SelectItem>}
                  <SelectItem value="todos">Todos (visão da equipe)</SelectItem>
                  {devs.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {dev && (
              <Button variant="outline" size="sm" onClick={() => nav("/app/sistemas/chamados/dev")} className="gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" /> Voltar ao painel
              </Button>
            )}
          </>
        }
      />

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Carregando o histórico…</p>
      ) : (
        <div className="space-y-4">
          {/* ---------- Hero: 4 números animados ---------- */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metrica
              i={0} icon={CheckCircle2} label="Concluídos (total)" valor={concluidos.length}
              hint={alvo === "eu" ? "Desde que você entrou na equipe" : alvo === "todos" ? "Soma de todos os desenvolvedores" : `Desde que ${primeiroNome(nomeAlvo)} entrou na equipe`}
            />
            <Metrica
              i={1} icon={Star} label={alvo === "eu" ? "Minha satisfação" : alvo === "todos" ? "Satisfação da equipe" : "Satisfação"}
              valor={mediaSatisfacao} casas={1} hint={`${avaliacoes.length} avaliação(ões) recebida(s)`}
            />
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
                  <Sparkles className="h-4 w-4 text-primary" />
                  {alvo === "eu" ? "Em qual horário eu mais concluo chamados"
                    : alvo === "todos" ? "Em qual horário a equipe mais conclui chamados"
                    : `Em qual horário ${nomeAlvo} mais conclui chamados`}
                </p>
                {picoHora?.v > 0 && (
                  <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                    Pico às {picoHora.label} · {picoHora.v} conclusões
                  </span>
                )}
              </div>
              <p className="mb-2 text-[11px] text-muted-foreground">Contagem de conclusões por hora do dia, considerando todo o histórico{alvo === "eu" ? " seu" : ""}.</p>
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
                  {picoDia?.v > 0 && <span className="text-[11px] text-muted-foreground">Melhor dia: <b className="text-foreground">{picoDia.label}</b></span>}
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
              <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                {alvo === "eu" ? "Meus chamados por status (histórico)" : alvo === "todos" ? "Chamados por status — toda a equipe (histórico)" : `Chamados de ${nomeAlvo} por status (histórico)`}
              </p>
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
              <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
                <Sparkles className="h-4 w-4 text-info" />
                {alvo === "eu" ? "Categorias que mais resolvo" : alvo === "todos" ? "Categorias que a equipe mais resolve" : `Categorias que ${nomeAlvo} mais resolve`}
              </p>
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
              <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
                <Trophy className="h-4 w-4 text-warning" />
                {alvo === "eu" ? "Minha satisfação ao longo do tempo" : alvo === "todos" ? "Satisfação da equipe ao longo do tempo" : `Satisfação de ${nomeAlvo} ao longo do tempo`}
              </p>
              <div className="h-52">
                {satisfacaoPorMes.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    {alvo === "eu" ? "Você ainda não recebeu avaliações." : "Sem avaliações registradas ainda."}
                  </div>
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

          {/* ---------- Horas extras ---------- */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Metrica
              i={4} icon={Hourglass} label="Horas extras (concluídas)" valor={totalHorasHE} casas={1} sufixo=" h"
              hint={`${heConcluidas.length} solicitação(ões) concluída(s)`}
            />
            <Metrica i={5} icon={Clock4} label="Solicitações de hora extra" valor={horasExtras.length} hint="Em qualquer status" />
            <Metrica i={6} icon={Flame} label="Emergenciais" valor={heEmergenciais} hint="Do total de solicitações" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="animate-rise-in relative overflow-hidden border-info/20 bg-gradient-to-br from-card via-card to-info/10 p-4 shadow-lg" style={{ animationDelay: "500ms" }}>
              <div className="absolute -left-10 -bottom-10 h-40 w-40 rounded-full bg-info/15 blur-3xl" />
              <div className="relative">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
                  <Hourglass className="h-4 w-4 text-info" />
                  {alvo === "eu" ? "Minhas horas extras por mês" : alvo === "todos" ? "Horas extras da equipe por mês" : `Horas extras de ${nomeAlvo} por mês`}
                </p>
                <div className="h-52">
                  {heConcluidas.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Sem hora extra concluída ainda.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={hePorMes} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="mes" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={TT_STYLE} formatter={(v: number) => [`${v.toFixed(1).replace(".", ",")} h`, ""]} cursor={{ fill: "hsl(var(--info) / 0.06)" }} />
                        <Bar dataKey="horas" radius={[5, 5, 0, 0]} maxBarSize={40}>
                          {hePorMes.map((m, i) => (
                            <Cell key={i} fill={`hsl(var(--info) / ${m.horas === 0 ? 0.12 : 0.4 + (m.horas / maxHorasMes) * 0.6})`} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </Card>

            <Card className="animate-rise-in p-4 shadow-lg" style={{ animationDelay: "560ms" }}>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
                <Clock4 className="h-4 w-4 text-primary" />
                {alvo === "eu" ? "Status das minhas solicitações de HE" : alvo === "todos" ? "Status das solicitações de HE — equipe" : `Status das solicitações de HE de ${nomeAlvo}`}
              </p>
              <div className="flex items-center gap-4">
                <div className="h-40 w-40 shrink-0">
                  {hePorStatus.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Sem dados ainda.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={hePorStatus} dataKey="value" nameKey="status" cx="50%" cy="50%" innerRadius={38} outerRadius={62} paddingAngle={2}>
                          {hePorStatus.map((d) => <Cell key={d.status} fill={COR_STATUS_HE[d.status] ?? "hsl(var(--muted-foreground))"} />)}
                        </Pie>
                        <Tooltip contentStyle={TT_STYLE} formatter={(v: number, _n, p: any) => [`${v} solicitação(ões)`, LABEL_STATUS_HE[p.payload.status] ?? p.payload.status]} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  {hePorStatus.map((d) => (
                    <div key={d.status} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 truncate">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COR_STATUS_HE[d.status] ?? "hsl(var(--muted-foreground))" }} />
                        {LABEL_STATUS_HE[d.status] ?? d.status}
                      </span>
                      <span className="font-semibold">{d.value}</span>
                    </div>
                  ))}
                  {hePorStatus.length === 0 && <p className="text-xs text-muted-foreground">Sem solicitações ainda.</p>}
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
