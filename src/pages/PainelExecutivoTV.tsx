import { useState, useEffect, useCallback, useRef } from "react";
import logoNascimento from "@/assets/logo-nascimento-icon.png";
import { useNavigate } from "react-router-dom";
import { usePainelLicitacao } from "@/hooks/usePainelLicitacao";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, X, Tv } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, LabelList, LineChart, Line, Legend, Cell,
} from "recharts";

// ─── Paleta neon ─────────────────────────────────────────────────────────────
const N = {
  cyan:    "#00f5ff",
  green:   "#00ff88",
  orange:  "#ff6b35",
  magenta: "#c084fc",
  yellow:  "#fbbf24",
  blue:    "#60a5fa",
};

const SLIDE_DURATION = 9000;

const fmtCompact = (v: number) =>
  v >= 1_000_000_000 ? `${(v / 1_000_000_000).toFixed(1)}B`
  : v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
  : v >= 1_000 ? `${(v / 1_000).toFixed(0)}k`
  : `${v}`;

// Trunca (não arredonda) para 1 casa decimal — ex: 39.99 → "39,9" nunca "40,0"
function truncate1(n: number): string {
  return (Math.floor(n * 10) / 10).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// Formata valor monetário compacto para exibição em KPI de TV
// Ex: 39.990.944.339 → { valor: "R$ 39,9", unidade: "bilhões" }
function fmtBRLKPI(v: number): { valor: string; unidade: string } {
  if (v >= 1_000_000_000) return { valor: `R$ ${truncate1(v / 1_000_000_000)}`, unidade: "bilhões" };
  if (v >= 1_000_000)     return { valor: `R$ ${truncate1(v / 1_000_000)}`,     unidade: "milhões" };
  if (v >= 1_000)         return { valor: `R$ ${Math.floor(v / 1_000).toLocaleString("pt-BR")}`,  unidade: "mil" };
  return { valor: `R$ ${v.toLocaleString("pt-BR")}`, unidade: "" };
}

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function fmtDate(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function aberturaUrgencia(d: string | null) {
  if (!d) return null;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dt = new Date(d + "T00:00:00");
  const dias = Math.ceil((dt.getTime() - hoje.getTime()) / 86_400_000);
  if (dias < 0) return null;
  if (dias <= 3) return "critica";
  if (dias <= 7) return "proxima";
  return "normal";
}

// ─── IBGE: lista oficial de municípios para correção de nomes ────────────────
type IBGEMun = { nome: string; uf: string };
const IBGE_CACHE_KEY = "ibge:municipios:v2";
let ibgeCache: IBGEMun[] | null = null;

async function fetchIBGE(): Promise<IBGEMun[]> {
  if (ibgeCache) return ibgeCache;
  const raw = localStorage.getItem(IBGE_CACHE_KEY);
  if (raw) { ibgeCache = JSON.parse(raw); return ibgeCache!; }
  try {
    const res = await fetch("https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome");
    const data = await res.json();
    ibgeCache = (data as { nome: string; microrregiao: { mesorregiao: { UF: { sigla: string } } } }[])
      .map((m) => ({ nome: m.nome, uf: m.microrregiao.mesorregiao.UF.sigla }));
    localStorage.setItem(IBGE_CACHE_KEY, JSON.stringify(ibgeCache));
    return ibgeCache;
  } catch { return []; }
}

// Normaliza string: minúsculas, sem acento, sem preposições PT, sem não-alfanumérico
function normStr(s: string): string {
  return s.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(da|de|do|das|dos|e|d')\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Encontra o nome oficial IBGE mais próximo para uma cidade+UF do banco
function ibgeMatch(cidade: string, uf: string | null, municipios: IBGEMun[]): string | null {
  const norm = normStr(cidade);
  const lista = uf ? municipios.filter((m) => m.uf === uf) : municipios;
  // 1. Match exato normalizado
  const exact = lista.find((m) => normStr(m.nome) === norm);
  if (exact) return exact.nome;
  // 2. Match exato sem filtro de UF
  const exactAny = municipios.find((m) => normStr(m.nome) === norm);
  if (exactAny) return exactAny.nome;
  // 3. Match parcial (o nome DB está contido no IBGE ou vice-versa)
  const partial = lista.find((m) => {
    const mn = normStr(m.nome);
    return mn.includes(norm) || norm.includes(mn);
  });
  if (partial) return partial.nome;
  return null;
}

// ─── Geocoding via Nominatim com cache no localStorage ───────────────────────
async function geocodeCidadeUF(cidade: string, uf: string | null, cacheKey: string): Promise<[number, number] | null> {
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    if (cached === "null") return null;
    try { return JSON.parse(cached); } catch { /**/ }
  }
  try {
    // Corrige nome via IBGE antes de enviar ao Nominatim
    const municipios = await fetchIBGE();
    const nomeOficial = ibgeMatch(cidade, uf, municipios) ?? cidade;
    const query = [nomeOficial, uf, "Brasil"].filter(Boolean).join(" ");
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=br`,
      { headers: { "Accept-Language": "pt-BR", "User-Agent": "NascimentoERP/1.0" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const match = (data ?? []).find((r: { lat: string; lon: string }) =>
      dentrodoBrasil(parseFloat(r.lat), parseFloat(r.lon))
    );
    if (match) {
      const result: [number, number] = [parseFloat(match.lat), parseFloat(match.lon)];
      localStorage.setItem(cacheKey, JSON.stringify(result));
      return result;
    }
    localStorage.setItem(cacheKey, "null");
  } catch { /**/ }
  return null;
}

// Mantida por compatibilidade com cache antigo (sem UF)
async function geocodeCidade(cidade: string): Promise<[number, number] | null> {
  return geocodeCidadeUF(cidade, null, `gc:br:${cidade.toLowerCase().trim()}`);
}

// Bounding box e projeção do Brasil
const BR = { latN: 5.5, latS: -34.0, lonW: -74.0, lonE: -28.5 };

function dentrodoBrasil(lat: number, lon: number): boolean {
  return lat >= BR.latS && lat <= BR.latN && lon >= BR.lonW && lon <= BR.lonE;
}
function geoToSVG(lat: number, lon: number): [number, number] {
  const x = ((lon - BR.lonW) / (BR.lonE - BR.lonW)) * 500;
  const y = ((BR.latN - lat) / (BR.latN - BR.latS)) * 600;
  return [Math.round(x), Math.round(y)];
}

// Path simplificado do contorno do Brasil (coordenadas SVG 500×600)
const BRASIL_PATH =
  "M150,3 L154,16 L158,32 L245,24 L251,20 L256,56 L240,68 L262,75 L245,87 " +
  "L262,101 L321,120 L349,129 L387,140 L425,167 L427,189 L425,213 " +
  "L403,250 L387,275 L392,312 L381,350 L365,382 L360,401 L333,431 " +
  "L321,435 L300,448 L278,471 L277,478 L273,509 L267,523 L262,530 " +
  "L255,538 L240,569 L225,595 L208,557 L197,542 L181,509 L175,463 " +
  "L181,432 L186,409 L175,362 L177,353 L164,321 L153,339 L95,321 " +
  "L99,212 L58,226 L23,218 L3,173 L15,214 L12,156 L43,132 " +
  "L47,83 L49,68 L63,53 L73,53 L110,68 Z";

// ─── Componente principal ─────────────────────────────────────────────────────
export default function PainelExecutivoTV() {
  const navigate = useNavigate();
  const { empresa } = useEmpresaAtiva();
  const { stats, isLoading, items } = usePainelLicitacao();
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hora, setHora] = useState(new Date());

  const SLIDES = ["KPIs", "Mapa de Contratos", "Por Responsável", "Funil por Fase", "Evolução Mensal", "Alertas"];

  const nextSlide = useCallback(() => { setSlide((s) => (s + 1) % SLIDES.length); setProgress(0); }, [SLIDES.length]);
  const prevSlide = useCallback(() => { setSlide((s) => (s - 1 + SLIDES.length) % SLIDES.length); setProgress(0); }, [SLIDES.length]);

  // Relógio
  useEffect(() => { const t = setInterval(() => setHora(new Date()), 1000); return () => clearInterval(t); }, []);

  // Auto-rotate
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setProgress((p) => { if (p >= 100) { nextSlide(); return 0; } return p + (100 / (SLIDE_DURATION / 100)); }), 100);
    return () => clearInterval(t);
  }, [paused, nextSlide]);

  // Fullscreen state sync
  useEffect(() => {
    const h = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  };

  // Teclado
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") nextSlide();
      if (e.key === "ArrowLeft") prevSlide();
      if (e.key === " ") { e.preventDefault(); setPaused((p) => !p); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [nextSlide, prevSlide]);

  const horaStr = hora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dataStr = hora.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden select-none"
      style={{ background: "#06060f", fontFamily: "inherit" }}
    >
      {/* Grade de fundo */}
      <div className="pointer-events-none absolute inset-0" style={{
        backgroundImage: `linear-gradient(rgba(0,245,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,245,255,0.03) 1px, transparent 1px)`,
        backgroundSize: "48px 48px",
      }} />

      {/* Header */}
      <header className="relative z-10 flex shrink-0 items-center justify-between px-8 py-3" style={{ borderBottom: `1px solid rgba(0,245,255,0.12)` }}>
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center shrink-0">
            <img src={logoNascimento} alt="Nascimento" className="h-9 w-9 object-contain"
              style={{ filter: `drop-shadow(0 0 4px ${N.cyan}) drop-shadow(0 0 10px ${N.cyan}88)` }} />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: N.cyan }}>Grupo Nascimento · Licitações</p>
            <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>{empresa?.nome_fantasia ?? empresa?.razao_social ?? "—"}</p>
          </div>
        </div>

        <div className="text-center">
          <p className="text-3xl font-black tabular-nums" style={{ color: N.cyan, textShadow: `0 0 20px ${N.cyan}88` }}>{horaStr}</p>
          <p className="text-[10px] capitalize" style={{ color: "rgba(255,255,255,0.35)" }}>{dataStr}</p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setPaused((p) => !p)} className="rounded-lg px-3 py-1.5 text-xs font-semibold transition" style={{ border: `1px solid rgba(0,245,255,0.2)`, color: N.cyan, background: "rgba(0,245,255,0.05)" }}>
            {paused ? "▶ Retomar" : "⏸ Pausar"}
          </button>
          <button onClick={toggleFullscreen} className="rounded-lg p-2 transition" style={{ border: `1px solid rgba(0,245,255,0.2)`, color: "rgba(255,255,255,0.5)" }}>
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button onClick={() => navigate("/app/painel-executivo")} className="rounded-lg p-2 transition" style={{ border: `1px solid rgba(255,107,53,0.3)`, color: N.orange }}>
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Progress bar */}
      <div className="relative h-px shrink-0" style={{ background: "rgba(0,245,255,0.1)" }}>
        <div className="h-full transition-none" style={{ width: `${progress}%`, background: N.cyan, boxShadow: `0 0 8px ${N.cyan}` }} />
      </div>

      {/* Slide header */}
      <div className="relative z-10 flex shrink-0 items-center justify-between px-8 py-3">
        <h1 className="text-lg font-black uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.85)" }}>
          {SLIDES[slide]}
          {isLoading && <span className="ml-3 text-xs font-normal" style={{ color: N.cyan }}>carregando…</span>}
        </h1>
        <div className="flex items-center gap-2">
          {SLIDES.map((_, i) => (
            <button key={i} onClick={() => { setSlide(i); setProgress(0); }} className="rounded-full transition-all"
              style={{ height: 6, width: i === slide ? 24 : 6, background: i === slide ? N.cyan : "rgba(255,255,255,0.15)", boxShadow: i === slide ? `0 0 8px ${N.cyan}` : "none" }} />
          ))}
        </div>
      </div>

      {/* Conteúdo */}
      <div className="relative z-10 flex-1 overflow-hidden px-8 pb-6">
        {slide === 0 && <SlideKPIs stats={stats} />}
        {slide === 1 && <SlideMapa items={items} />}
        {slide === 2 && <SlideResponsavel stats={stats} />}
        {slide === 3 && <SlideFunil stats={stats} />}
        {slide === 4 && <SlideEvolucao stats={stats} />}
        {slide === 5 && <SlideAlertas stats={stats} />}
      </div>

      {/* Setas */}
      <button onClick={prevSlide} className="absolute left-2 top-1/2 -translate-y-1/2 z-20 rounded-full p-2 transition" style={{ border: `1px solid rgba(0,245,255,0.15)`, background: "rgba(0,245,255,0.05)", color: "rgba(255,255,255,0.4)" }}>
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button onClick={nextSlide} className="absolute right-2 top-1/2 -translate-y-1/2 z-20 rounded-full p-2 transition" style={{ border: `1px solid rgba(0,245,255,0.15)`, background: "rgba(0,245,255,0.05)", color: "rgba(255,255,255,0.4)" }}>
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}

// ─── Slide KPIs ───────────────────────────────────────────────────────────────
type KpiItem =
  | { label: string; valor: string; unidade?: string; sub: string; color: string; glow: string }

function SlideKPIs({ stats }: { stats: ReturnType<typeof usePainelLicitacao>["stats"] }) {
  const pipeline = fmtBRLKPI(stats.valorPipeline);
  const kpis: KpiItem[] = [
    { label: "Pipeline Ativo",   valor: pipeline.valor,                     unidade: pipeline.unidade,  sub: `${stats.ativas} editais ativos`,              color: N.cyan,   glow: N.cyan   },
    { label: "Total de Editais", valor: String(stats.total),               unidade: "editais",          sub: `${stats.finalizadas} finalizados`,             color: N.blue,   glow: N.blue   },
    { label: "Taxa de Vitória",  valor: `${stats.taxaVitoria.toFixed(0)}%`, unidade: "de aproveitamento", sub: `${stats.ganhas} ganhos · ${stats.perdidas} perdidos`, color: N.green, glow: N.green  },
    { label: "Alertas Abertura", valor: String(stats.alertas.length),      unidade: "vencimentos",      sub: "Próximos 7 dias",                              color: N.orange, glow: N.orange },
  ];
  return (
    <div className="grid h-full grid-cols-2 gap-5 xl:grid-cols-4">
      {kpis.map((k) => (
        <div key={k.label} className="relative flex flex-col justify-between overflow-hidden rounded-2xl p-6"
          style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${k.color}33`, boxShadow: `0 0 30px ${k.glow}18, inset 0 0 30px ${k.glow}08` }}>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.15em]" style={{ color: `${k.color}99` }}>{k.label}</p>
            <div className="my-4 h-px" style={{ background: `linear-gradient(90deg, ${k.color}44, transparent)` }} />
          </div>
          <div>
            <p className="text-5xl font-black tabular-nums leading-none" style={{ color: k.color, textShadow: `0 0 30px ${k.glow}88` }}>{k.valor}</p>
            {k.unidade && <p className="mt-1 text-base font-semibold uppercase tracking-widest" style={{ color: `${k.color}77` }}>{k.unidade}</p>}
            <p className="mt-3 text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>{k.sub}</p>
          </div>
          {/* Corner accent */}
          <div className="absolute right-0 top-0 h-16 w-16 rounded-bl-full opacity-10" style={{ background: k.color }} />
        </div>
      ))}
    </div>
  );
}

