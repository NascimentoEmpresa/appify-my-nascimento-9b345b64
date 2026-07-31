import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useChamadoPerms } from "./useChamadoPerms";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Cell } from "recharts";
import { Maximize2, Minimize2, ShieldAlert, Star } from "lucide-react";
import {
  STATUS_CHAMADO, CATEGORIAS, labelDe, chamadoAtivo, posicoesFilaGlobal, posicoesFilaDev, mediaAvaliacao, iniciais,
  type Chamado,
} from "./types";

// =====================================================================
// DASHBOARD DE CHAMADOS — PAINEL DE PAREDE (TV).
//
// Regra de ouro desta tela: cabe TUDO em uma única tela, sem rolagem.
// Por isso ela não usa o layout de cards do resto do ERP:
//   · a altura é fixa (100dvh no Modo TV) e toda a tipografia escala em
//     cima de --u (1% da altura do painel), então o mesmo layout serve
//     num monitor de 1080p e numa TV 4K sem ajuste;
//   · quando há mais desenvolvedores do que cabe na grade, o painel
//     ALTERNA sozinho entre as páginas (a TV nunca precisa de scroll);
//   · avaliação aparece resumida — só as estrelas, sem tabela nem
//     médias por critério (a análise fina fica no Painel do Dev).
//
// A ambientação (orbes que derivam ao fundo, brilho que atravessa o
// cabeçalho, cards que entram flutuando, ticker contínuo) é feita em CSS
// escopado na classe .tvb, logo abaixo — nenhum estado do React anima
// nada por frame, senão a TV esquenta à toa rodando 24h.
// =====================================================================

const CSS = `
.tvb {
  --u: 1vh;                       /* unidade base: 1% da altura do painel */
  --tvb-bg: 222 45% 7%;
  --tvb-card: 220 45% 13%;
  --tvb-line: 218 40% 24%;
  --tvb-text: 210 30% 95%;
  --tvb-dim: 215 20% 62%;
  position: relative; overflow: hidden; isolation: isolate;
  display: flex; flex-direction: column;
  gap: calc(var(--u) * 1.4);
  padding: calc(var(--u) * 2);
  border-radius: calc(var(--u) * 1.6);
  background:
    radial-gradient(120% 90% at 12% 0%, hsl(218 70% 18% / 0.85) 0%, transparent 60%),
    radial-gradient(90% 80% at 100% 100%, hsl(22 80% 30% / 0.28) 0%, transparent 62%),
    linear-gradient(160deg, hsl(var(--tvb-bg)) 0%, hsl(220 48% 9%) 55%, hsl(222 45% 6%) 100%);
  color: hsl(var(--tvb-text));
  font-variant-numeric: tabular-nums;
}
.tvb--tv { border-radius: 0; padding: calc(var(--u) * 2.2); }
/* Embutido no ERP também vai de ponta a ponta (sem moldura arredondada). */
.tvb--flush { border-radius: 0; }

/* --- Ambientação: orbes que derivam devagar atrás de tudo ------------ */
.tvb-orb { position: absolute; border-radius: 9999px; filter: blur(calc(var(--u) * 5)); z-index: 0; pointer-events: none; }
.tvb-orb--a { width: 42%; aspect-ratio: 1; left: -8%; top: -18%;
  background: radial-gradient(circle, hsl(218 90% 45% / 0.34) 0%, hsl(218 90% 45% / 0.08) 55%, transparent 70%);
  animation: tvb-drift 14s ease-in-out infinite; }
.tvb-orb--b { width: 34%; aspect-ratio: 1; right: -6%; bottom: -14%;
  background: radial-gradient(circle, hsl(22 95% 54% / 0.26) 0%, hsl(22 95% 54% / 0.07) 52%, transparent 68%);
  animation: tvb-drift 18s ease-in-out -4s infinite reverse; }
.tvb-orb--c { width: 26%; aspect-ratio: 1; left: 46%; top: 34%;
  background: radial-gradient(circle, hsl(200 90% 50% / 0.16) 0%, transparent 66%);
  animation: tvb-drift 12s ease-in-out -2s infinite; }
@keyframes tvb-drift {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50%      { transform: translate(calc(var(--u) * -2.4), calc(var(--u) * 2.8)) scale(1.07); }
}

/* --- Superfícies ----------------------------------------------------- */
.tvb-panel {
  position: relative; z-index: 1; overflow: hidden;
  border-radius: calc(var(--u) * 1.5);
  border: 1px solid hsl(var(--tvb-line) / 0.75);
  background: linear-gradient(165deg, hsl(var(--tvb-card) / 0.92) 0%, hsl(220 45% 11% / 0.86) 55%, hsl(220 45% 10% / 0.9) 100%);
  box-shadow: 0 calc(var(--u) * 1.2) calc(var(--u) * 3) hsl(222 60% 3% / 0.45), inset 0 1px 0 hsl(0 0% 100% / 0.05);
  backdrop-filter: blur(6px);
}
/* Brilho que atravessa a borda de cima do cabeçalho */
.tvb-shine::before {
  content: ""; position: absolute; inset: 0 0 auto 0; height: 1px;
  background: linear-gradient(to right, transparent, hsl(22 95% 60% / 0.5) 30%, hsl(210 90% 65% / 0.6) 55%, transparent);
  animation: tvb-sweep 4s ease-in-out infinite;
}
@keyframes tvb-sweep { 0%, 100% { opacity: 0.3; transform: scaleX(0.75); } 50% { opacity: 0.85; transform: scaleX(1); } }

/* --- Entrada dos cards (escalonada) ---------------------------------- */
.tvb-enter { opacity: 0; animation: tvb-in 0.65s cubic-bezier(0.16, 1, 0.3, 1) forwards; animation-delay: calc(var(--i, 0) * 70ms); }
@keyframes tvb-in { from { opacity: 0; transform: translateY(calc(var(--u) * 2)) scale(0.985); } to { opacity: 1; transform: none; } }

/* --- Pulso do "ao vivo" ---------------------------------------------- */
.tvb-live { position: relative; }
.tvb-live::after {
  content: ""; position: absolute; inset: calc(var(--u) * -0.5); border-radius: 9999px;
  border: 1px solid hsl(142 70% 50% / 0.7); animation: tvb-pulse 2.4s ease-out infinite;
}
@keyframes tvb-pulse { 0% { transform: scale(0.7); opacity: 0.9; } 100% { transform: scale(2.1); opacity: 0; } }

/* --- Escala tipográfica (tudo em cima de --u) ------------------------ */
.tvb-title   { font-size: calc(var(--u) * 3.1); font-weight: 800; letter-spacing: -0.02em; line-height: 1.05; }
.tvb-sub     { font-size: calc(var(--u) * 1.35); color: hsl(var(--tvb-dim)); letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; }
.tvb-kpi-n   { font-size: calc(var(--u) * 4.4); font-weight: 800; line-height: 1.12; letter-spacing: -0.03em; }
.tvb-kpi-l   { font-size: calc(var(--u) * 1.25); color: hsl(var(--tvb-dim)); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.tvb-clock   { font-size: calc(var(--u) * 4.2); font-weight: 800; line-height: 1.12; letter-spacing: -0.02em; }
.tvb-h       { font-size: calc(var(--u) * 1.5); font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: hsl(var(--tvb-dim)); }
.tvb-name    { font-size: calc(var(--u) * 2.1); font-weight: 700; line-height: 1.1; }
.tvb-big     { font-size: calc(var(--u) * 3.6); font-weight: 800; line-height: 1.12; }
.tvb-mini    { font-size: calc(var(--u) * 1.25); color: hsl(var(--tvb-dim)); font-weight: 600; }
.tvb-item    { font-size: calc(var(--u) * 1.55); font-weight: 600; line-height: 1.25; }
.tvb-item-s  { font-size: calc(var(--u) * 1.2); color: hsl(var(--tvb-dim)); line-height: 1.3; }
/* Título de solicitação: até 2 linhas antes de cortar (nada de "…" na 1ª). */
.tvb-2l { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

@media (prefers-reduced-motion: reduce) {
  .tvb-orb, .tvb-shine::before, .tvb-live::after { animation: none; }
  .tvb-enter { opacity: 1; animation: none; }
}
`;

/** Cor de cada prioridade dentro do painel (fixa: a TV não tem tema claro). */
const COR_PRIO: Record<string, string> = {
  alta: "0 80% 62%", media: "38 95% 58%", baixa: "152 55% 50%",
};
const COR_STATUS: Record<string, string> = {
  aberto: "38 95% 58%", em_andamento: "205 90% 60%", aguardando_retorno: "265 80% 70%",
  concluido: "152 60% 48%", reprovado: "0 80% 62%",
};

// 5 devs por página: a 6ª célula da grade é sempre o card de gráficos.
const POR_PAGINA = 5;
const SEGUNDOS_POR_PAGINA = 15;
const SEGUNDOS_POR_GRAFICO = 9;

/** "Eduardo Jeiel Padilha Monteiro" → "Eduardo Monteiro" (cabe na TV inteiro). */
const nomeCurto = (nome: string) => {
  const p = nome.trim().split(/\s+/).filter((x) => x.length > 2 || /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(x));
  return p.length <= 2 ? nome.trim() : `${p[0]} ${p[p.length - 1]}`;
};

interface Resumo {
  id: string; nome: string;
  fila: number; em_andamento: number; aguardando: number; atrasados: number; concluidos_mes: number;
  estrelas: number; avaliacoes: number;
  top3: Chamado[];
}