// ─── Slide Mapa ───────────────────────────────────────────────────────────────
type PontoMapa = { label: string; x: number; y: number; count: number };
type CidadeInfo = { count: number; uf: string | null };

function SlideMapa({ items }: { items: ReturnType<typeof usePainelLicitacao>["items"] }) {
  const [pontos, setPontos] = useState<PontoMapa[]>([]);
  const [naoEncontradas, setNaoEncontradas] = useState<string[]>([]);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodedCount, setGeocodedCount] = useState(0);
  const [tooltip, setTooltip] = useState<{ label: string; count: number; x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  // Agrupa por cidade preservando a UF mais frequente associada
  const cidades = items.reduce<Record<string, CidadeInfo>>((acc, i) => {
    if (!i.cidade) return acc;
    const cur = acc[i.cidade] ?? { count: 0, uf: i.uf };
    acc[i.cidade] = { count: cur.count + 1, uf: cur.uf ?? i.uf };
    return acc;
  }, {});

  // Geocodifica cidades sequencialmente
  useEffect(() => {
    const cidadesUnicas = Object.keys(cidades);
    if (!cidadesUnicas.length) return;

    let cancelled = false;
    setGeocoding(true);
    setGeocodedCount(0);
    setNaoEncontradas([]);

    (async () => {
      const resultado: PontoMapa[] = [];
      const falhas: string[] = [];
      for (let i = 0; i < cidadesUnicas.length; i++) {
        if (cancelled) break;
        const cidade = cidadesUnicas[i];
        const { uf } = cidades[cidade];
        // Chave de cache inclui UF para evitar colisões e melhorar precisão
        const cacheKey = `gc:br:${cidade.toLowerCase().trim()}${uf ? `:${uf.toLowerCase()}` : ""}`;
        const cached = localStorage.getItem(cacheKey);
        if (!cached) await new Promise((r) => setTimeout(r, 1200));
        const coords = await geocodeCidadeUF(cidade, uf, cacheKey);
        if (coords) {
          const [svgX, svgY] = geoToSVG(coords[0], coords[1]);
          const label = uf ? `${cidade} / ${uf}` : cidade;
          resultado.push({ label, x: svgX, y: svgY, count: cidades[cidade].count });
          if (!cancelled) setPontos([...resultado]);
        } else {
          falhas.push(uf ? `${cidade} (${uf})` : cidade);
          if (!cancelled) setNaoEncontradas([...falhas]);
        }
        if (!cancelled) setGeocodedCount(i + 1);
      }
      if (!cancelled) setGeocoding(false);
    })();

    return () => { cancelled = true; };
  }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Animação canvas — desenha outline + pontos tudo no mesmo canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width, H = canvas.height;
    const maxCount = pontos.length ? Math.max(...pontos.map((p) => p.count)) : 1;
    const brasilPath = new Path2D(BRASIL_PATH);
    let t = 0;

    // Escala o path de 500x600 para o canvas real
    const scaleX = W / 500;
    const scaleY = H / 600;

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      t += 0.04;

      // Contorno do Brasil
      ctx.save();
      ctx.scale(scaleX, scaleY);
      ctx.fillStyle = "rgba(0,245,255,0.04)";
      ctx.fill(brasilPath);
      ctx.strokeStyle = `${N.cyan}88`;
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 8;
      ctx.shadowColor = N.cyan;
      ctx.stroke(brasilPath);
      ctx.restore();

      // Pontos pulsantes
      pontos.forEach((p) => {
        const cx = p.x * scaleX;
        const cy = p.y * scaleY;
        const baseR = 4 + (p.count / maxCount) * 12;
        const pulse = Math.sin(t + p.x * 0.1) * 0.5 + 0.5;

        // Halo
        const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * 3 + pulse * 8);
        halo.addColorStop(0, "rgba(0,255,136,0.3)");
        halo.addColorStop(1, "transparent");
        ctx.beginPath();
        ctx.arc(cx, cy, baseR * 3 + pulse * 8, 0, Math.PI * 2);
        ctx.fillStyle = halo;
        ctx.fill();

        // Núcleo
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR);
        grad.addColorStop(0, "#ffffff");
        grad.addColorStop(0.4, N.green);
        grad.addColorStop(1, "rgba(0,255,136,0.1)");
        ctx.beginPath();
        ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.shadowBlur = 14 + pulse * 8;
        ctx.shadowColor = N.green;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [pontos]);

  return (
    <div className="flex h-full gap-6">
      {/* Canvas único: outline + pontos */}
      <div className="relative flex flex-1 items-center justify-center">
        <canvas
          ref={canvasRef}
          width={500} height={600}
          className="h-full w-auto"
          style={{ maxHeight: "calc(100vh - 200px)" }}
          onMouseMove={(e) => {
            const canvas = canvasRef.current;
            if (!canvas || !pontos.length) return;
            const rect = canvas.getBoundingClientRect();
            const mx = (e.clientX - rect.left) * (500 / rect.width);
            const my = (e.clientY - rect.top) * (600 / rect.height);
            const maxCount = Math.max(...pontos.map((p) => p.count));
            const hit = pontos.find((p) => {
              const r = 4 + (p.count / maxCount) * 12 + 6; // raio + margem de toque
              return Math.hypot(p.x - mx, p.y - my) <= r;
            });
            setTooltip(hit ? { label: hit.label, count: hit.count, x: e.clientX, y: e.clientY } : null);
          }}
          onMouseLeave={() => setTooltip(null)}
        />
        {/* Tooltip flutuante */}
        {tooltip && (
          <div className="pointer-events-none fixed z-50 rounded-lg px-3 py-2 text-xs font-semibold shadow-xl"
            style={{ left: tooltip.x + 12, top: tooltip.y - 36, background: "rgba(6,6,15,0.95)", border: `1px solid ${N.cyan}44`, color: "#fff", backdropFilter: "blur(8px)", whiteSpace: "nowrap" }}>
            {tooltip.label}
            <span className="ml-2 font-black" style={{ color: N.green }}>{tooltip.count}</span>
          </div>
        )}
      </div>

      {/* Painel lateral */}
      <div className="flex w-64 flex-col gap-4">
        <div className="rounded-xl p-4" style={{ border: `1px solid ${N.cyan}22`, background: "rgba(0,245,255,0.04)" }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: N.cyan }}>Cidades mapeadas</p>
          {geocoding && (
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
              Geocodificando {geocodedCount}/{Object.keys(cidades).length}…
            </p>
          )}
          <p className="text-4xl font-black" style={{ color: N.green, textShadow: `0 0 20px ${N.green}88` }}>{pontos.length}</p>
          <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>de {Object.keys(cidades).length} cidades</p>
        </div>

        <div className="rounded-xl p-4 flex-1 overflow-hidden flex flex-col" style={{ border: `1px solid rgba(255,255,255,0.06)`, background: "rgba(255,255,255,0.02)" }}>
          <p className="shrink-0 text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: "rgba(255,255,255,0.4)" }}>Top cidades</p>
          <div className="flex-1 space-y-2 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
            {Object.entries(cidades).sort((a, b) => b[1].count - a[1].count).slice(0, 12).map(([cidade, info]) => (
              <div key={cidade} className="flex items-center justify-between">
                <span className="text-xs truncate" style={{ color: "rgba(255,255,255,0.6)" }}>{cidade}{info.uf ? ` / ${info.uf}` : ""}</span>
                <span className="ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: `${N.green}22`, color: N.green }}>{info.count}</span>
              </div>
            ))}
          </div>
        </div>

        {naoEncontradas.length > 0 && (
          <div className="rounded-xl p-4 overflow-hidden flex flex-col" style={{ border: `1px solid rgba(251,191,36,0.2)`, background: "rgba(251,191,36,0.04)", maxHeight: "35%" }}>
            <p className="shrink-0 text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: N.yellow }}>
              Não localizadas ({naoEncontradas.length})
            </p>
            <div className="flex-1 overflow-y-auto space-y-1">
              {naoEncontradas.map((c) => (
                <p key={c} className="text-[10px] truncate" style={{ color: "rgba(251,191,36,0.6)" }}>· {c}</p>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-xl p-4" style={{ border: `1px solid ${N.orange}22`, background: "rgba(255,107,53,0.04)" }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: N.orange }}>Total de editais</p>
          <p className="text-3xl font-black" style={{ color: N.orange, textShadow: `0 0 20px ${N.orange}88` }}>
            {Object.values(cidades).reduce((a, b) => a + b.count, 0)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── GlassBar — barra horizontal reutilizável ─────────────────────────────────
function GlassBar({ label, value, pct, cor, fmt }: { label: string; value: string; pct: number; cor: string; fmt?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-40 shrink-0 truncate text-right text-xs font-semibold" style={{ color: "rgba(255,255,255,0.5)" }} title={label}>{label}</span>
      <div className="relative flex-1 h-8 rounded-lg overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="absolute inset-y-0 left-0 rounded-lg"
          style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${cor}2e, ${cor}18)`, borderRight: `2px solid ${cor}`, boxShadow: `0 0 10px ${cor}44` }} />
        <div className="absolute inset-x-0 top-0 h-1/2 rounded-t-lg" style={{ background: "linear-gradient(180deg,rgba(255,255,255,0.05),transparent)" }} />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black tabular-nums" style={{ color: cor, textShadow: `0 0 8px ${cor}` }}>{value}</span>
      </div>
    </div>
  );
}

// ─── Slide Responsável ────────────────────────────────────────────────────────
function SlideResponsavel({ stats }: { stats: ReturnType<typeof usePainelLicitacao>["stats"] }) {
  const maxValor = Math.max(...stats.porResponsavel.map((r) => r.valor), 1);
  const maxQtd   = Math.max(...stats.porResponsavel.map((r) => r.qtd), 1);

  return (
    <div className="grid h-full grid-cols-2 gap-6">
      <NeonCard title="Valor por responsável" full>
        <div className="flex flex-col justify-evenly h-full gap-2">
          {stats.porResponsavel.map((r) => (
            <GlassBar key={r.responsavel} label={r.responsavel} value={fmtCompact(r.valor)}
              pct={(r.valor / maxValor) * 100} cor={N.cyan} />
          ))}
        </div>
      </NeonCard>
      <NeonCard title="Processos por responsável" color={N.magenta} full>
        <div className="flex flex-col justify-evenly h-full gap-2">
          {stats.porResponsavel.map((r) => (
            <GlassBar key={r.responsavel} label={r.responsavel} value={String(r.qtd)}
              pct={(r.qtd / maxQtd) * 100} cor={N.magenta} />
          ))}
        </div>
      </NeonCard>
    </div>
  );
}

// ─── Slide Funil ─────────────────────────────────────────────────────────────
const FASE_COLOR: Record<string, string> = {
  "À Iniciar":      N.blue,
  "Iniciado":       N.cyan,
  "Em Andamento":   N.green,
  "Finalizada":     N.yellow,
  "Não Participado":"rgba(255,255,255,0.3)",
  "Suspenso":       N.orange,
  "Revogado":       "#f43f5e",
};

function SlideFunil({ stats }: { stats: ReturnType<typeof usePainelLicitacao>["stats"] }) {
  const maxQtd = Math.max(...stats.porFase.map((f) => f.value), 1);
  const total  = stats.porFase.reduce((s, f) => s + f.value, 0);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex flex-col justify-evenly px-4">
        {stats.porFase.map((fase) => {
          const cor = FASE_COLOR[fase.name] ?? N.cyan;
          return (
            <GlassBar key={fase.name} label={fase.name} value={String(fase.value)}
              pct={(fase.value / maxQtd) * 100} cor={cor} />
          );
        })}
      </div>
      <div className="shrink-0 flex justify-end px-6 pb-1">
        <span className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>Total: {total} processos</span>
      </div>
    </div>
  );
}

// ─── Slide Evolução ───────────────────────────────────────────────────────────
function SlideEvolucao({ stats }: { stats: ReturnType<typeof usePainelLicitacao>["stats"] }) {
  const tt = { contentStyle: { background: "#0d0d1a", border: "1px solid rgba(0,245,255,0.15)", borderRadius: 8, fontSize: 13, color: "#fff" } };
  return (
    <NeonCard title="Evolução do pipeline — últimos 6 meses" full>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={stats.evolucaoMensal} margin={{ left: 0, right: 20, top: 30, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,245,255,0.06)" />
          <XAxis dataKey="mes" stroke="rgba(255,255,255,0.4)" fontSize={14} />
          <YAxis yAxisId="l" stroke="rgba(0,245,255,0.4)" fontSize={12} tickFormatter={fmtCompact} />
          <YAxis yAxisId="r" orientation="right" stroke="rgba(192,132,252,0.4)" fontSize={12} />
          <Tooltip {...tt} />
          <Legend wrapperStyle={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }} />
          <Line yAxisId="l" type="monotone" dataKey="valor" name="Valor (R$)" stroke={N.cyan} strokeWidth={3} dot={{ r: 6, fill: N.cyan, strokeWidth: 0 }}>
            <LabelList dataKey="valor" position="top" formatter={fmtCompact} fill="rgba(255,255,255,0.6)" fontSize={12} fontWeight={600} />
          </Line>
          <Line yAxisId="r" type="monotone" dataKey="processos" name="Processos" stroke={N.magenta} strokeWidth={3} dot={{ r: 6, fill: N.magenta, strokeWidth: 0 }}>
            <LabelList dataKey="processos" position="bottom" fill="rgba(255,255,255,0.6)" fontSize={12} fontWeight={600} />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </NeonCard>
  );
}

// ─── Slide Alertas ────────────────────────────────────────────────────────────
function SlideAlertas({ stats }: { stats: ReturnType<typeof usePainelLicitacao>["stats"] }) {
  if (!stats.alertas.length) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-lg font-semibold" style={{ color: "rgba(255,255,255,0.3)" }}>Nenhum alerta nos próximos 7 dias</p>
      </div>
    );
  }
  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <p className="shrink-0 text-[10px] font-bold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.3)" }}>
        Editais com abertura próxima
      </p>
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {stats.alertas.map((item) => {
          const urg = aberturaUrgencia(item.data);
          const col = urg === "critica" ? "#f43f5e" : urg === "proxima" ? N.yellow : N.green;
          return (
            <div key={item.id} className="flex items-center gap-4 rounded-xl px-5 py-3"
              style={{ border: `1px solid ${col}33`, background: `${col}08`, boxShadow: `0 0 12px ${col}12` }}>
              <span className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-black tabular-nums"
                style={{ background: `${col}22`, color: col, border: `1px solid ${col}44` }}>
                {fmtDate(item.data)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white">{item.edital || "—"} · {item.objeto || "Sem objeto"}</p>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{item.responsavel || "Sem responsável"} · {item.fase}</p>
              </div>
              <div className="h-2 w-2 shrink-0 rounded-full animate-pulse" style={{ background: col, boxShadow: `0 0 8px ${col}` }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── NeonCard wrapper ─────────────────────────────────────────────────────────
function NeonCard({ title, color = N.cyan, full = false, children }: {
  title: string; color?: string; full?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-2xl ${full ? "h-full" : ""}`}
      style={{ border: `1px solid ${color}22`, background: "rgba(255,255,255,0.02)", boxShadow: `0 0 20px ${color}10` }}>
      <div className="shrink-0 px-5 py-3" style={{ borderBottom: `1px solid ${color}15` }}>
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: `${color}bb` }}>{title}</p>
      </div>
      <div className="flex-1 p-4 min-h-0">{children}</div>
    </div>
  );
}