/** Grade que melhor preenche a tela para N cards (sem deixar buraco). */
function grade(n: number) {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 2, rows: 1 };
  if (n === 3) return { cols: 3, rows: 1 };
  if (n === 4) return { cols: 2, rows: 2 };
  return { cols: 3, rows: 2 };
}

/** Conta de 0 até o valor quando ele muda (dá vida aos indicadores). */
function useContagem(valor: number, ms = 700) {
  const [n, setN] = useState(valor);
  const anterior = useRef(valor);
  useEffect(() => {
    const de = anterior.current, ate = valor;
    anterior.current = valor;
    if (de === ate) return;
    let raf = 0; const t0 = performance.now();
    const passo = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setN(Math.round(de + (ate - de) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [valor, ms]);
  return n;
}

/** Estrelas cheias/vazias em escala de TV (resumo, sem números por critério). */
function EstrelasTV({ valor, avaliacoes }: { valor: number; avaliacoes: number }) {
  if (!avaliacoes) return <span className="tvb-mini">sem avaliação</span>;
  return (
    <span className="flex items-center gap-[0.35em]" title={`${valor.toFixed(1)} de 5 · ${avaliacoes} avaliação(ões)`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const cheia = Math.min(1, Math.max(0, valor - (n - 1)));
        return (
          <span key={n} className="relative block" style={{ width: "calc(var(--u) * 1.9)", height: "calc(var(--u) * 1.9)" }}>
            <Star className="absolute inset-0 h-full w-full" style={{ color: "hsl(var(--tvb-line))" }} strokeWidth={1.5} />
            {cheia > 0 && (
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${cheia * 100}%` }}>
                <Star className="h-full w-full" style={{ color: "hsl(38 95% 58%)", fill: "hsl(38 95% 58%)" }} strokeWidth={1.5} />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/** Divisória entre os indicadores (border-color não é herdada, então vai inline). */
const SEPARADOR = { borderColor: "hsl(var(--tvb-line) / 0.7)" } as const;

function Kpi({ valor, label, cor }: { valor: number; label: string; cor: string }) {
  const n = useContagem(valor);
  return (
    <div className="flex flex-col items-center justify-center border-l px-[calc(var(--u)*1.6)] first:border-l-0" style={SEPARADOR}>
      <span className="tvb-kpi-n" style={{ color: `hsl(${cor})` }}>{n}</span>
      <span className="tvb-kpi-l">{label}</span>
    </div>
  );
}

/**
 * Card de gráficos — ocupa uma célula da grade (mesmo tamanho dos cards de
 * desenvolvedor) e alterna sozinho entre três recortes dos chamados.
 */
function CardGraficos({ chamados, upx }: { chamados: Chamado[]; upx: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % 3), SEGUNDOS_POR_GRAFICO * 1000);
    return () => clearInterval(t);
  }, []);

  const graficos = useMemo(() => {
    const topN = (m: Map<string, number>, n: number) =>
      [...m].filter(([k]) => k).sort((a, b) => b[1] - a[1]).slice(0, n).map(([nome, v]) => ({ nome, v })).reverse();

    const porCategoria = new Map<string, number>();
    chamados.forEach((c) => c.categorias.forEach((cat) => porCategoria.set(labelDe(CATEGORIAS, cat), (porCategoria.get(labelDe(CATEGORIAS, cat)) ?? 0) + 1)));

    const porSetor = new Map<string, number>();
    chamados.forEach((c) => { if (c.setor) porSetor.set(c.setor, (porSetor.get(c.setor) ?? 0) + 1); });

    // Entregas dos últimos 6 meses (do mais antigo para o mais recente).
    const hoje = new Date();
    const meses = Array.from({ length: 6 }, (_, k) => {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - (5 - k), 1);
      const fim = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      return {
        nome: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
        v: chamados.filter((c) => c.concluido_em && new Date(c.concluido_em) >= d && new Date(c.concluido_em) < fim).length,
      };
    });

    return [
      { titulo: "Chamados por categoria", dados: topN(porCategoria, 5), cor: "218 90% 58%", horizontal: true },
      { titulo: "Entregas por mês", dados: meses, cor: "152 60% 48%", horizontal: false },
      { titulo: "Setores que mais abrem", dados: topN(porSetor, 5), cor: "22 95% 58%", horizontal: true },
    ];
  }, [chamados]);

  const g = graficos[i];
  const vazio = g.dados.every((d) => d.v === 0);

  return (
    <article className="tvb-panel tvb-enter flex min-h-0 flex-col p-[calc(var(--u)*1.5)]" style={{ ["--i" as any]: 5 }}>
      <div className="mb-[calc(var(--u)*0.8)] flex shrink-0 items-center justify-between gap-[calc(var(--u)*1)]">
        <p className="tvb-h truncate">{g.titulo}</p>
        <span className="flex shrink-0 items-center gap-[calc(var(--u)*0.5)]">
          {graficos.map((_, k) => (
            <span
              key={k}
              className="rounded-full transition-all duration-500"
              style={{
                width: k === i ? "calc(var(--u) * 1.8)" : "calc(var(--u) * 0.7)", height: "calc(var(--u) * 0.7)",
                background: k === i ? `hsl(${g.cor})` : "hsl(var(--tvb-line))",
              }}
            />
          ))}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {vazio ? (
          <div className="flex h-full items-center justify-center"><span className="tvb-mini">Sem dados ainda</span></div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {g.horizontal ? (
              <BarChart data={g.dados} layout="vertical" margin={{ top: 2, right: upx * 3, left: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category" dataKey="nome" width={upx * 11} axisLine={false} tickLine={false}
                  tick={{ fontSize: upx * 1.15, fill: "hsl(215 20% 68%)" }}
                />
                <Bar dataKey="v" radius={[0, upx * 0.4, upx * 0.4, 0]} label={{ position: "right", fontSize: upx * 1.3, fill: "hsl(210 30% 92%)", fontWeight: 700 }}>
                  {g.dados.map((_, k) => <Cell key={k} fill={`hsl(${g.cor} / ${0.45 + (k / Math.max(1, g.dados.length - 1)) * 0.55})`} />)}
                </Bar>
              </BarChart>
            ) : (
              <BarChart data={g.dados} margin={{ top: upx * 2, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="nome" axisLine={false} tickLine={false} tick={{ fontSize: upx * 1.15, fill: "hsl(215 20% 68%)" }} />
                <YAxis hide />
                <Bar dataKey="v" radius={[upx * 0.4, upx * 0.4, 0, 0]} label={{ position: "top", fontSize: upx * 1.3, fill: "hsl(210 30% 92%)", fontWeight: 700 }}>
                  {g.dados.map((_, k) => <Cell key={k} fill={`hsl(${g.cor} / ${0.45 + (k / Math.max(1, g.dados.length - 1)) * 0.55})`} />)}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </article>
  );
}

export default function DashboardChamados() {
  const { gestor } = useChamadoPerms();
  const [tv, setTv] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [agora, setAgora] = useState(() => new Date());

  // Altura embutida: medida a partir de onde o painel começa até o fim da
  // janela. Chutar "100dvh menos o topo" erra quando o banner de demonstração
  // aparece, e qualquer pixel a mais devolve a barra de rolagem que a TV não
  // pode ter.
  const caixa = useRef<HTMLDivElement>(null);
  const [altura, setAltura] = useState<number | null>(null);
  const [alturaJanela, setAlturaJanela] = useState(() => window.innerHeight);
  useLayoutEffect(() => {
    const medir = () => {
      setAlturaJanela(window.innerHeight);
      const el = caixa.current;
      if (!tv && el) setAltura(Math.max(540, Math.round(window.innerHeight - el.getBoundingClientRect().top)));
    };
    if (tv) setAltura(null);
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [tv]);
  /** Valor de --u em px — o recharts precisa de número, não de calc(). */
  const upx = (tv ? alturaJanela : altura ?? alturaJanela) / 100;

  // No Modo TV a página de trás não pode rolar, senão sobra a faixa clara da
  // barra de rolagem na direita do painel.
  useEffect(() => {
    if (!tv) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = anterior; };
  }, [tv]);

  // Relógio (1s) — a TV fica ligada o dia todo, então nada mais roda por frame.
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Modo TV: overlay em tela cheia + fullscreen do navegador. Sai com ESC.
  const alternarTv = async () => {
    const entrando = !tv;
    setTv(entrando);
    try {
      if (entrando) await document.documentElement.requestFullscreen?.();
      else if (document.fullscreenElement) await document.exitFullscreen?.();
    } catch { /* navegador pode recusar sem gesto do usuário — o overlay já resolve */ }
  };
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setTv(false); };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  // ?tv=1 abre direto no modo painel (link que fica salvo na TV).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tv") === "1") setTv(true);
  }, []);

  // ---- Dados (recarregam sozinhos: o painel fica dias no ar) ----------
  const { data: usuarios = [] } = useQuery({
    queryKey: ["chamados-usuarios"],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("listar_usuarios_ativos");
      return (data ?? []) as Array<{ id: string; display_name: string }>;
    },
  });
  const nomeDe = (id: string | null) => (id ? usuarios.find((u) => u.id === id)?.display_name ?? "—" : "—");

  const { data: devs = [] } = useQuery({
    queryKey: ["chamados-devs"],
    enabled: gestor,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("listar_desenvolvedores_chamados");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; display_name: string }>;
    },
  });

  const { data: chamados = [], isLoading } = useQuery({
    queryKey: ["chamados-todos"],
    enabled: gestor,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("CHAMADO_SISTEMA").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Chamado[];
    },
  });

  // Avaliações: aqui só interessam as estrelas (média ponderada por dev).
  const { data: avaliacoes = [] } = useQuery({
    queryKey: ["chamados-avaliacoes-todas"],
    enabled: gestor,
    refetchInterval: 300_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("CHAMADO_SISTEMA_AVALIACAO")
        .select("qualidade,prazo,comunicacao,clareza,facilidade,satisfacao,CHAMADO_SISTEMA!inner(responsavel_id)");
      if (error) throw error;
      return (data ?? []) as Array<Record<string, any> & { CHAMADO_SISTEMA: { responsavel_id: string | null } | null }>;
    },
  });

  // ---- Cálculos -------------------------------------------------------
  const hoje = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, [agora.getHours()]);
  const posGlobal = useMemo(() => posicoesFilaGlobal(chamados), [chamados]);
  const posDev = useMemo(() => posicoesFilaDev(chamados), [chamados]);

  const resumos = useMemo<Resumo[]>(() => {
    const ids = new Map<string, string>();
    devs.forEach((d) => ids.set(d.id, d.display_name));
    chamados.forEach((c) => { if (c.responsavel_id && !ids.has(c.responsavel_id)) ids.set(c.responsavel_id, nomeDe(c.responsavel_id)); });

    const notas = new Map<string, number[]>();
    avaliacoes.forEach((a) => {
      const rid = a.CHAMADO_SISTEMA?.responsavel_id;
      if (rid) notas.set(rid, [...(notas.get(rid) ?? []), mediaAvaliacao(a as any)]);
    });

    const mesIni = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    return [...ids].map(([id, nome]) => {
      const meus = chamados.filter((c) => c.responsavel_id === id);
      const ativos = meus.filter((c) => chamadoAtivo(c.status));
      const n = notas.get(id) ?? [];
      return {
        id, nome,
        fila: ativos.length,
        em_andamento: meus.filter((c) => c.status === "em_andamento").length,
        aguardando: meus.filter((c) => c.status === "aguardando_retorno").length,
        atrasados: ativos.filter((c) => c.prazo_previsto && new Date(c.prazo_previsto) < hoje).length,
        concluidos_mes: meus.filter((c) => c.status === "concluido" && c.concluido_em && new Date(c.concluido_em) >= mesIni).length,
        estrelas: n.length ? n.reduce((s, v) => s + v, 0) / n.length : 0,
        avaliacoes: n.length,
        top3: ativos.filter((c) => posDev[c.id]).sort((a, b) => posDev[a.id] - posDev[b.id]).slice(0, 3),
      };
    }).sort((a, b) => b.fila - a.fila || a.nome.localeCompare(b.nome, "pt-BR"));
  }, [devs, chamados, avaliacoes, posDev, hoje, usuarios]);

  const paginas = Math.max(1, Math.ceil(resumos.length / POR_PAGINA));
  const paginaAtual = pagina % paginas;
  const visiveis = resumos.slice(paginaAtual * POR_PAGINA, paginaAtual * POR_PAGINA + POR_PAGINA);
  // +1 = o card de gráficos, que ocupa uma célula igual à dos devs.
  const { cols, rows } = grade(visiveis.length + 1);

  // Alterna as páginas sozinho — é o que substitui a rolagem na TV.
  useEffect(() => {
    if (paginas <= 1) return;
    const t = setInterval(() => setPagina((p) => p + 1), SEGUNDOS_POR_PAGINA * 1000);
    return () => clearInterval(t);
  }, [paginas]);

  const geral = useMemo(() => {
    const ativos = chamados.filter((c) => chamadoAtivo(c.status));
    const mesIni = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const todasNotas = avaliacoes.map((a) => mediaAvaliacao(a as any));
    return {
      fila: ativos.length,
      em_andamento: chamados.filter((c) => c.status === "em_andamento").length,
      aguardando: chamados.filter((c) => c.status === "aguardando_retorno").length,
      concluidos_mes: chamados.filter((c) => c.status === "concluido" && c.concluido_em && new Date(c.concluido_em) >= mesIni).length,
      atrasados: ativos.filter((c) => c.prazo_previsto && new Date(c.prazo_previsto) < hoje).length,
      nota: todasNotas.length ? todasNotas.reduce((s, v) => s + v, 0) / todasNotas.length : 0,
      avaliacoes: todasNotas.length,
    };
  }, [chamados, avaliacoes, hoje]);

  // Próximos da fila geral (ordem de chegada) — coluna da direita.
  const proximos = useMemo(
    () => chamados.filter((c) => posGlobal[c.id]).sort((a, b) => posGlobal[a.id] - posGlobal[b.id]).slice(0, 6),
    [chamados, posGlobal],
  );

  const statusBarras = useMemo(() => {
    const total = chamados.length || 1;
    return Object.keys(STATUS_CHAMADO).map((s) => {
      const n = chamados.filter((c) => c.status === s).length;
      return { status: s, n, pct: (n / total) * 100 };
    });
  }, [chamados]);

  const cargaMax = Math.max(1, ...resumos.map((r) => r.fila));

  if (!gestor) {
    return (
      <div>
        <PageHeader title="Dashboard de Chamados" module="Sistemas" breadcrumb={["Chamados de Sistemas", "Dashboard de Chamados"]} />
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" />
          Você não tem acesso ao painel de gestão. Peça a liberação de <b>Chamados — Painel de Distribuição</b>, <b>Coordenar</b> ou <b>Aprovar</b> em Acesso por Usuário.
        </Card>
      </div>
    );
  }

  const hora = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const segundos = agora.toLocaleTimeString("pt-BR", { second: "2-digit" }).padStart(2, "0");
  const dataExt = agora.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

  const painel = (
    <div
      ref={caixa}
      // Fora do Modo TV o painel ainda ocupa TUDO: as margens negativas anulam
      // o padding do <main> do ERP, então não sobra moldura clara na direita
      // nem embaixo — a altura é medida (não chutada) para não gerar rolagem.
      className={`tvb ${tv ? "tvb--tv h-[100dvh] w-screen" : "tvb--flush -m-4 sm:-m-6 lg:-m-8"}`}
      style={tv ? undefined : { height: altura ?? undefined, ["--u" as any]: `calc(${altura ?? 0}px / 100)` }}
    >
      <style>{CSS}</style>
      <div className="tvb-orb tvb-orb--a" /><div className="tvb-orb tvb-orb--b" /><div className="tvb-orb tvb-orb--c" />

      {/* ---------- Cabeçalho: identidade, indicadores e relógio ---------- */}
      <header className="tvb-panel tvb-shine flex shrink-0 items-center gap-[calc(var(--u)*2)] px-[calc(var(--u)*2.4)] py-[calc(var(--u)*1.6)]">
        <div className="min-w-0">
          <p className="tvb-sub">Chamados de Sistemas</p>
          <h1 className="tvb-title">Painel da Equipe</h1>
          {/* Indicador de página (a grade alterna sozinha quando há mais devs) */}
          {paginas > 1 && (
            <span className="mt-[calc(var(--u)*0.7)] flex items-center gap-[calc(var(--u)*0.5)]">
              {Array.from({ length: paginas }).map((_, i) => (
                <span
                  key={i}
                  className="rounded-full transition-all duration-500"
                  style={{
                    width: i === paginaAtual ? "calc(var(--u) * 2.2)" : "calc(var(--u) * 0.7)",
                    height: "calc(var(--u) * 0.7)",
                    background: i === paginaAtual ? "hsl(22 95% 58%)" : "hsl(var(--tvb-line))",
                  }}
                />
              ))}
            </span>
          )}
        </div>

        <div className="mx-auto flex items-center">
          <Kpi valor={geral.fila} label="Na fila" cor="210 30% 95%" />
          <Kpi valor={geral.em_andamento} label="Em andamento" cor="205 90% 62%" />
          <Kpi valor={geral.aguardando} label="Aguardando" cor="265 80% 72%" />
          <Kpi valor={geral.concluidos_mes} label="Concluídos/mês" cor="152 60% 50%" />
          <Kpi valor={geral.atrasados} label="Atrasados" cor={geral.atrasados > 0 ? "0 80% 62%" : "215 20% 62%"} />
          <div className="flex flex-col items-center justify-center gap-[calc(var(--u)*0.6)] border-l px-[calc(var(--u)*1.6)]" style={SEPARADOR}>
            <EstrelasTV valor={geral.nota} avaliacoes={geral.avaliacoes} />
            <span className="tvb-kpi-l">Satisfação</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-[calc(var(--u)*1.6)]">
          <div className="text-right">
            <p className="tvb-clock">
              {hora}<span className="tvb-mini ml-[0.2em]">{segundos}</span>
            </p>
            <p className="tvb-mini flex items-center justify-end gap-[calc(var(--u)*0.8)] capitalize">
              <span className="tvb-live inline-block h-[calc(var(--u)*0.8)] w-[calc(var(--u)*0.8)] rounded-full" style={{ background: "hsl(142 70% 50%)" }} />
              {dataExt}
            </p>
          </div>
          <button
            onClick={alternarTv}
            title={tv ? "Sair do modo TV (ESC)" : "Modo TV (tela cheia)"}
            className="grid shrink-0 place-items-center rounded-full border transition-transform hover:scale-110"
            style={{
              borderColor: "hsl(var(--tvb-line))", background: "hsl(220 45% 16% / 0.8)",
              width: "calc(var(--u) * 4.4)", height: "calc(var(--u) * 4.4)",
            }}
          >
            {tv ? <Minimize2 className="h-[calc(var(--u)*2)] w-[calc(var(--u)*2)]" /> : <Maximize2 className="h-[calc(var(--u)*2)] w-[calc(var(--u)*2)]" />}
          </button>
        </div>
      </header>

      {/* ---------- Corpo: equipe (esquerda) + fila e status (direita) ---------- */}
      <main className="grid min-h-0 flex-1 gap-[calc(var(--u)*1.4)]" style={{ gridTemplateColumns: "minmax(0, 2.35fr) minmax(0, 1fr)" }}>
        {/* Cards dos desenvolvedores — remontam a cada página (reanimam a entrada) */}
        <div
          key={paginaAtual}
          className="grid min-h-0 gap-[calc(var(--u)*1.4)]"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
        >
          {visiveis.map((r, i) => (
            <article
              key={r.id}
              className="tvb-panel tvb-enter flex min-h-0 flex-col gap-[calc(var(--u)*1.1)] p-[calc(var(--u)*1.5)]"
              style={{ ["--i" as any]: i }}
            >
              {/* Quem é + estrelas (resumo da avaliação) */}
              <div className="flex items-center gap-[calc(var(--u)*1.2)]">
                <span
                  className="grid shrink-0 place-items-center rounded-full font-bold"
                  style={{
                    width: "calc(var(--u) * 4.6)", height: "calc(var(--u) * 4.6)", fontSize: "calc(var(--u) * 1.7)",
                    background: "linear-gradient(135deg, hsl(218 78% 34%), hsl(218 60% 24%))",
                    boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.18)",
                  }}
                >
                  {iniciais(r.nome)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="tvb-name truncate" title={r.nome}>{nomeCurto(r.nome)}</p>
                  <EstrelasTV valor={r.estrelas} avaliacoes={r.avaliacoes} />
                </div>
                <div className="shrink-0 text-right">
                  <p className="tvb-big" style={{ color: r.atrasados > 0 ? "hsl(0 80% 66%)" : "hsl(var(--tvb-text))" }}>{r.fila}</p>
                  <p className="tvb-mini">na fila</p>
                </div>
              </div>

              {/* Barra de carga relativa da equipe */}
              <div className="h-[calc(var(--u)*0.7)] shrink-0 overflow-hidden rounded-full" style={{ background: "hsl(var(--tvb-line) / 0.5)" }}>
                <div
                  className="h-full rounded-full transition-[width] duration-700"
                  style={{
                    width: `${Math.max(4, (r.fila / cargaMax) * 100)}%`,
                    background: "linear-gradient(90deg, hsl(218 90% 52%), hsl(22 95% 58%))",
                  }}
                />
              </div>

              {/* As 3 primeiras prioridades da fila dele */}
              <div className="flex min-h-0 flex-1 flex-col justify-start gap-[calc(var(--u)*0.7)]">
                {r.top3.map((c, k) => (
                  // O assunto ocupa a linha inteira (até 2 linhas) e o status
                  // desce para a linha de baixo: assim o nome da solicitação e
                  // o do solicitante aparecem por extenso, sem cortar.
                  <div
                    key={c.id}
                    className="rounded-[calc(var(--u)*0.8)] px-[calc(var(--u)*1)] py-[calc(var(--u)*0.7)]"
                    style={{ background: "hsl(220 45% 17% / 0.55)", borderLeft: `calc(var(--u) * 0.35) solid hsl(${COR_PRIO[c.prioridade] ?? "215 20% 62%"})` }}
                  >
                    <p className="flex items-start gap-[calc(var(--u)*0.8)]">
                      <span className="tvb-mini shrink-0 leading-[1.35]" style={{ color: `hsl(${COR_PRIO[c.prioridade] ?? "215 20% 62%"})` }}>{k + 1}º</span>
                      <span className="tvb-item tvb-2l min-w-0 flex-1">{c.assunto}</span>
                    </p>
                    <p className="mt-[calc(var(--u)*0.2)] flex items-center gap-[calc(var(--u)*0.8)] pl-[calc(var(--u)*2.2)]">
                      <span className="tvb-item-s min-w-0 flex-1 truncate">{c.solicitante_nome || "—"}{c.setor ? ` · ${c.setor}` : ""}</span>
                      <span
                        className="tvb-mini shrink-0 rounded-full px-[calc(var(--u)*0.7)] py-[calc(var(--u)*0.1)]"
                        style={{ background: `hsl(${COR_STATUS[c.status] ?? "215 20% 62%"} / 0.18)`, color: `hsl(${COR_STATUS[c.status] ?? "215 20% 62%"})` }}
                      >
                        {STATUS_CHAMADO[c.status]?.label ?? c.status}
                      </span>
                    </p>
                  </div>
                ))}
                {r.top3.length === 0 && (
                  <div className="flex flex-1 items-center justify-center">
                    <span className="tvb-mini">Fila vazia — disponível</span>
                  </div>
                )}
              </div>

              {/* Rodapé do card: números do dia a dia */}
              <div className="flex shrink-0 items-center justify-between border-t pt-[calc(var(--u)*0.8)]" style={{ borderColor: "hsl(var(--tvb-line) / 0.6)" }}>
                {([
                  ["Andamento", r.em_andamento, "205 90% 62%"],
                  ["Aguardando", r.aguardando, "265 80% 72%"],
                  ["Concl./mês", r.concluidos_mes, "152 60% 50%"],
                  ["Atrasados", r.atrasados, r.atrasados > 0 ? "0 80% 62%" : "215 20% 55%"],
                ] as const).map(([label, v, cor]) => (
                  <div key={label} className="text-center">
                    <p className="font-bold leading-none" style={{ fontSize: "calc(var(--u) * 2)", color: `hsl(${cor})` }}>{v}</p>
                    <p className="tvb-mini">{label}</p>
                  </div>
                ))}
              </div>
            </article>
          ))}

          {/* Última célula da grade: gráficos (mesmo tamanho de um card de dev) */}
          <CardGraficos chamados={chamados} upx={upx} />

          {visiveis.length === 0 && (
            <div className="tvb-panel col-span-full flex items-center justify-center">
              <p className="tvb-h">{isLoading ? "Carregando…" : "Nenhum desenvolvedor com chamados"}</p>
            </div>
          )}
        </div>

        {/* Coluna direita: próximos da fila geral + status */}
        <div className="flex min-h-0 flex-col gap-[calc(var(--u)*1.4)]">
          <section className="tvb-panel flex min-h-0 flex-[3] flex-col p-[calc(var(--u)*1.5)]">
            <p className="tvb-h mb-[calc(var(--u)*1)] shrink-0">Próximos da fila geral</p>
            <div className="flex min-h-0 flex-1 flex-col justify-between gap-[calc(var(--u)*0.6)]">
              {proximos.map((c, i) => (
                <div key={c.id} className="tvb-enter flex min-w-0 items-start gap-[calc(var(--u)*1)]" style={{ ["--i" as any]: i }}>
                  <span
                    className="grid shrink-0 place-items-center rounded-full font-bold"
                    style={{
                      width: "calc(var(--u) * 2.8)", height: "calc(var(--u) * 2.8)", fontSize: "calc(var(--u) * 1.4)",
                      background: `hsl(${COR_PRIO[c.prioridade] ?? "215 20% 62%"} / 0.18)`,
                      color: `hsl(${COR_PRIO[c.prioridade] ?? "215 20% 62%"})`,
                    }}
                  >
                    {posGlobal[c.id]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="tvb-item tvb-2l block">{c.assunto}</span>
                    <span className="tvb-item-s block truncate">
                      {c.solicitante_nome || "—"} → {c.responsavel_id ? nomeCurto(nomeDe(c.responsavel_id)) : "sem responsável"}
                    </span>
                  </span>
                </div>
              ))}
              {proximos.length === 0 && <p className="tvb-mini">Nenhum chamado na fila.</p>}
            </div>
          </section>

          <section className="tvb-panel flex min-h-0 flex-[2] flex-col p-[calc(var(--u)*1.5)]">
            <p className="tvb-h mb-[calc(var(--u)*1)] shrink-0">Situação dos chamados</p>
            <div className="flex min-h-0 flex-1 flex-col justify-between">
              {statusBarras.map((s) => (
                <div key={s.status} className="flex items-center gap-[calc(var(--u)*1)]">
                  <span className="tvb-item-s w-[38%] shrink-0 truncate">{STATUS_CHAMADO[s.status]?.label ?? s.status}</span>
                  <span className="h-[calc(var(--u)*1)] flex-1 overflow-hidden rounded-full" style={{ background: "hsl(var(--tvb-line) / 0.45)" }}>
                    <span
                      className="block h-full rounded-full transition-[width] duration-700"
                      style={{ width: `${Math.max(2, s.pct)}%`, background: `hsl(${COR_STATUS[s.status]})` }}
                    />
                  </span>
                  <span className="tvb-item w-[calc(var(--u)*3.4)] shrink-0 text-right">{s.n}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

    </div>
  );

  // No Modo TV o painel sai do layout do ERP (sem sidebar, sem topbar).
  if (tv) return createPortal(<div className="fixed inset-0 z-[120]">{painel}</div>, document.body);
  return painel;
}
